import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscoveryQueries,
  classifyCandidateDomain,
  filterCompanyCandidates,
  deduplicateCandidates,
  runDiscoveryPipeline,
} from "../services/discovery-pipeline";
import type { Radar } from "@workspace/api-zod";
import type { CandidateCompany, ResearchProvider, SearchProvider } from "../services/providers";

describe("Phase 2.5 — Real-World Discovery Reliability", () => {
  describe("Multi-Intent Query Generation", () => {
    it("generates primary, geographic, and intent queries when all fields are present", () => {
      const radar: Radar = {
        id: "radar-geo-intent",
        name: "Specialty Tea Radar",
        description: "Discover artisan tea brands",
        target: "Artisan tea brands",
        offer: "Direct-to-consumer email marketing sequences",
        geography: "India",
        intent: "Loose-leaf estate tea brands with online checkout",
        criteria: ["Direct to consumer store", "Single origin estates"],
        status: "active",
        leadCount: 0,
      };

      const queries = buildDiscoveryQueries(radar);
      assert.ok(queries.length >= 3, `Expected at least 3 queries, got ${queries.length}`);
      assert.ok(queries.some((q) => q.includes("Artisan tea brands") && q.includes("Direct to consumer store")));
      assert.ok(queries.some((q) => q.includes("India") && q.includes("official store")));
      assert.ok(queries.some((q) => q.includes("Loose-leaf estate tea brands with online checkout")));
    });

    it("falls back to offer synergy when intent is omitted", () => {
      const radar: Radar = {
        id: "radar-no-intent",
        name: "Ceramics UGC",
        description: "Artisanal ceramics",
        target: "Handcrafted ceramics brands",
        offer: "Short-form video packages",
        criteria: ["Online store"],
        status: "active",
        leadCount: 0,
      };

      const queries = buildDiscoveryQueries(radar);
      assert.ok(queries.length >= 2);
      assert.ok(queries.some((q) => q.includes("Short-form video packages") && q.includes("ecommerce")));
    });

    it("deduplicates redundant queries", () => {
      const radar: Radar = {
        id: "radar-minimal",
        name: "Simple Radar",
        description: "Simple test",
        target: "Sneaker care",
        offer: "",
        criteria: [],
        status: "active",
        leadCount: 0,
      };

      const queries = buildDiscoveryQueries(radar);
      const uniqueSet = new Set(queries);
      assert.equal(queries.length, uniqueSet.size, "Queries must be unique");
    });
  });

  describe("Candidate Domain Classification & Noise Rejection", () => {
    it("accurately classifies legitimate direct company domains", () => {
      const validUrls = [
        "https://allbirds.com",
        "https://www.gymshark.com/collections/new",
        "https://bluetokaicoffee.com/products/roast",
        "https://subdomain.artisanalroasters.co.uk",
        "https://shop.carawayhome.com",
      ];

      for (const url of validUrls) {
        const result = classifyCandidateDomain(url);
        assert.equal(
          result.category,
          "company_domain",
          `Expected ${url} to be classified as company_domain, got ${result.category}`,
        );
        assert.equal(result.isCompanyDomain, true);
      }
    });

    it("identifies and rejects public marketplaces", () => {
      const marketplaces = [
        "https://www.amazon.in/dp/B08XYZ",
        "https://www.flipkart.com/shoes/p/itm123",
        "https://www.etsy.com/shop/handcraftedpottery",
        "https://www.ebay.com/itm/456",
        "https://www.walmart.com/ip/brand/789",
        "https://www.myntra.com/tshirts/brand",
        "https://www.ajio.com/clothing/c/123",
      ];

      for (const url of marketplaces) {
        const result = classifyCandidateDomain(url);
        assert.equal(result.category, "marketplace", `Expected ${url} to be marketplace`);
        assert.equal(result.isCompanyDomain, false);
      }
    });

    it("identifies and rejects business directories and aggregators", () => {
      const directories = [
        "https://clutch.co/profile/some-agency",
        "https://www.g2.com/products/example/reviews",
        "https://www.yellowpages.com/search?geo=us",
        "https://www.crunchbase.com/organization/techcorp",
        "https://www.zoominfo.com/c/company-inc/123",
        "https://www.yelp.com/biz/local-store",
      ];

      for (const url of directories) {
        const result = classifyCandidateDomain(url);
        assert.equal(result.category, "directory", `Expected ${url} to be directory`);
        assert.equal(result.isCompanyDomain, false);
      }
    });

    it("identifies and rejects customer review platforms", () => {
      const reviews = [
        "https://www.trustpilot.com/review/example.com",
        "https://www.sitejabber.com/reviews/example.com",
        "https://www.glassdoor.com/Reviews/company-reviews.htm",
      ];

      for (const url of reviews) {
        const result = classifyCandidateDomain(url);
        assert.equal(result.category, "review_site", `Expected ${url} to be review_site`);
        assert.equal(result.isCompanyDomain, false);
      }
    });

    it("identifies and rejects social profiles", () => {
      const socials = [
        "https://instagram.com/artisancraft",
        "https://facebook.com/artisancraft",
        "https://twitter.com/artisancraft",
        "https://x.com/artisancraft",
        "https://tiktok.com/@artisancraft",
        "https://linkedin.com/company/artisancraft",
        "https://youtube.com/@artisancraft",
      ];

      for (const url of socials) {
        const result = classifyCandidateDomain(url);
        assert.equal(result.category, "social_profile", `Expected ${url} to be social_profile`);
        assert.equal(result.isCompanyDomain, false);
      }
    });

    it("identifies and rejects editorial roundups and listicles", () => {
      const editorials = [
        "https://forbes.com/sites/writer/2026/01/top-10-sustainable-brands",
        "https://medium.com/@analyst/the-best-dtc-brands-in-2026",
        "https://techcrunch.com/2026/startup-funding",
        "https://www.vogue.com/article/top-skincare-trends",
        "https://somerandomsite.com/blog/10-best-coffee-brands-in-india",
      ];

      for (const url of editorials) {
        const result = classifyCandidateDomain(url);
        assert.equal(result.category, "editorial_article", `Expected ${url} to be editorial_article`);
        assert.equal(result.isCompanyDomain, false);
      }
    });

    it("identifies and rejects noise subdomains and invalid URLs", () => {
      const noise = [
        "",
        "not-a-url",
        "https://cdn.shopify.com/s/files/1/00/asset.jpg",
        "https://auth.somebrand.com/oauth/login",
        "https://login.somebrand.com",
        "https://status.somebrand.com",
        "https://support.somebrand.com/tickets",
      ];

      for (const url of noise) {
        const result = classifyCandidateDomain(url);
        assert.equal(result.category, "noise", `Expected ${url} to be noise`);
        assert.equal(result.isCompanyDomain, false);
      }
    });

    it("filterCompanyCandidates partitions valid companies and rejected candidates with reasons", () => {
      const candidates: CandidateCompany[] = [
        {
          name: "Loom & Spindle",
          url: "https://loomandspindle.com",
          domain: "loomandspindle.com",
          snippet: "Handwoven blankets.",
          source: "mock",
          discoveredAt: new Date().toISOString(),
        },
        {
          name: "Amazon Listing",
          url: "https://amazon.com/dp/B001",
          domain: "amazon.com",
          snippet: "Blanket on Amazon",
          source: "mock",
          discoveredAt: new Date().toISOString(),
        },
        {
          name: "Yelp Reviews",
          url: "https://yelp.com/biz/loom",
          domain: "yelp.com",
          snippet: "Reviews on Yelp",
          source: "mock",
          discoveredAt: new Date().toISOString(),
        },
      ];

      const { valid, rejected } = filterCompanyCandidates(candidates);
      assert.equal(valid.length, 1);
      assert.equal(valid[0].name, "Loom & Spindle");
      assert.equal(rejected.length, 2);
      assert.ok(rejected.some((r) => r.classification.category === "marketplace"));
      assert.ok(rejected.some((r) => r.classification.category === "directory"));
    });
  });

  describe("Prioritization and Research Outcome Handling", () => {
    it("prioritizes direct company domains over directory candidates in the pipeline", async () => {
      const mockSearch: SearchProvider = {
        async search() {
          return [
            {
              name: "Clutch Directory",
              url: "https://clutch.co/apparel",
              domain: "clutch.co",
              snippet: "Agency directory",
              source: "mock",
              discoveredAt: new Date().toISOString(),
            },
            {
              name: "Nua Care",
              url: "https://nuacare.com",
              domain: "nuacare.com",
              snippet: "Feminine care brand with modern packaging",
              source: "mock",
              discoveredAt: new Date().toISOString(),
            },
          ];
        },
      };

      const scrapedOrder: string[] = [];
      const mockResearch: ResearchProvider = {
        async scrapePage(url: string) {
          scrapedOrder.push(url);
          return {
            url,
            domain: "test.com",
            title: "Test Store",
            markdown: "Store content with active checkout and catalog. Over 100 characters of meaningful content.",
            scrapedAt: new Date().toISOString(),
          };
        },
      };

      const radar: Radar = {
        id: "radar-priority-test",
        name: "Wellness",
        description: "Wellness brands",
        target: "Wellness DTC",
        offer: "UGC video",
        criteria: ["Online store"],
        status: "active",
        leadCount: 0,
      };

      const result = await runDiscoveryPipeline(radar, {
        searchProvider: mockSearch,
        researchProvider: mockResearch,
        maxResearch: 2,
      });

      // Company domain must have been scraped FIRST due to priority sorting
      assert.ok(scrapedOrder[0].includes("nuacare.com"), "Company domain must be scraped before directory");
      assert.equal(result.leads.length, 2);
      assert.equal(result.leads[0].status, "discovered", "Discovered leads must have status: discovered");
    });

    it("gracefully tolerates partial scrape and network timeout errors", async () => {
      const mockSearch: SearchProvider = {
        async search() {
          return [
            {
              name: "Timeout Brand",
              url: "https://timeout-brand.example.com",
              domain: "timeout-brand.example.com",
              snippet: "A slow website",
              source: "mock",
              discoveredAt: new Date().toISOString(),
            },
            {
              name: "Active Brand",
              url: "https://active-brand.example.com",
              domain: "active-brand.example.com",
              snippet: "An active brand",
              source: "mock",
              discoveredAt: new Date().toISOString(),
            },
          ];
        },
      };

      const mockResearch: ResearchProvider = {
        async scrapePage(url: string) {
          if (url.includes("timeout")) {
            throw new Error("Scrape request timed out after 15000ms");
          }
          return {
            url,
            domain: "active-brand.example.com",
            title: "Active Brand Store",
            markdown: "Shop our active line. Add to cart. Organic cotton apparel and seasonal items.",
            scrapedAt: new Date().toISOString(),
          };
        },
      };

      const radar: Radar = {
        id: "radar-resilience-test",
        name: "Resilience",
        description: "Test error handling",
        target: "Apparel DTC",
        offer: "Social ads",
        criteria: ["Store"],
        status: "active",
        leadCount: 0,
      };

      const result = await runDiscoveryPipeline(radar, {
        searchProvider: mockSearch,
        researchProvider: mockResearch,
      });

      // Pipeline continues and produces the successful lead
      assert.equal(result.leads.length, 1);
      assert.equal(result.leads[0].companyName, "Active Brand");
      assert.equal(result.leads[0].status, "discovered");
    });

    it("returns zero leads and NEVER injects mock/demo leads when search returns zero candidates", async () => {
      const emptySearch: SearchProvider = {
        async search() {
          return [];
        },
      };

      const emptyResearch: ResearchProvider = {
        async scrapePage() {
          throw new Error("Should not be called");
        },
      };

      const radar: Radar = {
        id: "radar-zero-candidates",
        name: "Zero Candidates Test",
        description: "Verify no mock injection",
        target: "Rare esoteric vertical",
        offer: "Specialized service",
        criteria: ["Unique signal"],
        status: "active",
        leadCount: 0,
      };

      const result = await runDiscoveryPipeline(radar, {
        searchProvider: emptySearch,
        researchProvider: emptyResearch,
      });

      assert.equal(result.leadsFound, 0);
      assert.equal(result.leads.length, 0);
      assert.equal(result.candidatesDiscovered, 0);
    });

    it("distinguishes complete provider failure from zero results when every query throws", async () => {
      const failingSearch: SearchProvider = {
        async search() {
          throw new Error("Firecrawl search failed: 429 Too Many Requests");
        },
      };

      const unusedResearch: ResearchProvider = {
        async scrapePage() {
          throw new Error("Should not be called");
        },
      };

      const radar: Radar = {
        id: "radar-rate-limit-test",
        name: "Rate Limit Test",
        description: "Verify provider failure propagation",
        target: "Coffee brands",
        offer: "Video ads",
        criteria: ["Store"],
        status: "active",
        leadCount: 0,
      };

      await assert.rejects(
        async () => {
          await runDiscoveryPipeline(radar, {
            searchProvider: failingSearch,
            researchProvider: unusedResearch,
          });
        },
        (err: Error) => {
          assert.ok(err.message.includes("429 Too Many Requests"));
          return true;
        },
        "Must rethrow provider error when all queries fail so caller can distinguish from 0 results",
      );
    });

    it("tolerates 429 rate limit on initial query pass and succeeds on subsequent queries", async () => {
      let callCount = 0;
      const resilientSearch: SearchProvider = {
        async search() {
          callCount++;
          if (callCount === 1) {
            throw new Error("Firecrawl search failed: 429 Too Many Requests");
          }
          return [
            {
              name: "Recovered Brand",
              url: "https://recovered-brand.example.com",
              domain: "recovered-brand.example.com",
              snippet: "Discovered on query pass 2",
              source: "test",
              discoveredAt: new Date().toISOString(),
            },
          ];
        },
      };

      const mockResearch: ResearchProvider = {
        async scrapePage(url: string) {
          return {
            url,
            domain: "recovered-brand.example.com",
            title: "Recovered Brand Online",
            markdown: "Welcome to our store with online checkout and cart. Meaningful content over 100 characters.",
            scrapedAt: new Date().toISOString(),
          };
        },
      };

      const radar: Radar = {
        id: "radar-partial-rate-limit",
        name: "Partial Rate Limit Test",
        description: "Verify recovery across multiple query passes",
        target: "Apparel",
        offer: "Video ads",
        geography: "India",
        intent: "DTC stores",
        criteria: ["Online checkout"],
        status: "active",
        leadCount: 0,
      };

      const result = await runDiscoveryPipeline(radar, {
        searchProvider: resilientSearch,
        researchProvider: mockResearch,
      });

      assert.ok(callCount >= 2, "Expected multiple query attempts");
      assert.equal(result.leadsFound, 1);
      assert.equal(result.leads[0].companyName, "Recovered Brand");
    });
  });
});

