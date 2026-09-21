import type { Lead, Radar } from "@workspace/api-zod";
import {
  CandidateCompany,
  Evidence,
  ProviderError,
  ResearchProvider,
  ScrapedPage,
  SearchProvider,
} from "./providers";
import { saveLiveLeads, saveLiveRadar } from "./db-storage";
import { logger } from "../lib/logger";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "fbclid",
  "gclid",
  "trk",
  "igshid",
]);

/**
 * Normalizes external URLs:
 * - ensures valid protocol
 * - converts hostname to lowercase
 * - strips tracking parameters
 * - strips fragments
 * - removes trailing slashes
 */
export function canonicalizeUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";

  let trimmed = rawUrl.trim();
  const hasProtocol = /^https?:\/\//i.test(trimmed);
  if (!hasProtocol) {
    if (trimmed.includes(" ") || !trimmed.includes(".")) {
      return trimmed;
    }
    trimmed = `https://${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    // Strip tracking parameters
    const searchParams = new URLSearchParams(parsed.search);
    for (const key of Array.from(searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.startsWith("utm_")) {
        searchParams.delete(key);
      }
    }
    searchParams.sort();
    parsed.search = searchParams.toString();
    parsed.hash = "";

    // Strip trailing slash from pathname if length > 1
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }

    let result = parsed.toString();
    // Remove trailing slash if path is simply '/' and no query
    if (result.endsWith("/") && parsed.pathname === "/" && !parsed.search) {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

/**
 * Extracts a normalized domain from a URL (e.g. "example.com")
 */
export function extractDomain(rawUrl: string): string {
  if (!rawUrl) return "";
  try {
    const canonical = canonicalizeUrl(rawUrl);
    let host = new URL(canonical).hostname.toLowerCase();
    if (host.startsWith("www.")) {
      host = host.slice(4);
    }
    return host;
  } catch {
    return rawUrl
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();
  }
}

/**
 * Deduplicates candidate companies by domain and normalized name
 */
export function deduplicateCandidates(
  candidates: CandidateCompany[],
): CandidateCompany[] {
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();
  const deduplicated: CandidateCompany[] = [];

  for (const candidate of candidates) {
    const domain = (extractDomain(candidate.url) || candidate.domain || "").toLowerCase();
    const rawName = candidate.name || "";
    const normalizedName = rawName
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|corporation|co)\b/gi, "")
      .replace(/[^a-z0-9]/g, "");

    if (domain && seenDomains.has(domain)) {
      continue;
    }
    if (normalizedName && seenNames.has(normalizedName)) {
      continue;
    }

    if (domain) seenDomains.add(domain);
    if (normalizedName) seenNames.add(normalizedName);

    deduplicated.push({
      ...candidate,
      url: canonicalizeUrl(candidate.url),
      domain,
    });
  }

  return deduplicated;
}

export interface ResearchResult {
  candidate: CandidateCompany;
  page: ScrapedPage;
}

export interface DiscoveryRunResult {
  radarId: string;
  query: string;
  candidatesDiscovered: number;
  candidatesResearched: number;
  leadsFound: number;
  results: ResearchResult[];
  leads: Lead[];
  durationMs: number;
}

export interface DiscoveryPipelineOptions {
  searchProvider: SearchProvider;
  researchProvider: ResearchProvider;
  maxCandidates?: number;
  maxResearch?: number;
}

/**
 * Executes Phase 2.1 Live Discovery Pipeline:
 * Search → Normalize → Deduplicate → Scrape/Research → Structured results → Persistence.
 * Does NOT perform LLM qualification (reserved for Phase 2.2).
 */
export async function runDiscoveryPipeline(
  radar: Radar,
  options: DiscoveryPipelineOptions,
): Promise<DiscoveryRunResult> {
  const startTime = Date.now();
  const maxCandidates = options.maxCandidates ?? 10;
  const maxResearch = options.maxResearch ?? 5;

  // 1. Build search query from Radar target and criteria
  const query = `${radar.target} ${radar.criteria[0] ?? ""}`.trim();
  logger.info({ radarId: radar.id, query }, "Starting live discovery search");

  // 2. Search candidates via search provider
  const rawCandidates = await options.searchProvider.search(query, {
    limit: maxCandidates,
  });

  // 3. Normalize & Deduplicate
  const uniqueCandidates = deduplicateCandidates(rawCandidates);
  logger.info(
    {
      radarId: radar.id,
      rawCount: rawCandidates.length,
      uniqueCount: uniqueCandidates.length,
    },
    "Candidates normalized and deduplicated",
  );

  // 4. Research candidates (scrape public website)
  const toResearch = uniqueCandidates.slice(0, maxResearch);
  const researchResults: ResearchResult[] = [];

  for (const candidate of toResearch) {
    try {
      const page = await options.researchProvider.scrapePage(candidate.url, {
        timeoutMs: 15000,
      });
      researchResults.push({ candidate, page });
    } catch (err) {
      logger.warn(
        { candidateUrl: candidate.url, err: err instanceof Error ? err.message : err },
        "Research scrape failed for candidate, continuing",
      );
    }
  }

  // 5. Transform researched candidates into structured real Lead records
  const now = new Date().toISOString();
  const leads: Lead[] = researchResults.map(({ candidate, page }, index) => {
    const leadId = `lead-live-${radar.id}-${Date.now()}-${index + 1}`;

    const evidenceItems: Evidence[] = [
      {
        id: `${leadId}-e1`,
        statement: `Official website publicly accessible at ${candidate.url}`,
        sourceName: page.title || candidate.name,
        sourceUrl: candidate.url,
        sourceStatus: "connected",
        observedAt: page.scrapedAt || now,
        type: "VERIFIED",
        confidence: "high",
      },
    ];

    if (page.title) {
      evidenceItems.push({
        id: `${leadId}-e2`,
        statement: `Public site title: "${page.title}"`,
        sourceName: candidate.name,
        sourceUrl: candidate.url,
        sourceStatus: "connected",
        observedAt: page.scrapedAt || now,
        type: "VERIFIED",
        confidence: "high",
      });
    }

    const lead: Lead = {
      id: leadId,
      radarId: radar.id,
      companyName: candidate.name,
      website: candidate.url,
      instagram: null,
      linkedin: null,
      description:
        page.description ||
        candidate.snippet ||
        `Public company discovered from live search for: ${radar.target}`,
      industry: radar.target,
      location: "Verified web domain",
      founder: null,
      publicEmail: null,
      relevance: 80, // Baseline for researched candidate; LLM scoring in Phase 2.2
      signals: [
        `Discovered from live search: "${radar.target}"`,
        `Official domain verified: ${candidate.domain}`,
        page.title ? `Site title: "${page.title}"` : "Active web presence",
      ],
      evidence: evidenceItems,
      opportunity: [
        radar.offer,
        "Active online brand with verified public domain",
      ],
      source: "Firecrawl Live Discovery",
      sourceStatus: "connected",
      discoveredAt: now,
      status: "researched",
      saved: false,
      contactVerified: false,
    };

    return lead;
  });

  // 6. Persist real results
  if (leads.length > 0) {
    await saveLiveLeads(leads);
    radar.leadCount = (radar.leadCount || 0) + leads.length;
    await saveLiveRadar(radar);
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    {
      radarId: radar.id,
      discovered: uniqueCandidates.length,
      researched: researchResults.length,
      leads: leads.length,
      durationMs,
    },
    "Live discovery pipeline finished",
  );

  return {
    radarId: radar.id,
    query,
    candidatesDiscovered: uniqueCandidates.length,
    candidatesResearched: researchResults.length,
    leadsFound: leads.length,
    results: researchResults,
    leads,
    durationMs,
  };
}
