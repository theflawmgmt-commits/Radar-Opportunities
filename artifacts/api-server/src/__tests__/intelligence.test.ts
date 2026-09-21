import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractObservableSignals,
  evaluateTargetAlignment,
  evaluateCriteria,
  generateOpportunityHypotheses,
  calculateRelevanceScore,
  qualifyCandidate,
  SIGNAL_KEYS,
} from "../services/intelligence";
import { runDiscoveryPipeline } from "../services/discovery-pipeline";
import { leads as demoLeads } from "../services/radar-data";
import type { CandidateCompany, ScrapedPage, SearchProvider, ResearchProvider } from "../services/providers";
import { GetLeadResponse, ListLeadsResponse, type Radar } from "@workspace/api-zod";

describe("Phase 2.2 RADAR Intelligence — Signal Extraction", () => {
  const sampleCandidate: CandidateCompany = {
    name: "Aura Home Goods",
    url: "https://aurahome.com",
    domain: "aurahome.com",
    snippet: "Modern sustainable home essentials and linens.",
    source: "firecrawl",
    discoveredAt: new Date().toISOString(),
  };

  it("extracts e-commerce signals only when multiple corroborating indicators are present", () => {
    // 1. Single indicator only -> should NOT emit e-commerce signal (avoids single-keyword false positives)
    const singleIndicatorPage: ScrapedPage = {
      url: "https://aurahome.com",
      domain: "aurahome.com",
      title: "Aura Home",
      markdown: "We believe in sustainable D2C principles. Read our article on modern living.",
      scrapedAt: new Date().toISOString(),
    };
    const signalsSingle = extractObservableSignals(singleIndicatorPage, sampleCandidate);
    assert.equal(
      signalsSingle.some((s) => s.key === SIGNAL_KEYS.ECOMMERCE_STORE),
      false,
      "Single keyword mention should not trigger e-commerce store signal",
    );

    // 2. Multiple corroborating indicators: cart action + pricing + collections catalog
    const multiIndicatorPage: ScrapedPage = {
      url: "https://aurahome.com",
      domain: "aurahome.com",
      title: "Aura Home - Organic Linen Sheets",
      markdown: `
        # Summer Collection
        Browse our collections/sheets.
        Linen Duvet Set - $189.00 USD
        [Add to Cart] [Buy Now]
        Powered by Shopify checkout.
      `,
      scrapedAt: new Date().toISOString(),
    };
    const signalsMulti = extractObservableSignals(multiIndicatorPage, sampleCandidate);
    const storeSignal = signalsMulti.find((s) => s.key === SIGNAL_KEYS.ECOMMERCE_STORE);
    assert.ok(storeSignal, "Multiple indicators must trigger e-commerce signal");
    assert.equal(storeSignal.type, "VERIFIED");
    assert.equal(storeSignal.confidence, "high");
  });

  it("treats video absence carefully within the scope of researched pages", () => {
    const noVideoPage: ScrapedPage = {
      url: "https://aurahome.com/products/linen-sheet",
      domain: "aurahome.com",
      title: "Linen Sheet",
      markdown: "High quality sheets. Free shipping on orders over $50.",
      scrapedAt: new Date().toISOString(),
    };

    const signals = extractObservableSignals(noVideoPage, sampleCandidate);
    const videoSignal = signals.find((s) => s.key === SIGNAL_KEYS.VIDEO_NOT_OBSERVED);

    assert.ok(videoSignal, "Must record VIDEO_NOT_OBSERVED_IN_RESEARCHED_PAGES");
    assert.equal(videoSignal.confidence, "medium", "Absence must have lower confidence than direct observation");
    assert.equal(videoSignal.type, "VERIFIED");
    assert.match(
      videoSignal.statement,
      /no embedded video player or video tags were observed on that page/i,
      "Statement must be explicitly scoped to the researched page",
    );
    assert.doesNotMatch(
      videoSignal.statement,
      /this company has no video/i,
      "Must never declare global absence for the entire company",
    );
  });

  it("extracts positive video presence when embedded player is detected", () => {
    const videoPage: ScrapedPage = {
      url: "https://aurahome.com",
      domain: "aurahome.com",
      title: "Aura Home",
      markdown: 'Watch our story: <iframe src="https://www.youtube.com/embed/xyz123"></iframe>',
      scrapedAt: new Date().toISOString(),
    };

    const signals = extractObservableSignals(videoPage, sampleCandidate);
    const videoSignal = signals.find((s) => s.key === SIGNAL_KEYS.EMBEDDED_VIDEO_OBSERVED);
    assert.ok(videoSignal);
    assert.equal(videoSignal.confidence, "high");
    assert.equal(videoSignal.type, "VERIFIED");
  });

  it("extracts public social links as observable signals without contact enrichment", () => {
    const pageWithSocial: ScrapedPage = {
      url: "https://aurahome.com",
      domain: "aurahome.com",
      title: "Aura Home",
      markdown: "Follow us on https://instagram.com/aurahome and https://tiktok.com/@aurahome_official",
      scrapedAt: new Date().toISOString(),
    };

    const signals = extractObservableSignals(pageWithSocial, sampleCandidate);
    const socialSig = signals.find((s) => s.key === SIGNAL_KEYS.ACTIVE_SOCIAL_CHANNELS);
    assert.ok(socialSig);
    assert.equal(socialSig.category, "social");
    assert.match(socialSig.statement, /Instagram/i);
    assert.match(socialSig.statement, /TikTok/i);
  });
});

describe("Phase 2.2 RADAR Intelligence — Target & Criteria Matching", () => {
  const candidate: CandidateCompany = {
    name: "Driftwood Apparel",
    url: "https://driftwoodapparel.com",
    domain: "driftwoodapparel.com",
    snippet: "Eco-friendly surf wear and outdoor clothing.",
    source: "firecrawl",
    discoveredAt: new Date().toISOString(),
  };

  it("requires multiple corroborating indicators for target audience matching", () => {
    const page: ScrapedPage = {
      url: "https://driftwoodapparel.com",
      domain: "driftwoodapparel.com",
      title: "Driftwood Apparel - Sustainable Surf Wear",
      description: "Direct-to-consumer sustainable apparel crafted for the coast.",
      markdown: "Add to cart. $68 USD. View our apparel collection.",
      scrapedAt: new Date().toISOString(),
    };
    const signals = extractObservableSignals(page, candidate);
    const target = "Direct-to-consumer sustainable apparel brands";

    const alignment = evaluateTargetAlignment(target, page, candidate, signals);
    assert.ok(alignment.matchedIndicators.length >= 2, "Must match multiple indicators");
    assert.ok(alignment.score >= 20, "Corroborated target alignment receives high base score");
  });

  it("penalizes aggregator and directory domains", () => {
    const aggregatorCandidate: CandidateCompany = {
      name: "Clutch Directory",
      url: "https://clutch.co/profile/some-firm",
      domain: "clutch.co",
      source: "firecrawl",
      discoveredAt: new Date().toISOString(),
    };
    const page: ScrapedPage = {
      url: "https://clutch.co/profile/some-firm",
      domain: "clutch.co",
      title: "Top Apparel Agencies on Clutch",
      markdown: "Directory of apparel agencies and vendors.",
      scrapedAt: new Date().toISOString(),
    };
    const signals = extractObservableSignals(page, aggregatorCandidate);
    const alignment = evaluateTargetAlignment("Apparel brands", page, aggregatorCandidate, signals);
    assert.ok(alignment.score < 0, "Directory portals must receive negative score");
    assert.match(alignment.matchedIndicators[0], /directory\/aggregator/i);
  });

  it("evaluates positive criteria matches and penalizes negative criteria hits", () => {
    const page: ScrapedPage = {
      url: "https://driftwoodapparel.com",
      domain: "driftwoodapparel.com",
      title: "Driftwood Apparel",
      markdown: "Shop our store. Cart checkout. No agencies or intermediaries. We're hiring designers!",
      scrapedAt: new Date().toISOString(),
    };
    const signals = extractObservableSignals(page, candidate);

    const criteria = [
      "Active Shopify or e-commerce store",
      "Hiring for creative roles",
      "No agencies",
    ];

    const { factors, matchedCount } = evaluateCriteria(criteria, page, signals);
    assert.ok(matchedCount >= 1, "Should match positive criteria");
    // "No agencies" criterion should detect negative match since "agency" is mentioned in page text
    const negFactor = factors.find((f) => f.factor.includes("Negative criterion"));
    assert.ok(negFactor, "Negative criterion must produce a negative score factor");
    assert.ok(negFactor.points < 0);
  });
});

describe("Phase 2.2 RADAR Intelligence — Opportunity Hypotheses & Scoring", () => {
  it("generates inferential opportunity hypotheses that avoid definitive declarations", () => {
    const candidate: CandidateCompany = {
      name: "Solace Botanicals",
      url: "https://solacebotanicals.com",
      domain: "solacebotanicals.com",
      source: "firecrawl",
      discoveredAt: new Date().toISOString(),
    };
    const page: ScrapedPage = {
      url: "https://solacebotanicals.com",
      domain: "solacebotanicals.com",
      title: "Solace Botanicals - Natural Skincare",
      markdown: "Shop organic cleansers. $34 USD. [Add to Cart]",
      scrapedAt: new Date().toISOString(),
    };
    const signals = extractObservableSignals(page, candidate);
    const offer = "Short-form video ads and UGC creative strategy";

    const { hypotheses, synergyFactor } = generateOpportunityHypotheses(
      offer,
      "Organic skincare brands",
      signals,
      page,
    );

    assert.ok(hypotheses.length > 0);
    for (const h of hypotheses) {
      assert.match(
        h,
        /\b(may create an opportunity|potential angle to explore|could provide|could represent)\b/i,
        "Hypothesis must use inferential language",
      );
      assert.doesNotMatch(
        h,
        /\b(needs|must have|definitely requires)\b/i,
        "Hypothesis must never declare definitive need",
      );
    }
    assert.ok(synergyFactor, "Synergy factor should be awarded when offer addresses an observed gap");
    assert.ok(synergyFactor.points > 0);
  });

  it("calculates RADAR_RELEVANCE_SCORE as a 0-100 heuristic with recalibrated base score of 5", () => {
    const breakdown = calculateRelevanceScore(
      { matchedIndicators: ["Direct audience terms matched", "Consumer store verified"], score: 25 },
      {
        factors: [
          { factor: 'Matched criterion: "Active store"', points: 15, reason: "Store active (First match in commerce category)" },
          { factor: 'Matched criterion: "Hiring for design"', points: 15, reason: "Hiring cues found (First match in hiring category)" },
        ],
        matchedCount: 2,
      },
      [
        {
          id: "s1",
          category: "ecommerce",
          key: SIGNAL_KEYS.ECOMMERCE_STORE,
          statement: "Store detected",
          sourceUrl: "https://example.com",
          sourceName: "Example",
          observedAt: new Date().toISOString(),
          confidence: "high",
          type: "VERIFIED",
        },
        {
          id: "s2",
          category: "social",
          key: SIGNAL_KEYS.ACTIVE_SOCIAL_CHANNELS,
          statement: "Social links detected",
          sourceUrl: "https://example.com",
          sourceName: "Example",
          observedAt: new Date().toISOString(),
          confidence: "high",
          type: "VERIFIED",
        },
        {
          id: "s3",
          category: "hiring",
          key: SIGNAL_KEYS.HIRING_SIGNAL,
          statement: "Hiring cues detected",
          sourceUrl: "https://example.com",
          sourceName: "Example",
          observedAt: new Date().toISOString(),
          confidence: "high",
          type: "VERIFIED",
        },
      ],
      { factor: "Offer synergy: Video creative", points: 15, reason: "Video gap" },
    );

    // Base 5 + 25 (target) + 15 + 15 (criteria) + 15 (synergy) + 10 (operational breadth: social + hiring) = 85
    assert.equal(breakdown.baseScore, 5, "Base score must be recalibrated to 5");
    assert.equal(breakdown.totalScore, 85);
    assert.equal(breakdown.fit, "HIGH RELEVANCE");
    assert.ok(breakdown.factors.length >= 4);

    // Low score should map to LOW RELEVANCE and clamp to 0
    const lowBreakdown = calculateRelevanceScore(
      { matchedIndicators: ["Directory portal detected"], score: -35 },
      { factors: [], matchedCount: 0 },
      [],
    );
    assert.equal(lowBreakdown.totalScore, 0, "Score with penalty must clamp at 0");
    assert.equal(lowBreakdown.fit, "LOW RELEVANCE");
  });

  it("deduplicates overlapping criteria within the same semantic category", () => {
    const page: ScrapedPage = {
      url: "https://examplebrand.com",
      domain: "examplebrand.com",
      title: "Example Brand",
      markdown: "Shop our apparel. Add to cart. Checkout. Direct to consumer brand. View product catalog.",
      scrapedAt: new Date().toISOString(),
    };
    const signals = [
      {
        id: "s1",
        category: "ecommerce" as const,
        key: SIGNAL_KEYS.ECOMMERCE_STORE,
        statement: "Store detected",
        sourceUrl: "https://examplebrand.com",
        sourceName: "Example Brand",
        observedAt: new Date().toISOString(),
        confidence: "high" as const,
        type: "VERIFIED" as const,
      },
    ];

    // 4 overlapping commerce criteria
    const criteria = [
      "Active Shopify or e-commerce store",
      "D2C consumer brand",
      "Sells directly to consumers",
      "Online store checkout",
      "Product catalog available",
    ];

    const { factors, matchedCount } = evaluateCriteria(criteria, page, signals);
    assert.equal(matchedCount, 5, "All 5 criteria should match");

    // First match in commerce category gets +15
    assert.equal(factors[0].points, 15);
    // Additional matches in commerce category get +5
    assert.equal(factors[1].points, 5);
    assert.equal(factors[2].points, 5);
    assert.equal(factors[3].points, 5);
    // 5th match: 15 + 5 + 5 + 5 = 30 (cap reached), so 5th gets 0
    assert.equal(factors[4].points, 0);

    const totalPositive = factors.reduce((sum, f) => sum + f.points, 0);
    assert.equal(totalPositive, 30, "Maximum total criteria contribution must be capped at +30");

    // All 5 factors must be preserved in the explanation
    assert.equal(factors.length, 5);
  });

  it("prevents cross-factor stacking by requiring distinct non-commerce categories for operational breadth", () => {
    // Only commerce + tech signals -> should NOT award operational breadth bonus
    const commerceOnlySignals = [
      {
        id: "s1",
        category: "technology" as const,
        key: SIGNAL_KEYS.ACTIVE_DOMAIN,
        statement: "Live domain",
        sourceUrl: "https://example.com",
        sourceName: "Example",
        observedAt: new Date().toISOString(),
        confidence: "high" as const,
        type: "VERIFIED" as const,
      },
      {
        id: "s2",
        category: "ecommerce" as const,
        key: SIGNAL_KEYS.ECOMMERCE_STORE,
        statement: "Store detected",
        sourceUrl: "https://example.com",
        sourceName: "Example",
        observedAt: new Date().toISOString(),
        confidence: "high" as const,
        type: "VERIFIED" as const,
      },
    ];

    const breakdownNoBreadth = calculateRelevanceScore(
      { matchedIndicators: ["Audience matched"], score: 15 },
      { factors: [], matchedCount: 0 },
      commerceOnlySignals,
    );

    const hasBreadthFactor = breakdownNoBreadth.factors.some((f) => f.factor.includes("operational breadth"));
    assert.equal(hasBreadthFactor, false, "Must not award operational breadth from basic commerce signal alone");

    // Commerce + Social + Hiring (2 distinct non-commerce categories) -> awards operational breadth
    const multiCategorySignals = [
      ...commerceOnlySignals,
      {
        id: "s3",
        category: "social" as const,
        key: SIGNAL_KEYS.ACTIVE_SOCIAL_CHANNELS,
        statement: "Instagram and TikTok detected",
        sourceUrl: "https://example.com",
        sourceName: "Example",
        observedAt: new Date().toISOString(),
        confidence: "high" as const,
        type: "VERIFIED" as const,
      },
      {
        id: "s4",
        category: "hiring" as const,
        key: SIGNAL_KEYS.HIRING_SIGNAL,
        statement: "Hiring page observed",
        sourceUrl: "https://example.com",
        sourceName: "Example",
        observedAt: new Date().toISOString(),
        confidence: "high" as const,
        type: "VERIFIED" as const,
      },
    ];

    const breakdownWithBreadth = calculateRelevanceScore(
      { matchedIndicators: ["Audience matched"], score: 15 },
      { factors: [], matchedCount: 0 },
      multiCategorySignals,
    );

    const breadthFactor = breakdownWithBreadth.factors.find((f) => f.factor.includes("operational breadth"));
    assert.ok(breadthFactor, "Must award operational breadth when >= 2 distinct non-commerce categories are verified");
    assert.equal(breadthFactor.points, 10);
  });

  it("enforces geographic grounding to avoid false positives (e.g. 'Indian cotton')", () => {
    // US store that mentions "Indian cotton" in its product description
    const usCandidate: CandidateCompany = {
      name: "Austin Apparel Co",
      url: "https://austinapparel.com",
      domain: "austinapparel.com",
      source: "firecrawl",
      discoveredAt: new Date().toISOString(),
    };
    const usPage: ScrapedPage = {
      url: "https://austinapparel.com",
      domain: "austinapparel.com",
      title: "Austin Apparel - Premium Tees",
      description: "Handcrafted tees made with 100% organic Indian cotton. Designed in Austin, Texas.",
      markdown: "$42 USD. Add to Cart. Free shipping across the United States.",
      scrapedAt: new Date().toISOString(),
    };
    const signals = extractObservableSignals(usPage, usCandidate);

    const target = "Indian D2C apparel brands";
    const alignment = evaluateTargetAlignment(target, usPage, usCandidate, signals);

    // Should detect geo constraint but report it as unverified
    const geoIndicator = alignment.matchedIndicators.find((i) => i.includes("India"));
    assert.ok(geoIndicator, "Should record geographic indicator note");
    assert.match(geoIndicator, /unverified/i, "Must mark Indian geo target as unverified");
    assert.ok(alignment.score <= 10, "Unverified geographic target must be dampened and not receive full target score");

    // Verified Indian brand with local currency and cities
    const inCandidate: CandidateCompany = {
      name: "Bombay Shirt Co",
      url: "https://bombayshirts.com",
      domain: "bombayshirts.com",
      source: "firecrawl",
      discoveredAt: new Date().toISOString(),
    };
    const inPage: ScrapedPage = {
      url: "https://bombayshirts.com",
      domain: "bombayshirts.com",
      title: "Bombay Shirt Company - D2C Custom Apparel",
      description: "India's premier custom apparel brand.",
      markdown: "Custom Oxford Shirt. ₹2,490 INR. Add to Cart. Flagship stores in Mumbai and Bangalore.",
      scrapedAt: new Date().toISOString(),
    };
    const inSignals = extractObservableSignals(inPage, inCandidate);

    const inAlignment = evaluateTargetAlignment(target, inPage, inCandidate, inSignals);
    const inGeoIndicator = inAlignment.matchedIndicators.find((i) => i.includes("India"));
    assert.ok(inGeoIndicator);
    assert.match(inGeoIndicator, /Verified India geographic alignment/i, "Must verify Indian brand with local currency & city");
    assert.ok(inAlignment.score >= 20, "Verified brand should receive high target alignment score");
  });
});

describe("Phase 2.2 RADAR Intelligence — Evidence vs Inference Separation", () => {
  it("separates VERIFIED factual observations from INFERRED opportunity hypotheses", () => {
    const candidate: CandidateCompany = {
      name: "Wildflower Coffee",
      url: "https://wildflowercoffee.com",
      domain: "wildflowercoffee.com",
      source: "firecrawl",
      discoveredAt: new Date().toISOString(),
    };
    const page: ScrapedPage = {
      url: "https://wildflowercoffee.com",
      domain: "wildflowercoffee.com",
      title: "Wildflower Coffee Roasters",
      markdown: "Whole bean coffee. $18 USD. Add to Cart. Follow our Instagram.",
      scrapedAt: new Date().toISOString(),
    };

    const radar = {
      target: "Specialty coffee roasters",
      offer: "Short-form TikTok video ads",
      criteria: ["Active e-commerce store"],
    };

    const result = qualifyCandidate(candidate, page, radar);

    const verifiedItems = result.evidence.filter((e) => e.type === "VERIFIED");
    const inferredItems = result.evidence.filter((e) => e.type === "INFERRED");

    assert.ok(verifiedItems.length > 0, "Must have VERIFIED factual observations");
    assert.ok(inferredItems.length > 0, "Must have INFERRED opportunity hypotheses");

    for (const v of verifiedItems) {
      assert.notEqual(v.sourceUrl, null, "VERIFIED observations must carry source URLs");
      assert.ok(v.statement.length > 0);
    }

    for (const inf of inferredItems) {
      assert.equal(inf.sourceName, "RADAR Opportunity Inference Engine");
      assert.match(inf.statement, /\b(may create an opportunity|potential angle|could represent|opportunity)\b/i);
    }
  });
});

describe("Phase 2.2 RADAR Intelligence — Discovery Pipeline Integration", () => {
  it("runs discovery pipeline and produces enriched leads sorted by relevance", async () => {
    const mockSearch: SearchProvider = {
      async search() {
        return [
          {
            name: "Loom & Thread",
            url: "https://loomandthread.com",
            domain: "loomandthread.com",
            snippet: "Artisan woven throws and blankets.",
            source: "mock",
            discoveredAt: new Date().toISOString(),
          },
          {
            name: "Irrelevant Directory",
            url: "https://clutch.co/apparel-agencies",
            domain: "clutch.co",
            snippet: "Directory of agencies.",
            source: "mock",
            discoveredAt: new Date().toISOString(),
          },
        ];
      },
    };

    const mockResearch: ResearchProvider = {
      async scrapePage(url: string) {
        if (url.includes("loomandthread")) {
          return {
            url,
            domain: "loomandthread.com",
            title: "Loom & Thread - Home Essentials",
            markdown: "Collections of artisanal throws. $120 USD. Add to Cart. Checkout.",
            scrapedAt: new Date().toISOString(),
          };
        }
        return {
          url,
          domain: "clutch.co",
          title: "Directory Listing",
          markdown: "Top agencies list.",
          scrapedAt: new Date().toISOString(),
        };
      },
    };

    const radar: Radar = {
      id: "rad-test-intel",
      name: "Home Goods Radar",
      description: "Finding DTC home decor brands",
      target: "DTC home decor brands",
      offer: "Short-form video creative",
      criteria: ["Active e-commerce store"],
      status: "active",
      leadCount: 0,
    };

    const runResult = await runDiscoveryPipeline(radar, {
      searchProvider: mockSearch,
      researchProvider: mockResearch,
    });

    assert.equal(runResult.leadsFound, 2);
    const topLead = runResult.leads[0];
    const secondLead = runResult.leads[1];

    // High relevance lead should rank first
    assert.equal(topLead.companyName, "Loom & Thread");
    assert.ok(topLead.relevance > secondLead.relevance, "Leads must be sorted by relevance descending");
    assert.ok(topLead.fit === "HIGH RELEVANCE" || topLead.fit === "POSSIBLE RELEVANCE");
    assert.ok(topLead.scoreBreakdown);
    assert.ok((topLead.scoreBreakdown.factors?.length ?? 0) > 0);
    assert.ok(topLead.observableSignals);
    assert.ok((topLead.observableSignals.length ?? 0) > 0);
  });
});

describe("Phase 2.2 RADAR Intelligence — Demo Mode Backward Compatibility", () => {
  it("preserves demo dataset schema validity and isolation", () => {
    assert.ok(demoLeads.length > 0, "Demo leads must exist");

    // All demo leads must parse against ListLeadsResponse schema
    const parsedList = ListLeadsResponse.safeParse(demoLeads);
    assert.equal(parsedList.success, true, "Existing demo leads must conform to OpenAPI schema");

    for (const dLead of demoLeads) {
      assert.equal(dLead.sourceStatus, "demo");
      assert.ok(dLead.relevance >= 0 && dLead.relevance <= 100);
      assert.ok(Array.isArray(dLead.signals));
      assert.ok(Array.isArray(dLead.evidence));
      assert.ok(Array.isArray(dLead.opportunity));

      // Each demo lead must parse against GetLeadResponse
      const parsedSingle = GetLeadResponse.safeParse(dLead);
      assert.equal(parsedSingle.success, true);
    }
  });
});

