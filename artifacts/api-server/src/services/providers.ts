export type ConfidenceLevel = "high" | "medium" | "low";
export type EvidenceType = "VERIFIED" | "INFERRED" | "SUGGESTED";
export type EvidenceSourceStatus = "demo" | "connected" | "not_verified";
export type FitLevel = "HIGH RELEVANCE" | "POSSIBLE RELEVANCE" | "LOW RELEVANCE";

export interface CandidateCompany {
  name: string;
  url: string;
  domain: string;
  snippet?: string;
  source: string;
  discoveredAt: string;
}

export interface SearchResult {
  query: string;
  totalResults?: number;
  candidates: CandidateCompany[];
}

export interface ScrapedPage {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  markdown?: string;
  statusCode?: number;
  scrapedAt: string;
}

export type SignalCategory =
  | "ecommerce"
  | "content"
  | "social"
  | "hiring"
  | "branding"
  | "technology"
  | "absence";

export interface ObservableSignal {
  id: string;
  category: SignalCategory;
  key: string;
  statement: string;
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
  confidence: ConfidenceLevel;
  type: EvidenceType;
  excerpt?: string;
}

export interface Evidence {
  id: string;
  statement: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceStatus: EvidenceSourceStatus;
  observedAt: string;
  confidence?: ConfidenceLevel;
  type?: EvidenceType;
  excerpt?: string;
}

export interface ScoreFactor {
  factor: string;
  points: number;
  reason: string;
}

export interface ScoreBreakdown {
  baseScore: number;
  totalScore: number; // RADAR_RELEVANCE_SCORE (0 - 100 heuristic)
  fit: FitLevel;
  factors: ScoreFactor[];
}

export interface QualificationResult {
  fit: FitLevel;
  relevanceScore: number; // RADAR_RELEVANCE_SCORE
  scoreBreakdown: ScoreBreakdown;
  reasons: string[];
  signals: ObservableSignal[];
  evidence: Evidence[];
  opportunities: string[];
}

export interface Contact {
  founder?: string | null;
  publicEmail?: string | null;
  website?: string | null;
  instagram?: string | null;
  linkedin?: string | null;
  contactVerified: boolean;
  source?: string;
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly code: string;
  readonly retryable: boolean;
  readonly originalError?: unknown;

  constructor(
    message: string,
    options: {
      provider: string;
      code: string;
      retryable?: boolean;
      originalError?: unknown;
    },
  ) {
    super(message);
    Object.setPrototypeOf(this, ProviderError.prototype);
    this.name = "ProviderError";
    this.provider = options.provider;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.originalError = options.originalError;
  }
}

export interface SearchProvider {
  search(query: string, options?: { limit?: number }): Promise<CandidateCompany[]>;
}

export interface ResearchProvider {
  scrapePage(url: string, options?: { timeoutMs?: number }): Promise<ScrapedPage>;
}

/**
 * Interface reserved for future qualification/LLM reasoning (Phase 2.2).
 * Not invoked in Phase 2.1.
 */
export interface QualificationProvider {
  qualify(
    candidate: CandidateCompany,
    page: ScrapedPage,
    radar: {
      target: string;
      offer: string;
      criteria: string[];
    },
  ): Promise<QualificationResult>;
}

export interface EnrichmentProvider {
  enrich(candidate: CandidateCompany): Promise<Contact>;
}

export interface VerificationProvider {
  verify(contact: Contact): Promise<boolean>;
}

export interface LeadSource {
  name: string;
  connected: boolean;
  searchProvider?: SearchProvider;
  researchProvider?: ResearchProvider;
}

export const demoLeadSource: LeadSource = {
  name: "RADAR demo dataset",
  connected: false,
};