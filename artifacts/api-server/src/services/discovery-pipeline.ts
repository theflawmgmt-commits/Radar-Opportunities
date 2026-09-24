import type { Lead, Radar } from "@workspace/api-zod";
import {
  CandidateCompany,
  EnrichmentProvider,
  Evidence,
  ProviderError,
  QualificationProvider,
  ResearchProvider,
  ScrapedPage,
  SearchProvider,
} from "./providers";
import { qualifyCandidate } from "./intelligence";
import { enrichCandidate } from "./enrichment";
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
  qualificationProvider?: QualificationProvider;
  enrichmentProvider?: EnrichmentProvider;
  maxCandidates?: number;
  maxResearch?: number;
}

/**
 * Executes Phase 2.3 Live Discovery Pipeline:
 * Search → Normalize → Deduplicate → Scrape/Research → Observable Signals → Evidence-backed Qualification → Opportunity Hypotheses → Contact Enrichment → Persistence.
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

  // 5. Transform researched candidates into qualified, evidence-backed Lead records
  const qualificationProvider =
    options.qualificationProvider ?? {
      qualify: async (c, p, r) => qualifyCandidate(c, p, r),
    };

  const enrichmentProvider =
    options.enrichmentProvider ?? {
      enrich: async (c, p, r, rp) => enrichCandidate(c, p, r, rp),
    };

  const now = new Date().toISOString();
  const leads: Lead[] = [];

  for (let index = 0; index < researchResults.length; index++) {
    const { candidate, page } = researchResults[index];
    const leadId = `lead-live-${radar.id}-${Date.now()}-${index + 1}`;

    const qualification = await qualificationProvider.qualify(candidate, page, {
      target: radar.target,
      offer: radar.offer,
      criteria: radar.criteria,
    });

    const enrichment = await enrichmentProvider.enrich(
      candidate,
      page,
      { offer: radar.offer, target: radar.target },
      options.researchProvider,
    );

    const allContactPoints = [
      ...enrichment.companyContactPoints,
      ...enrichment.people.flatMap((p) => p.contactPoints),
    ];

    const lead: Lead = {
      id: leadId,
      radarId: radar.id,
      companyName: candidate.name,
      website: candidate.url,
      instagram: enrichment.legacyContact.instagram ?? null,
      linkedin: enrichment.legacyContact.linkedin ?? null,
      description:
        page.description ||
        candidate.snippet ||
        `Public company discovered from live search for: ${radar.target}`,
      industry: radar.target,
      location: "Verified web domain",
      founder: enrichment.legacyContact.founder ?? null,
      publicEmail: enrichment.legacyContact.publicEmail ?? null,
      relevance: qualification.relevanceScore, // RADAR_RELEVANCE_SCORE
      fit: qualification.fit,
      scoreBreakdown: qualification.scoreBreakdown,
      observableSignals: qualification.signals,
      signals: qualification.signals.map((s) => s.statement),
      evidence: qualification.evidence,
      opportunity: qualification.opportunities,
      source: "Firecrawl Live Discovery",
      sourceStatus: "connected",
      discoveredAt: now,
      status: "researched",
      saved: false,
      contactVerified: enrichment.legacyContact.contactVerified,
      people: enrichment.people,
      contactPoints: allContactPoints,
      primaryContact: enrichment.primaryContact,
      enrichmentSummary: enrichment.summary,
    };

    leads.push(lead);
  }

  // Sort leads by relevance score descending
  leads.sort((a, b) => b.relevance - a.relevance);

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
