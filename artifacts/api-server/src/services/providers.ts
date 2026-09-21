export interface SearchProvider {
  search(query: string): Promise<unknown[]>;
}

export interface EnrichmentProvider {
  enrich(candidate: unknown): Promise<unknown>;
}

export interface VerificationProvider {
  verify(record: unknown): Promise<unknown>;
}

export interface LeadSource {
  name: string;
  connected: boolean;
  search: SearchProvider["search"];
}

export const demoLeadSource: LeadSource = {
  name: "RADAR demo dataset",
  connected: false,
  async search() {
    return [];
  },
};