import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpportunityBrief,
  determineContactEvidence,
  determineRecommendedNextAction,
  determineEvidenceConfidence,
} from "../services/opportunity-brief";
import { leads as demoLeads, radars as demoRadars } from "../services/radar-data";
import { withOpportunityBrief } from "../services/db-storage";
import type { Lead, Radar } from "@workspace/api-zod";

describe("Phase 2.4 RADAR Opportunity Brief — Comprehensive Verification", () => {
  const baseLead: Lead = {
    id: "lead-test-01",
    radarId: "radar-test-01",
    companyName: "Artisanal Brews",
    website: "https://artisanalbrews.example.com",
    description: "Independent microbrewery producing organic craft ales and ciders.",
    industry: "Craft Beverage",
    location: "Portland, OR",
    relevance: 82,
    fit: "HIGH RELEVANCE",
    signals: [
      "Direct-to-consumer online ordering observed on storefront",
      "Active Instagram link with high engagement observed in header",
      "No native video observed on 4 researched product pages",
    ],
    evidence: [
      {
        id: "ev-1",
        statement: "Shopify checkout and ecommerce cart detected on /shop",
        excerpt: "Add to cart — Fresh canned ales shipped cold directly to your door",
        sourceName: "Online Storefront",
        sourceUrl: "https://artisanalbrews.example.com/shop",
        sourceStatus: "connected",
        observedAt: "2026-09-24T10:00:00Z",
        confidence: "high",
        type: "VERIFIED",
      },
      {
        id: "ev-2",
        statement: "Instagram handle @artisanalbrews present on homepage footer",
        excerpt: "Follow our taproom adventures @artisanalbrews",
        sourceName: "Homepage",
        sourceUrl: "https://artisanalbrews.example.com",
        sourceStatus: "connected",
        observedAt: "2026-09-24T10:00:00Z",
        confidence: "high",
        type: "VERIFIED",
      },
      {
        id: "ev-3",
        statement: "No embedded video observed on 4 researched product pages",
        sourceName: "Product Catalog",
        sourceUrl: "https://artisanalbrews.example.com/products",
        sourceStatus: "connected",
        observedAt: "2026-09-24T10:00:00Z",
        confidence: "medium",
        type: "VERIFIED",
      },
      {
        id: "ev-4",
        statement: "Microbrewery expansion into direct shipping could benefit from video storytelling",
        sourceName: "RADAR Relevance Analysis",
        sourceStatus: "connected",
        observedAt: "2026-09-24T10:00:00Z",
        confidence: "medium",
        type: "INFERRED",
      },
    ],
    opportunity: [
      "Short-form product craft video could increase online checkout conversion from social traffic",
    ],
    source: "Firecrawl Live Discovery",
    sourceStatus: "connected",
    discoveredAt: "2026-09-24T10:00:00Z",
    status: "researched",
    saved: false,
    contactVerified: true,
    publicEmail: "sam@artisanalbrews.example.com",
    primaryContact: {
      id: "person-1",
      name: "Sam Higgins",
      role: "Head of Marketing",
      roleCategory: "creative_marketing",
      verificationStatus: "VERIFIED",
      selectionReason: "Direct marketing leadership matches video offer",
      sourceUrl: "https://artisanalbrews.example.com/about",
      sourceName: "About Page",
      observedAt: "2026-09-24T10:00:00Z",
      excerpt: "Sam Higgins leads marketing and brand partnerships",
      confidence: "high",
      contactPoints: [
        {
          id: "cp-1",
          type: "email",
          value: "sam@artisanalbrews.example.com",
          scope: "individual",
          isDirect: true,
          verificationStatus: "VERIFIED",
          confidence: "high",
          sourceUrl: "https://artisanalbrews.example.com/about",
          sourceName: "About Page",
          observedAt: "2026-09-24T10:00:00Z",
        },
      ],
    },
    people: [
      {
        id: "person-1",
        name: "Sam Higgins",
        role: "Head of Marketing",
        roleCategory: "creative_marketing",
        verificationStatus: "VERIFIED",
        selectionReason: "Direct marketing leadership matches video offer",
        sourceUrl: "https://artisanalbrews.example.com/about",
        sourceName: "About Page",
        observedAt: "2026-09-24T10:00:00Z",
        excerpt: "Sam Higgins leads marketing and brand partnerships",
        confidence: "high",
        contactPoints: [
          {
            id: "cp-1",
            type: "email",
            value: "sam@artisanalbrews.example.com",
            scope: "individual",
            isDirect: true,
            verificationStatus: "VERIFIED",
            confidence: "high",
            sourceUrl: "https://artisanalbrews.example.com/about",
            sourceName: "About Page",
            observedAt: "2026-09-24T10:00:00Z",
          },
        ],
      },
    ],
    contactPoints: [
      {
        id: "cp-1",
        type: "email",
        value: "sam@artisanalbrews.example.com",
        scope: "individual",
        isDirect: true,
        verificationStatus: "VERIFIED",
        confidence: "high",
        sourceUrl: "https://artisanalbrews.example.com/about",
        sourceName: "About Page",
        observedAt: "2026-09-24T10:00:00Z",
      },
    ],
    scoreBreakdown: {
      totalScore: 82,
      baseScore: 5,
      factors: [
        { factor: "Ecommerce Storefront", points: 25, reason: "Direct-to-consumer store verified" },
        { factor: "Offer Synergy", points: 20, reason: "Absence of video on commerce site creates opening" },
      ],
    },
  };

  it("1. Strong evidence lead produces correct deterministic summary & whyRelevant", () => {
    const brief = buildOpportunityBrief(baseLead);

    assert.ok(brief.summary.includes("Artisanal Brews"), "Summary must mention company name");
    assert.ok(brief.summary.includes("Craft Beverage"), "Summary must reflect industry context");
    assert.ok(brief.whyRelevant.length >= 2, "Must generate concrete whyRelevant points");
    assert.ok(
      brief.whyRelevant.some((r) => r.toLowerCase().includes("ecommerce") || r.toLowerCase().includes("storefront")),
      "whyRelevant must ground in observed commerce signals",
    );
  });

  it("2. Existing opportunity hypothesis is correctly placed and explained", () => {
    const brief = buildOpportunityBrief(baseLead);

    assert.equal(
      brief.opportunity.hypothesis,
      "Short-form product craft video could increase online checkout conversion from social traffic",
    );
    assert.ok(brief.opportunity.explanation.includes("inferred conversational entry point"));
  });

  it("3. Missing opportunity hypothesis handled honestly without fabricating business needs", () => {
    const leadWithoutOpp: Lead = {
      ...baseLead,
      opportunity: [],
    };
    const brief = buildOpportunityBrief(leadWithoutOpp);

    assert.ok(
      brief.opportunity.hypothesis.includes("Research did not surface a specific opportunity angle"),
      "Must state absence honestly rather than fabricating needs",
    );
  });

  it("4. Observable facts remain classified as facts with sources", () => {
    const brief = buildOpportunityBrief(baseLead);

    assert.equal(brief.observableFacts.length, 3, "Only VERIFIED evidence items become observable facts");
    for (const fact of brief.observableFacts) {
      assert.ok(fact.statement, "Fact must have statement");
      assert.ok(fact.sourceName, "Fact must have sourceName");
      assert.ok(fact.observedAt, "Fact must have observedAt");
    }
    const storeFact = brief.observableFacts.find((f) => f.statement.includes("Shopify"));
    assert.ok(storeFact, "Shopify fact must be present");
    assert.equal(storeFact?.excerpt, "Add to cart — Fresh canned ales shipped cold directly to your door");
  });

  it("5. Inferences remain explicitly labeled as interpretations", () => {
    const brief = buildOpportunityBrief(baseLead);

    assert.equal(brief.inferences.length, 1, "Only INFERRED evidence items become inferences");
    assert.ok(brief.inferences[0].statement.includes("storytelling"));
  });

  it("6. No invented facts or URLs when evidence is empty", () => {
    const emptyLead: Lead = {
      id: "empty-1",
      radarId: "radar-1",
      companyName: "Bare Company",
      description: "A plain company profile.",
      industry: "Unknown",
      location: "Unknown",
      relevance: 15,
      signals: [],
      evidence: [],
      opportunity: [],
      source: "Manual",
      sourceStatus: "connected",
      discoveredAt: "2026-09-24T10:00:00Z",
      status: "new",
      saved: false,
      contactVerified: false,
    };

    const brief = buildOpportunityBrief(emptyLead);

    assert.equal(brief.observableFacts.length, 0, "No facts should be invented");
    assert.equal(brief.inferences.length, 0, "No inferences should be invented");
    assert.equal(brief.sources.length, 0, "No source URLs should be invented");
    assert.equal(brief.primaryContact, null, "No primary contact should be invented");
    assert.equal(brief.contactEvidence.status, "ABSENT");
  });

  it("7. Verified primary contact appears with selection reason", () => {
    const brief = buildOpportunityBrief(baseLead);

    assert.ok(brief.primaryContact);
    assert.equal(brief.primaryContact?.name, "Sam Higgins");
    assert.equal(brief.primaryContact?.role, "Head of Marketing");
    assert.equal(brief.primaryContact?.verificationStatus, "VERIFIED");
    assert.equal(
      brief.primaryContact?.selectionReason,
      "Direct marketing leadership matches video offer",
    );
  });

  it("8. Suggested-only person does not become verified and is not selected as primary contact", () => {
    const leadWithSuggested: Lead = {
      ...baseLead,
      primaryContact: undefined,
      people: [
        {
          id: "p-sug-1",
          name: "Alex Unverified",
          role: "Possible Collaborator",
          roleCategory: "unspecified",
          verificationStatus: "SUGGESTED",
          confidence: "low",
          sourceUrl: "https://artisanalbrews.example.com/team",
          sourceName: "Team",
          observedAt: "2026-09-24T10:00:00Z",
          contactPoints: [],
        },
      ],
    };

    const brief = buildOpportunityBrief(leadWithSuggested);
    assert.equal(
      brief.primaryContact,
      null,
      "Suggested person must not be promoted to primary contact",
    );
  });

  it("9. Verified person does not imply verified email", () => {
    const leadWithPersonNoEmail: Lead = {
      ...baseLead,
      publicEmail: null,
      contactVerified: false,
      primaryContact: {
        id: "p-verified-no-email",
        name: "Jordan Lee",
        role: "Creative Director",
        roleCategory: "creative_marketing",
        verificationStatus: "VERIFIED",
        confidence: "high",
        sourceUrl: "https://artisanalbrews.example.com/team",
        sourceName: "Team",
        observedAt: "2026-09-24T10:00:00Z",
        contactPoints: [], // No email!
      },
      people: [
        {
          id: "p-verified-no-email",
          name: "Jordan Lee",
          role: "Creative Director",
          roleCategory: "creative_marketing",
          verificationStatus: "VERIFIED",
          confidence: "high",
          sourceUrl: "https://artisanalbrews.example.com/team",
          sourceName: "Team",
          observedAt: "2026-09-24T10:00:00Z",
          contactPoints: [],
        },
      ],
      contactPoints: [],
    };

    const brief = buildOpportunityBrief(leadWithPersonNoEmail);

    assert.equal(brief.primaryContact?.name, "Jordan Lee");
    assert.equal(brief.contactEvidence.status, "ABSENT");
    assert.ok(
      brief.contactEvidence.details.includes("no direct personal contact channel"),
      "Summary must reflect absence of direct email",
    );
  });

  it("9b. Verified person + company contact exists produces COMPANY_ONLY (NOT ABSENT)", () => {
    const leadWithPersonAndCompanyContact: Lead = {
      ...baseLead,
      publicEmail: null,
      contactVerified: false,
      primaryContact: {
        id: "p-verified-no-direct-contact",
        name: "Morgan Bailey",
        role: "Founder & CEO",
        roleCategory: "founder",
        verificationStatus: "VERIFIED",
        confidence: "high",
        sourceUrl: "https://artisanalbrews.example.com/about",
        sourceName: "About Page",
        observedAt: "2026-09-24T10:00:00Z",
        contactPoints: [], // No direct personal contact
      },
      people: [
        {
          id: "p-verified-no-direct-contact",
          name: "Morgan Bailey",
          role: "Founder & CEO",
          roleCategory: "founder",
          verificationStatus: "VERIFIED",
          confidence: "high",
          sourceUrl: "https://artisanalbrews.example.com/about",
          sourceName: "About Page",
          observedAt: "2026-09-24T10:00:00Z",
          contactPoints: [],
        },
      ],
      contactPoints: [
        {
          id: "cp-company-email",
          type: "email",
          value: "hello@artisanalbrews.example.com",
          scope: "company",
          isDirect: false,
          verificationStatus: "VERIFIED",
          confidence: "high",
          sourceUrl: "https://artisanalbrews.example.com/contact",
          sourceName: "Contact Page",
          observedAt: "2026-09-24T10:00:00Z",
        },
        {
          id: "cp-company-phone",
          type: "phone",
          value: "+1-503-555-0199",
          scope: "company",
          isDirect: false,
          verificationStatus: "SUPPORTED",
          confidence: "medium",
          sourceUrl: "https://artisanalbrews.example.com/contact",
          sourceName: "Contact Page",
          observedAt: "2026-09-24T10:00:00Z",
        },
        {
          id: "cp-contact-form",
          type: "contact_form",
          value: "https://artisanalbrews.example.com/contact",
          scope: "company",
          isDirect: false,
          verificationStatus: "VERIFIED",
          confidence: "high",
          sourceUrl: "https://artisanalbrews.example.com/contact",
          sourceName: "Contact Page",
          observedAt: "2026-09-24T10:00:00Z",
        },
      ],
    };

    const brief = buildOpportunityBrief(leadWithPersonAndCompanyContact);

    assert.equal(brief.primaryContact?.name, "Morgan Bailey");
    assert.equal(brief.primaryContact?.verificationStatus, "VERIFIED");
    assert.equal(
      brief.contactEvidence.status,
      "COMPANY_ONLY",
      "Must produce COMPANY_ONLY and NOT ABSENT when company channels exist alongside verified person",
    );
    assert.notEqual(brief.contactEvidence.status, "ABSENT");
    assert.ok(
      brief.contactEvidence.details.includes("General company email observed"),
      "Details must mention company email",
    );
    assert.ok(
      brief.contactEvidence.details.includes("Morgan Bailey"),
      "Details must reference identified person",
    );
    assert.ok(
      brief.contactEvidence.details.includes("no verified direct personal email observed"),
      "Must explicitly state verified person != verified email",
    );
  });

  it("10. No public contact state produces honest scoped absence notice", () => {
    const leadNoContact: Lead = {
      ...baseLead,
      publicEmail: null,
      contactVerified: false,
      primaryContact: undefined,
      people: [],
      contactPoints: [],
    };

    const brief = buildOpportunityBrief(leadNoContact);

    assert.equal(brief.contactEvidence.status, "ABSENT");
    assert.equal(
      brief.contactEvidence.details,
      "No public contact channels were observed on researched pages.",
    );
  });

  it("11. Sources are collected and deduplicated", () => {
    const leadWithDupes: Lead = {
      ...baseLead,
      evidence: [
        {
          id: "e-1",
          statement: "First note",
          sourceName: "About Page",
          sourceUrl: "https://artisanalbrews.example.com/about",
          sourceStatus: "connected",
          observedAt: "2026-09-24T10:00:00Z",
          type: "VERIFIED",
        },
        {
          id: "e-2",
          statement: "Second note",
          sourceName: "About Us",
          sourceUrl: "https://artisanalbrews.example.com/about",
          sourceStatus: "connected",
          observedAt: "2026-09-24T10:00:00Z",
          type: "VERIFIED",
        },
        {
          id: "e-3",
          statement: "Storefront note",
          sourceName: "Shop",
          sourceUrl: "https://artisanalbrews.example.com/shop",
          sourceStatus: "connected",
          observedAt: "2026-09-24T10:00:00Z",
          type: "VERIFIED",
        },
      ],
    };

    const brief = buildOpportunityBrief(leadWithDupes);

    const urls = brief.sources.map((s) => s.url);
    const uniqueUrls = Array.from(new Set(urls));
    assert.equal(urls.length, uniqueUrls.length, "Sources list must have zero duplicate URLs");
    // 4 inputs (website + 3 evidence items where 2 share the same /about URL) deduplicate to 3 unique sources
    assert.equal(brief.sources.length, 3, "Should contain exactly the 3 unique URLs");
  });

  it("12. Demo mode leads have valid Opportunity Briefs via same function", () => {
    for (const demoLead of demoLeads) {
      assert.ok(demoLead.opportunityBrief, `Demo lead ${demoLead.id} must have opportunityBrief`);
      const directBrief = buildOpportunityBrief(demoLead);

      assert.equal(
        demoLead.opportunityBrief.summary,
        directBrief.summary,
        `Demo lead ${demoLead.id} summary must match direct call`,
      );
      assert.equal(
        demoLead.opportunityBrief.opportunity.hypothesis,
        directBrief.opportunity.hypothesis,
      );
      assert.equal(
        demoLead.opportunityBrief.contactEvidence.status,
        directBrief.contactEvidence.status,
      );
      assert.equal(
        demoLead.opportunityBrief.recommendedNextAction.action,
        directBrief.recommendedNextAction.action,
      );
      assert.equal(
        demoLead.opportunityBrief.confidence,
        directBrief.confidence,
      );
    }
  });

  it("13. Live mode leads have valid Opportunity Briefs via withOpportunityBrief", () => {
    const unbriefedLead: Lead = {
      ...baseLead,
      opportunityBrief: undefined,
    };

    const processed = withOpportunityBrief(unbriefedLead);
    assert.ok(processed.opportunityBrief, "withOpportunityBrief must populate opportunityBrief");
    assert.equal(processed.opportunityBrief.contactEvidence.status, "VERIFIED_DIRECT");
    assert.equal(processed.opportunityBrief.recommendedNextAction.action, "draft_outreach");
  });

  it("14. Action state machine triggers all 4 actions accurately based on strict rules", () => {
    // 14.1 draft_outreach: high/possible relevance + verified or supported direct contact
    const draftLead: Lead = {
      ...baseLead,
      relevance: 75,
      fit: "HIGH RELEVANCE",
      contactVerified: true,
    };
    const draftAction = determineRecommendedNextAction(
      draftLead,
      "VERIFIED_DIRECT",
      draftLead.primaryContact ?? null,
      "high",
    );
    assert.equal(draftAction.action, "draft_outreach");

    // 14.2 research_contact: relevance >= 50, but absent or company-only direct contact
    const researchLead: Lead = {
      ...baseLead,
      relevance: 75,
      fit: "HIGH RELEVANCE",
      contactVerified: false,
      publicEmail: null,
      primaryContact: undefined,
      contactPoints: [],
    };
    const researchAction = determineRecommendedNextAction(
      researchLead,
      "ABSENT",
      null,
      "high",
    );
    assert.equal(researchAction.action, "research_contact");

    // 14.3 research_contact: confidence=low does NOT override relevance >= 50 rule
    const lowConfHighRelLead: Lead = {
      ...baseLead,
      relevance: 60,
      fit: "POSSIBLE RELEVANCE",
      evidence: [baseLead.evidence[0]],
    };
    const lowConfAction = determineRecommendedNextAction(
      lowConfHighRelLead,
      "COMPANY_ONLY",
      null,
      "low",
    );
    assert.equal(
      lowConfAction.action,
      "research_contact",
      "confidence=low must not override relevance >= 50 rule to review_evidence",
    );

    // 14.4 review_evidence: relevance 35–49
    const reviewLead: Lead = {
      ...baseLead,
      relevance: 42,
      fit: "POSSIBLE RELEVANCE",
      evidence: [baseLead.evidence[0]],
    };
    const reviewAction = determineRecommendedNextAction(
      reviewLead,
      "COMPANY_ONLY",
      null,
      "low",
    );
    assert.equal(reviewAction.action, "review_evidence");

    // 14.5 archive_lead: relevance < 35 or LOW RELEVANCE
    const lowLead: Lead = {
      ...baseLead,
      relevance: 20,
      fit: "LOW RELEVANCE",
    };
    const archiveAction = determineRecommendedNextAction(
      lowLead,
      "ABSENT",
      null,
      "low",
    );
    assert.equal(archiveAction.action, "archive_lead");
  });

  it("15. Confidence represents evidence completeness only and does not alter score", () => {
    const sparseLead: Lead = {
      ...baseLead,
      relevance: 82,
      evidence: [baseLead.evidence[0]],
      people: [],
      contactPoints: [],
      contactVerified: false,
    };

    const richLead: Lead = {
      ...baseLead,
      relevance: 82,
    };

    const sparseBrief = buildOpportunityBrief(sparseLead);
    const richBrief = buildOpportunityBrief(richLead);

    // Confidence differs
    assert.equal(sparseBrief.confidence, "low");
    assert.equal(richBrief.confidence, "high");

    // Score remains completely untouched
    assert.equal(sparseLead.relevance, 82);
    assert.equal(richLead.relevance, 82);
    assert.equal(sparseLead.fit, richLead.fit);
    assert.equal(sparseLead.scoreBreakdown?.totalScore, richLead.scoreBreakdown?.totalScore);
  });
});
