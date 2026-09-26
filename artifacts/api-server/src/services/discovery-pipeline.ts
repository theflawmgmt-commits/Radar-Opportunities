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
import { buildOpportunityBrief } from "./opportunity-brief";
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
 * Category classification for candidates discovered via search.
 */
export type CandidateCategory =
  | "company_domain"
  | "marketplace"
  | "directory"
  | "review_site"
  | "social_profile"
  | "editorial_article"
  | "aggregator"
  | "noise";

export interface CandidateClassification {
  category: CandidateCategory;
  isCompanyDomain: boolean;
  reason: string;
}

const MARKETPLACE_PATTERNS = [
  /amazon\./i,
  /flipkart\./i,
  /etsy\.com/i,
  /ebay\./i,
  /walmart\.com/i,
  /aliexpress\.com/i,
  /myntra\.com/i,
  /ajio\.com/i,
  /target\.com/i,
  /shopee\./i,
  /lazada\./i,
  /nykaa\.com/i,
  /meesho\.com/i,
  /alibaba\.com/i,
];

const DIRECTORY_PATTERNS = [
  /yelp\./i,
  /yellowpages\./i,
  /clutch\.co/i,
  /g2\.com/i,
  /crunchbase\.com/i,
  /zoominfo\.com/i,
  /manta\.com/i,
  /thomasnet\.com/i,
  /trustradius\.com/i,
  /owler\.com/i,
  /apollo\.io/i,
  /goodfirms\.co/i,
  /justdial\.com/i,
  /indiamart\.com/i,
  /tradeindia\.com/i,
  /topstartups\.io/i,
  /ycombinator\.com/i,
  /failory\.com/i,
  /wellfound\.com/i,
  /angel\.co/i,
  /f6s\.com/i,
  /tracxn\.com/i,
  /startupranking\.com/i,
  /d2cstories\.com/i,
];

const REVIEW_PATTERNS = [
  /trustpilot\.com/i,
  /sitejabber\.com/i,
  /tripadvisor\./i,
  /glassdoor\./i,
  /mouthshut\.com/i,
];

const SOCIAL_PATTERNS = [
  /instagram\.com/i,
  /facebook\.com/i,
  /twitter\.com/i,
  /x\.com/i,
  /tiktok\.com/i,
  /youtube\.com/i,
  /linkedin\.com/i,
  /pinterest\.com/i,
  /reddit\.com/i,
  /threads\.net/i,
];

const EDITORIAL_PATTERNS = [
  /medium\.com/i,
  /forbes\.com/i,
  /substack\.com/i,
  /techcrunch\.com/i,
  /nytimes\.com/i,
  /wsj\.com/i,
  /cnbc\.com/i,
  /bbc\.(com|co\.uk)/i,
  /theverge\.com/i,
  /businessinsider\.com/i,
  /bloomberg\.com/i,
  /buzzfeed\.com/i,
  /huffpost\.com/i,
  /theguardian\.com/i,
  /vogue\./i,
  /elle\./i,
  /gq\./i,
  /yourstory\.com/i,
  /inc42\.com/i,
];

const AGGREGATOR_PATTERNS = [
  /producthunt\.com/i,
  /kickstarter\.com/i,
  /indiegogo\.com/i,
  /betalist\.com/i,
  /slant\.co/i,
  /alternativeto\.net/i,
];

const NOISE_SUBDOMAINS = new Set([
  "cdn",
  "static",
  "assets",
  "images",
  "media",
  "auth",
  "login",
  "signin",
  "signup",
  "status",
  "docs",
  "support",
  "help",
  "checkout",
  "admin",
  "portal",
  "account",
  "mail",
]);

/**
 * Classifies candidate URLs/domains to reject marketplaces, directories,
 * social profiles, editorial articles, aggregators, and system noise.
 */
export function classifyCandidateDomain(rawUrl: string): CandidateClassification {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { category: "noise", isCompanyDomain: false, reason: "Empty or invalid URL" };
  }

  const domain = extractDomain(rawUrl);
  if (!domain || !domain.includes(".")) {
    return { category: "noise", isCompanyDomain: false, reason: "Missing valid host" };
  }

  // Check subdomains
  const parts = domain.split(".");
  if (parts.length > 2 && NOISE_SUBDOMAINS.has(parts[0].toLowerCase())) {
    return { category: "noise", isCompanyDomain: false, reason: `Noise subdomain: ${parts[0]}` };
  }

  // Check known marketplaces
  if (MARKETPLACE_PATTERNS.some((p) => p.test(domain))) {
    return { category: "marketplace", isCompanyDomain: false, reason: "Public marketplace" };
  }

  // Check directories
  if (DIRECTORY_PATTERNS.some((p) => p.test(domain))) {
    return { category: "directory", isCompanyDomain: false, reason: "Business directory or aggregator" };
  }

  // Check review sites
  if (REVIEW_PATTERNS.some((p) => p.test(domain))) {
    return { category: "review_site", isCompanyDomain: false, reason: "Customer review platform" };
  }

  // Check social networks
  if (SOCIAL_PATTERNS.some((p) => p.test(domain))) {
    return { category: "social_profile", isCompanyDomain: false, reason: "Social media profile" };
  }

  // Check editorial media / magazines
  if (EDITORIAL_PATTERNS.some((p) => p.test(domain))) {
    return { category: "editorial_article", isCompanyDomain: false, reason: "Editorial publication or news media" };
  }

  // Check aggregators
  if (AGGREGATOR_PATTERNS.some((p) => p.test(domain))) {
    return { category: "aggregator", isCompanyDomain: false, reason: "Crowdfunding or product aggregator" };
  }

  // Check pathname for obvious roundups / listicles on secondary sites
  try {
    const parsed = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    const pathname = parsed.pathname.toLowerCase();
    if (
      pathname.includes("top-10") ||
      pathname.includes("best-") ||
      pathname.includes("-best") ||
      pathname.includes("top-brands") ||
      pathname.includes("top-d2c") ||
      pathname.includes("top-startups") ||
      pathname.includes("brands-list") ||
      pathname.includes("listicle") ||
      pathname.includes("roundup") ||
      (pathname.startsWith("/blog/") && pathname.includes("-guide")) ||
      (pathname.startsWith("/blog/") && pathname.includes("top-")) ||
      (pathname.startsWith("/blog/") && pathname.includes("best-")) ||
      pathname.includes("/companies/") ||
      pathname.includes("/startups/") ||
      (pathname.includes("/list") && !pathname.includes("/wishlist"))
    ) {
      // If path indicates a listicle/roundup
      return {
        category: "editorial_article",
        isCompanyDomain: false,
        reason: "Editorial listicle or roundup article",
      };
    }
  } catch {
    // ignore parse error for pathname
  }

  return {
    category: "company_domain",
    isCompanyDomain: true,
    reason: "Direct company domain",
  };
}

/**
 * Filters candidates to retain only direct company domains.
 */
export function filterCompanyCandidates(candidates: CandidateCompany[]): {
  valid: CandidateCompany[];
  rejected: Array<{ candidate: CandidateCompany; classification: CandidateClassification }>;
} {
  const valid: CandidateCompany[] = [];
  const rejected: Array<{ candidate: CandidateCompany; classification: CandidateClassification }> = [];

  for (const candidate of candidates) {
    const classification = classifyCandidateDomain(candidate.url);
    if (classification.isCompanyDomain) {
      valid.push(candidate);
    } else {
      rejected.push({ candidate, classification });
    }
  }

  return { valid, rejected };
}

/**
 * Builds complementary search query intents:
 * 1. Primary target + criteria
 * 2. Geographic search if geography specified
 * 3. Offer / intent synergy query
 */
export function buildDiscoveryQueries(radar: Radar): string[] {
  const queries: string[] = [];
  const primaryCriterion = radar.criteria?.[0] ?? "";

  // 1. Primary target + criterion
  const primary = `${radar.target} ${primaryCriterion}`.trim();
  if (primary) {
    queries.push(primary);
  }

  // 2. Geographic search
  if (radar.geography && radar.geography.trim().length > 0) {
    const geo = radar.geography.trim();
    queries.push(`${radar.target} brands in ${geo} official store`.trim());
  }

  // 3. Intent or offer synergy
  if (radar.intent && radar.intent.trim().length > 0) {
    queries.push(`${radar.target} ${radar.intent.trim()}`.trim());
  } else if (radar.offer && radar.offer.trim().length > 0) {
    queries.push(`${radar.target} ${radar.offer.trim()} ecommerce`.trim());
  }

  if (queries.length === 0) {
    queries.push(radar.target.trim() || "DTC brands");
  }

  // Deduplicate queries
  return Array.from(new Set(queries));
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

export type ResearchStatus = "successful" | "partial" | "blocked" | "timeout" | "unreachable";

export interface ResearchOutcome {
  candidate: CandidateCompany;
  status: ResearchStatus;
  page?: ScrapedPage;
  error?: string;
}

export interface ResearchResult {
  candidate: CandidateCompany;
  page: ScrapedPage;
  status?: ResearchStatus;
}

export interface DiscoveryRunResult {
  radarId: string;
  query: string;
  queries: string[];
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
  filterNonCompanyDomains?: boolean;
}

/**
 * Executes Phase 2.5 Live Discovery Pipeline:
 * Multi-Intent Search → Classification & Filtering → Normalize & Deduplicate →
 * Scrape/Research with Outcome Tracking → Observable Signals → Evidence-backed Qualification →
 * Opportunity Hypotheses → Contact Enrichment → Persistence.
 */
export async function runDiscoveryPipeline(
  radar: Radar,
  options: DiscoveryPipelineOptions,
): Promise<DiscoveryRunResult> {
  const startTime = Date.now();
  const maxCandidates = options.maxCandidates ?? 10;
  const maxResearch = options.maxResearch ?? 5;

  // 1. Build complementary search queries
  const queries = buildDiscoveryQueries(radar);
  logger.info({ radarId: radar.id, queries }, "Starting multi-intent live discovery search");

  // 2. Search candidates across queries
  const rawCandidates: CandidateCompany[] = [];
  let successfulQueries = 0;
  let lastError: unknown = null;

  for (const q of queries) {
    try {
      const candidates = await options.searchProvider.search(q, {
        limit: maxCandidates,
      });
      rawCandidates.push(...candidates);
      successfulQueries++;
    } catch (err) {
      lastError = err;
      logger.warn(
        { radarId: radar.id, query: q, err: err instanceof Error ? err.message : err },
        "Search query pass failed, proceeding with other queries",
      );
    }
  }

  // If every query failed due to provider error, distinguish provider failure from zero results
  if (successfulQueries === 0 && queries.length > 0 && lastError !== null) {
    throw lastError;
  }

  // 3. Domain classification: reject noise and prioritize company domains for research
  const nonNoiseCandidates: CandidateCompany[] = [];
  const rejectedNoise: Array<{ candidate: CandidateCompany; classification: CandidateClassification }> = [];

  for (const c of rawCandidates) {
    const classification = classifyCandidateDomain(c.url);
    if (classification.category === "noise") {
      rejectedNoise.push({ candidate: c, classification });
    } else if (options.filterNonCompanyDomains && !classification.isCompanyDomain) {
      rejectedNoise.push({ candidate: c, classification });
    } else {
      nonNoiseCandidates.push(c);
    }
  }

  if (rejectedNoise.length > 0) {
    logger.info(
      { radarId: radar.id, rejectedCount: rejectedNoise.length },
      "Filtered noise or non-company candidates",
    );
  }

  // 4. Normalize & Deduplicate
  const uniqueCandidates = deduplicateCandidates(nonNoiseCandidates);

  // Prioritize company_domain candidates first for research
  uniqueCandidates.sort((a, b) => {
    const aComp = classifyCandidateDomain(a.url).isCompanyDomain ? 1 : 0;
    const bComp = classifyCandidateDomain(b.url).isCompanyDomain ? 1 : 0;
    return bComp - aComp;
  });

  logger.info(
    {
      radarId: radar.id,
      rawCount: rawCandidates.length,
      filteredCount: nonNoiseCandidates.length,
      uniqueCount: uniqueCandidates.length,
    },
    "Candidates filtered, prioritized, normalized and deduplicated",
  );

  // 5. Research candidates (scrape public website) with outcome classification
  const toResearch = uniqueCandidates.slice(0, maxResearch);
  const researchResults: ResearchResult[] = [];

  for (const candidate of toResearch) {
    try {
      const page = await options.researchProvider.scrapePage(candidate.url, {
        timeoutMs: 15000,
      });
      const contentLength = (page.markdown || "").length + (page.description || "").length;
      const researchStatus: ResearchStatus = contentLength > 100 ? "successful" : "partial";
      researchResults.push({ candidate, page, status: researchStatus });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const researchStatus: ResearchStatus = message.toLowerCase().includes("timeout")
        ? "timeout"
        : message.toLowerCase().includes("blocked") || message.toLowerCase().includes("forbidden")
        ? "blocked"
        : "unreachable";

      logger.warn(
        { candidateUrl: candidate.url, status: researchStatus, err: message },
        "Research scrape failed or unreachable for candidate, continuing",
      );
    }
  }

  // 6. Transform researched candidates into qualified, evidence-backed Lead records
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
      status: "discovered",
      saved: false,
      contactVerified: enrichment.legacyContact.contactVerified,
      people: enrichment.people,
      contactPoints: allContactPoints,
      primaryContact: enrichment.primaryContact,
      enrichmentSummary: enrichment.summary,
    };
    lead.opportunityBrief = buildOpportunityBrief(lead);

    leads.push(lead);
  }

  // Sort leads by relevance score descending
  leads.sort((a, b) => b.relevance - a.relevance);

  // 7. Persist real results
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
    query: queries[0] ?? "",
    queries,
    candidatesDiscovered: uniqueCandidates.length,
    candidatesResearched: researchResults.length,
    leadsFound: leads.length,
    results: researchResults,
    leads,
    durationMs,
  };
}
