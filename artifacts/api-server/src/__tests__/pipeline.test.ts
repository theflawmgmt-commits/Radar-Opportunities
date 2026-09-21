import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeUrl,
  extractDomain,
  deduplicateCandidates,
} from "../services/discovery-pipeline";
import { FirecrawlService } from "../services/firecrawl";
import { ProviderError, type CandidateCompany } from "../services/providers";

describe("Discovery Pipeline - URL Canonicalization", () => {
  it("strips tracking and analytics query parameters", () => {
    const input =
      "https://example.com/about?utm_source=google&utm_medium=cpc&utm_campaign=spring&fbclid=xyz&ref=producthunt";
    const canonical = canonicalizeUrl(input);
    assert.equal(canonical, "https://example.com/about");
  });

  it("retains meaningful functional query parameters", () => {
    const input = "https://example.com/page?id=123&category=tech&utm_source=twitter";
    const canonical = canonicalizeUrl(input);
    assert.equal(canonical, "https://example.com/page?category=tech&id=123");
  });

  it("removes trailing slashes from path", () => {
    const input = "https://example.com/portfolio/";
    const canonical = canonicalizeUrl(input);
    assert.equal(canonical, "https://example.com/portfolio");
  });

  it("removes URL hash fragments", () => {
    const input = "https://example.com/services#pricing";
    const canonical = canonicalizeUrl(input);
    assert.equal(canonical, "https://example.com/services");
  });

  it("normalizes protocol and lowercase domain", () => {
    const input = "HTTP://WWW.Example.COM/Home/";
    const canonical = canonicalizeUrl(input);
    assert.equal(canonical, "http://www.example.com/Home");
  });

  it("handles malformed URLs safely by trimming", () => {
    const input = "not a valid url";
    const canonical = canonicalizeUrl(input);
    assert.equal(canonical, "not a valid url");
  });
});

describe("Discovery Pipeline - Domain Extraction", () => {
  it("extracts hostname without www prefix", () => {
    assert.equal(extractDomain("https://www.company.com/products"), "company.com");
    assert.equal(extractDomain("https://company.com"), "company.com");
  });

  it("preserves subdomains other than www", () => {
    assert.equal(extractDomain("https://blog.company.com"), "blog.company.com");
    assert.equal(extractDomain("https://app.workspace.io/dashboard"), "app.workspace.io");
  });

  it("handles domain with port", () => {
    assert.equal(extractDomain("http://localhost:3000/api"), "localhost");
  });

  it("lowercases extracted domain", () => {
    assert.equal(extractDomain("https://WWW.ACME-CORP.ORG/"), "acme-corp.org");
  });
});

describe("Discovery Pipeline - Candidate Deduplication", () => {
  it("deduplicates candidates with identical canonical domain", () => {
    const candidates: CandidateCompany[] = [
      {
        name: "Acme Studios",
        url: "https://acme.com/home",
        domain: "acme.com",
        source: "firecrawl",
        discoveredAt: new Date().toISOString(),
      },
      {
        name: "Acme",
        url: "https://www.acme.com/?utm_source=test",
        domain: "acme.com",
        source: "firecrawl",
        discoveredAt: new Date().toISOString(),
      },
    ];

    const deduplicated = deduplicateCandidates(candidates);
    assert.equal(deduplicated.length, 1);
    assert.equal(deduplicated[0].name, "Acme Studios");
  });

  it("deduplicates candidates with identical normalized company name", () => {
    const candidates: CandidateCompany[] = [
      {
        name: "Blue Ocean Cafe, Inc.",
        url: "https://blueocean.com",
        domain: "blueocean.com",
        source: "firecrawl",
        discoveredAt: new Date().toISOString(),
      },
      {
        name: "blue ocean cafe",
        url: "https://blueoceancoffee.net",
        domain: "blueoceancoffee.net",
        source: "firecrawl",
        discoveredAt: new Date().toISOString(),
      },
    ];

    const deduplicated = deduplicateCandidates(candidates);
    assert.equal(deduplicated.length, 1);
    assert.equal(deduplicated[0].name, "Blue Ocean Cafe, Inc.");
  });

  it("preserves distinct companies", () => {
    const candidates: CandidateCompany[] = [
      {
        name: "Alpha Goods",
        url: "https://alpha.com",
        domain: "alpha.com",
        source: "firecrawl",
        discoveredAt: new Date().toISOString(),
      },
      {
        name: "Beta Labs",
        url: "https://beta.io",
        domain: "beta.io",
        source: "firecrawl",
        discoveredAt: new Date().toISOString(),
      },
    ];

    const deduplicated = deduplicateCandidates(candidates);
    assert.equal(deduplicated.length, 2);
  });
});

describe("Firecrawl Service - Error Handling & Guardrails", () => {
  it("reports not configured when API key is unset", () => {
    const prevKey = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    try {
      const service = new FirecrawlService({ apiKey: "" });
      assert.equal(service.isConfigured(), false);
    } finally {
      if (prevKey) process.env.FIRECRAWL_API_KEY = prevKey;
    }
  });

  it("throws MISSING_API_KEY ProviderError on search when unconfigured", async () => {
    const prevKey = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    try {
      const service = new FirecrawlService({ apiKey: "" });
      await assert.rejects(
        async () => {
          await service.search("design agencies in Portland");
        },
        (err: unknown) => {
          const providerErr = err as ProviderError;
          assert.equal(providerErr.code, "MISSING_API_KEY");
          assert.equal(providerErr.provider, "firecrawl");
          assert(providerErr.message.includes("Firecrawl API key is missing"));
          return true;
        },
      );
    } finally {
      if (prevKey) process.env.FIRECRAWL_API_KEY = prevKey;
    }
  });

  it("throws MISSING_API_KEY ProviderError on scrape when unconfigured", async () => {
    const prevKey = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    try {
      const service = new FirecrawlService({ apiKey: "" });
      await assert.rejects(
        async () => {
          await service.scrapePage("https://example.com");
        },
        (err: unknown) => {
          const providerErr = err as ProviderError;
          assert.equal(providerErr.code, "MISSING_API_KEY");
          assert.equal(providerErr.provider, "firecrawl");
          return true;
        },
      );
    } finally {
      if (prevKey) process.env.FIRECRAWL_API_KEY = prevKey;
    }
  });

  it("ProviderError carries structured details", () => {
    const error = new ProviderError("Rate limit exceeded", {
      code: "RATE_LIMITED",
      provider: "firecrawl",
      retryable: true,
      originalError: { status: 429 },
    });
    assert.equal(error.name, "ProviderError");
    assert.equal(error.message, "Rate limit exceeded");
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.provider, "firecrawl");
    assert.equal(error.retryable, true);
  });
});
