import FirecrawlApp from "@mendable/firecrawl-js";
import {
  CandidateCompany,
  ProviderError,
  ResearchProvider,
  ScrapedPage,
  SearchProvider,
} from "./providers";

export interface FirecrawlServiceConfig {
  apiKey?: string;
  apiUrl?: string;
}

export class FirecrawlService implements SearchProvider, ResearchProvider {
  private client: FirecrawlApp | null = null;
  private apiKey: string | null = null;

  constructor(config?: FirecrawlServiceConfig) {
    this.apiKey = config?.apiKey || process.env.FIRECRAWL_API_KEY || null;
    if (this.apiKey) {
      this.client = new FirecrawlApp({
        apiKey: this.apiKey,
        apiUrl: config?.apiUrl,
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.client);
  }

  private ensureClient(): FirecrawlApp {
    // Re-check process.env if not initialized earlier
    if (!this.client) {
      const envKey = process.env.FIRECRAWL_API_KEY;
      if (envKey) {
        this.apiKey = envKey;
        this.client = new FirecrawlApp({ apiKey: envKey });
      }
    }

    if (!this.client || !this.apiKey) {
      throw new ProviderError(
        "Firecrawl API key is missing. Set FIRECRAWL_API_KEY in server environment to enable Live Mode.",
        { provider: "firecrawl", code: "MISSING_API_KEY", retryable: false },
      );
    }
    return this.client;
  }

  async search(
    query: string,
    options?: { limit?: number },
  ): Promise<CandidateCompany[]> {
    const client = this.ensureClient();
    const limit = options?.limit ?? 10;

    try {
      const response = await client.search(query, { limit });

      const rawItems = Array.isArray(response)
        ? response
        : (response as { data?: unknown[] })?.data ?? [];

      const candidates: CandidateCompany[] = [];
      const discoveredAt = new Date().toISOString();

      for (const item of rawItems as Array<{
        title?: string;
        url?: string;
        description?: string;
        markdown?: string;
      }>) {
        if (!item.url) continue;

        let domain = "";
        try {
          domain = new URL(item.url).hostname.replace(/^www\./i, "");
        } catch {
          domain = item.url;
        }

        const name =
          item.title?.split(/[-|–:]/)[0]?.trim() ||
          domain ||
          "Unknown Company";

        candidates.push({
          name,
          url: item.url,
          domain,
          snippet: item.description || item.markdown?.slice(0, 200) || "",
          source: "firecrawl:search",
          discoveredAt,
        });
      }

      return candidates;
    } catch (error: unknown) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimit = message.includes("429") || message.toLowerCase().includes("rate limit");
      const isAuthError = message.includes("401") || message.toLowerCase().includes("unauthorized");

      throw new ProviderError(`Firecrawl search failed: ${message}`, {
        provider: "firecrawl",
        code: isRateLimit ? "RATE_LIMIT" : isAuthError ? "UNAUTHORIZED" : "SEARCH_FAILED",
        retryable: isRateLimit,
        originalError: error,
      });
    }
  }

  async scrapePage(
    url: string,
    options?: { timeoutMs?: number },
  ): Promise<ScrapedPage> {
    const client = this.ensureClient();
    const scrapedAt = new Date().toISOString();

    let domain = "";
    try {
      domain = new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      domain = url;
    }

    try {
      const response = await client.scrape(url, {
        formats: ["markdown"],
      });

      const data = (response as {
        data?: {
          markdown?: string;
          metadata?: { title?: string; description?: string; statusCode?: number };
        };
        markdown?: string;
        metadata?: { title?: string; description?: string; statusCode?: number };
      });

      const content = data?.data ?? data;
      const metadata = content?.metadata;

      return {
        url,
        domain,
        title: metadata?.title || "",
        description: metadata?.description || "",
        markdown: content?.markdown || "",
        statusCode: metadata?.statusCode || 200,
        scrapedAt,
      };
    } catch (error: unknown) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimit = message.includes("429") || message.toLowerCase().includes("rate limit");
      const isTimeout = message.toLowerCase().includes("timeout") || message.includes("504");

      throw new ProviderError(`Firecrawl scrape failed for ${url}: ${message}`, {
        provider: "firecrawl",
        code: isRateLimit ? "RATE_LIMIT" : isTimeout ? "TIMEOUT" : "SCRAPE_FAILED",
        retryable: isRateLimit || isTimeout,
        originalError: error,
      });
    }
  }
}

export const firecrawlService = new FirecrawlService();
