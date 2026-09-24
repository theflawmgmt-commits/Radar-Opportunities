import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  categorizeRole,
  isValidPersonName,
  isValidEmail,
  findSecondaryScrapeTargets,
  extractContactPoints,
  extractPeopleFromPage,
  associateContactsWithPeople,
  selectPrimaryContact,
  projectLegacyContact,
  enrichCandidate,
} from "../services/enrichment";
import { runDiscoveryPipeline } from "../services/discovery-pipeline";
import { saveLiveLeads, getLiveLeadById } from "../services/db-storage";
import type {
  CandidateCompany,
  Person,
  ContactPoint,
  ResearchProvider,
  ScrapedPage,
  SearchProvider,
} from "../services/providers";
import type { Radar, Lead } from "@workspace/api-zod";

describe("Phase 2.3 RADAR Contact Enrichment — Unit Tests", () => {
  const sampleCandidate: CandidateCompany = {
    name: "Lumina Studio",
    url: "https://luminastudio.com",
    domain: "luminastudio.com",
    snippet: "Handcrafted ceramics and artisanal home decor.",
    source: "firecrawl:search",
    discoveredAt: new Date().toISOString(),
  };

  it("1. Single founder extraction with direct email", async () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com/about",
      domain: "luminastudio.com",
      title: "About Lumina Studio",
      markdown: `
        # About Us
        ### Elena Rostova - Founder & Creative Director
        Elena started Lumina in 2019 to celebrate minimalist home design.
        Contact Elena directly: [Email Elena](mailto:elena@luminastudio.com)
      `,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(sampleCandidate, page, {
      offer: "general consulting",
      target: "home decor brands",
    });

    assert.equal(result.people.length, 1);
    const person = result.people[0];
    assert.equal(person.name, "Elena Rostova");
    assert.equal(person.roleCategory, "creative_marketing");
    assert.equal(person.verificationStatus, "VERIFIED");
    assert.equal(person.contactPoints.length, 1);
    assert.equal(person.contactPoints[0].type, "email");
    assert.equal(person.contactPoints[0].value, "elena@luminastudio.com");
    assert.equal(person.contactPoints[0].isDirect, true);
    assert.equal(person.contactPoints[0].verificationStatus, "VERIFIED");

    // Primary contact check
    assert.ok(result.primaryContact);
    assert.equal(result.primaryContact.name, "Elena Rostova");
  });

  it("2. Marketing director outranking founder when offer is UGC/video (Correction #2)", async () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com/team",
      domain: "luminastudio.com",
      title: "Leadership Team",
      markdown: `
        # Leadership Team
        ### Marcus Vance - Founder & CEO
        Oversees long term strategy and operations.

        ### Sarah Lin - Head of Marketing
        Leads brand partnerships, creator collaborations, and organic video.
        Contact: [Email Sarah](mailto:sarah@luminastudio.com)
      `,
      scrapedAt: new Date().toISOString(),
    };

    // Creative/UGC offer
    const result = await enrichCandidate(sampleCandidate, page, {
      offer: "Short-form TikTok and Instagram Reels UGC video creative services",
      target: "D2C lifestyle brands",
    });

    assert.equal(result.people.length, 2);
    assert.ok(result.primaryContact, "Primary contact must be selected");
    // Sarah Lin (Head of Marketing) MUST outrank Marcus Vance (Founder & CEO) for UGC offer!
    assert.equal(
      result.primaryContact.name,
      "Sarah Lin",
      "Head of Marketing must outrank Founder for a UGC/video offer",
    );
    assert.equal(result.primaryContact.roleCategory, "creative_marketing");
    assert.ok(
      result.primaryContact.selectionReason?.includes("creative/marketing"),
      "Selection reason must explain the offer alignment",
    );
  });

  it("3. Founder selected as fallback when no marketing contact exists for UGC offer", async () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com/team",
      domain: "luminastudio.com",
      title: "Our Team",
      markdown: `
        # Our Team
        ### Marcus Vance - Founder & CEO
        Runs day to day business.
      `,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(sampleCandidate, page, {
      offer: "High converting UGC video ads for DTC brands",
      target: "D2C lifestyle brands",
    });

    assert.equal(result.people.length, 1);
    assert.ok(result.primaryContact);
    assert.equal(result.primaryContact.name, "Marcus Vance");
    assert.equal(result.primaryContact.roleCategory, "founder");
    assert.ok(
      result.primaryContact.selectionReason?.includes("Founder as primary contact because no dedicated marketing"),
      "Fallback reason must clearly explain lack of observed marketing role",
    );
  });

  it("4. Operations director outranked by founder in default offer but prioritized for logistics offer", async () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com/team",
      domain: "luminastudio.com",
      title: "Our Team",
      markdown: `
        # Our Team
        ### Marcus Vance - Founder
        ### David Kim - Head of Operations & Logistics
      `,
      scrapedAt: new Date().toISOString(),
    };

    // Case A: Logistics/operations offer -> David Kim should win
    const opsResult = await enrichCandidate(sampleCandidate, page, {
      offer: "Warehouse fulfillment and 3PL supply chain optimization",
      target: "ecommerce brands",
    });
    assert.equal(opsResult.primaryContact?.name, "David Kim");

    // Case B: General offer -> Marcus Vance (Founder) should win
    const generalResult = await enrichCandidate(sampleCandidate, page, {
      offer: "Growth advisory services",
      target: "ecommerce brands",
    });
    assert.equal(generalResult.primaryContact?.name, "Marcus Vance");
  });

  it("5. Person verified but no email: Person is VERIFIED, email is NOT_VERIFIED / absent, no hallucinated email", async () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com/team",
      domain: "luminastudio.com",
      title: "Team",
      markdown: `
        # Team
        ### Jonathan Reed - Chief Technology Officer
        Jonathan leads the engineering organization.
      `,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(sampleCandidate, page, {
      offer: "Engineering services",
      target: "software brands",
    });

    assert.equal(result.people.length, 1);
    const person = result.people[0];
    assert.equal(person.name, "Jonathan Reed");
    assert.equal(person.verificationStatus, "VERIFIED");
    assert.equal(person.contactPoints.length, 0, "No email should be fabricated");

    // Legacy contact projections
    assert.equal(result.legacyContact.founder, "Jonathan Reed");
    assert.equal(result.legacyContact.publicEmail, null, "publicEmail must be null when none observed");
    assert.equal(result.legacyContact.contactVerified, false);
  });

  it("6. Company general email (info@, hello@) marked as scope company, not individual", async () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com",
      domain: "luminastudio.com",
      title: "Home",
      markdown: `
        # Welcome to Lumina
        Questions? Write to us at hello@luminastudio.com or support@luminastudio.com.
      `,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(sampleCandidate, page, {
      offer: "Email marketing",
      target: "brands",
    });

    assert.equal(result.people.length, 0);
    assert.equal(result.companyContactPoints.length, 2);

    for (const cp of result.companyContactPoints) {
      assert.equal(cp.scope, "company");
      assert.equal(cp.isDirect, false);
      assert.equal(cp.verificationStatus, "SUPPORTED");
    }

    assert.equal(result.legacyContact.publicEmail, "hello@luminastudio.com");
    // Since hello@ is SUPPORTED, contactVerified is false (only VERIFIED emails count)
    assert.equal(result.legacyContact.contactVerified, false);
  });

  it("7. No email pattern guessing or probabilistic generation", async () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com/team",
      domain: "luminastudio.com",
      title: "Team",
      markdown: `
        ### Alexander Hayes - Co-Founder
        Alexander co-founded the company in 2020.
      `,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(sampleCandidate, page, {
      offer: "general consulting",
      target: "retail",
    });

    // Verify absolutely no email exists in the result
    const allEmails = [
      ...result.companyContactPoints.filter((c) => c.type === "email"),
      ...result.people.flatMap((p) => p.contactPoints.filter((c) => c.type === "email")),
    ];
    assert.equal(allEmails.length, 0, "Must NEVER guess or generate alexander.hayes@luminastudio.com");
    assert.equal(result.legacyContact.publicEmail, null);
  });

  it("8. Secondary scrape triggered only if primary lacks contacts/leadership and link found", async () => {
    let secondaryScraped = false;
    const mockResearch: ResearchProvider = {
      scrapePage: async (url: string) => {
        if (url.includes("/team")) {
          secondaryScraped = true;
          return {
            url: "https://luminastudio.com/team",
            domain: "luminastudio.com",
            title: "Team Page",
            markdown: `
              # Our Leadership
              ### Chloe Bennett - Co-Founder & CMO
            `,
            scrapedAt: new Date().toISOString(),
          };
        }
        throw new Error("Unexpected URL");
      },
    };

    const primaryPage: ScrapedPage = {
      url: "https://luminastudio.com",
      domain: "luminastudio.com",
      title: "Home",
      markdown: `
        # Welcome to Lumina
        Discover our story on our [Meet Our Team](/team) page.
      `,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(
      sampleCandidate,
      primaryPage,
      { offer: "creative design", target: "retail" },
      mockResearch,
    );

    assert.equal(secondaryScraped, true, "Secondary scrape must have been triggered");
    assert.equal(result.people.length, 1);
    assert.equal(result.people[0].name, "Chloe Bennett");
  });

  it("9. Secondary scrape capped at 1 request maximum", async () => {
    let scrapeCallCount = 0;
    const mockResearch: ResearchProvider = {
      scrapePage: async (url: string) => {
        scrapeCallCount++;
        return {
          url,
          domain: "luminastudio.com",
          title: "Page",
          markdown: `
            ### Daniel Craig - Founder
          `,
          scrapedAt: new Date().toISOString(),
        };
      },
    };

    // Primary page has multiple candidate links: /team, /about, /contact
    const primaryPage: ScrapedPage = {
      url: "https://luminastudio.com",
      domain: "luminastudio.com",
      title: "Home",
      markdown: `
        Explore our [Leadership Team](/team)
        Read our [About Us](/about)
        Get in touch on [Contact Us](/contact)
      `,
      scrapedAt: new Date().toISOString(),
    };

    await enrichCandidate(
      sampleCandidate,
      primaryPage,
      { offer: "consulting", target: "retail" },
      mockResearch,
    );

    assert.equal(
      scrapeCallCount,
      1,
      "Secondary scrape MUST be capped at exactly 1 request regardless of how many links exist",
    );
  });

  it("10. Handling when no people or contacts exist on researched pages (clean absence note)", async () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com",
      domain: "luminastudio.com",
      title: "Catalog",
      markdown: `
        # Product Catalog
        Ceramic bowls, mugs, and vases available for purchase.
      `,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(sampleCandidate, page, {
      offer: "growth consulting",
      target: "ceramics",
    });

    assert.equal(result.people.length, 0);
    assert.equal(result.companyContactPoints.length, 0);
    assert.equal(result.primaryContact, null);
    assert.ok(
      result.summary.includes("No team members or leadership profiles observed"),
      "Summary must explicitly state honest absence",
    );
  });

  it("11. Contact point verification states (Correction #1: VERIFIED | SUPPORTED | NOT_VERIFIED, NO SUGGESTED)", () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com",
      domain: "luminastudio.com",
      title: "Home",
      markdown: `
        Email us at mailto:support@luminastudio.com
        Follow us on https://instagram.com/luminastudio
        Find us on https://x.com/luminastudio
      `,
      scrapedAt: new Date().toISOString(),
    };

    const cps = extractContactPoints(page);
    assert.ok(cps.length >= 3);

    for (const cp of cps) {
      assert.ok(
        ["VERIFIED", "SUPPORTED", "NOT_VERIFIED"].includes(cp.verificationStatus),
        `Status ${cp.verificationStatus} must be one of VERIFIED, SUPPORTED, NOT_VERIFIED`,
      );
      assert.notEqual(
        (cp.verificationStatus as string),
        "SUGGESTED",
        "ContactPoint MUST NEVER use SUGGESTED",
      );
    }
  });

  it("12. Person verification states (VERIFIED | SUPPORTED | SUGGESTED)", () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com",
      domain: "luminastudio.com",
      title: "Home",
      markdown: `
        ### Rachel Green - Founder & CEO
        Founded by Monica Geller in 2018.
      `,
      scrapedAt: new Date().toISOString(),
    };

    const people = extractPeopleFromPage(page);
    assert.equal(people.length, 2);

    const rachel = people.find((p) => p.name === "Rachel Green");
    const monica = people.find((p) => p.name === "Monica Geller");

    assert.ok(rachel);
    assert.equal(rachel.verificationStatus, "VERIFIED", "Structured heading gives VERIFIED");

    assert.ok(monica);
    assert.equal(monica.verificationStatus, "SUPPORTED", "In-text 'founded by' gives SUPPORTED");
  });

  it("13. Obfuscated or invalid emails filtered out", () => {
    assert.equal(isValidEmail("test@example.com"), false);
    assert.equal(isValidEmail("admin@domain.com"), false);
    assert.equal(isValidEmail("image@2x.png"), false);
    assert.equal(isValidEmail("user@shopify.com"), false);
    assert.equal(isValidEmail("not-an-email"), false);
    assert.equal(isValidEmail("hello@realbrandstudio.com"), true);
  });

  it("14. Non-person names / false positives filtered out", () => {
    assert.equal(isValidPersonName("Privacy Policy"), false);
    assert.equal(isValidPersonName("Terms of Service"), false);
    assert.equal(isValidPersonName("About Us"), false);
    assert.equal(isValidPersonName("Customer Support"), false);
    assert.equal(isValidPersonName("Free Shipping"), false);
    assert.equal(isValidPersonName("John Doe"), true);
    assert.equal(isValidPersonName("Sarah Jane Miller"), true);
  });

  it("15. Role categorization logic", () => {
    assert.equal(categorizeRole("Founder & CEO"), "founder");
    assert.equal(categorizeRole("Head of Brand & Video"), "creative_marketing");
    assert.equal(categorizeRole("CMO"), "creative_marketing");
    assert.equal(categorizeRole("Social Media Lead"), "creative_marketing");
    assert.equal(categorizeRole("Vice President of Logistics"), "operations");
    assert.equal(categorizeRole("Chief Technology Officer"), "executive");
    assert.equal(categorizeRole("Consultant"), "unspecified");
  });

  it("16. Deterministic tie-breaking for equal score candidates", () => {
    const people: Person[] = [
      {
        id: "p1",
        name: "Zachary Adams",
        role: "Co-Founder",
        roleCategory: "founder",
        verificationStatus: "VERIFIED",
        confidence: "high",
        sourceUrl: "https://example.com",
        sourceName: "Team",
        observedAt: new Date().toISOString(),
        contactPoints: [],
      },
      {
        id: "p2",
        name: "Alice Baker",
        role: "Co-Founder",
        roleCategory: "founder",
        verificationStatus: "VERIFIED",
        confidence: "high",
        sourceUrl: "https://example.com",
        sourceName: "Team",
        observedAt: new Date().toISOString(),
        contactPoints: [],
      },
    ];

    const { primaryContact } = selectPrimaryContact(people, "General advisory");
    assert.ok(primaryContact);
    assert.equal(
      primaryContact.name,
      "Alice Baker",
      "Alphabetical tie breaker must pick Alice over Zachary",
    );
  });

  it("17. Legacy field projections consistent with enrichment result", () => {
    const primaryPerson: Person = {
      id: "p1",
      name: "Hannah Montana",
      role: "Founder",
      roleCategory: "founder",
      verificationStatus: "VERIFIED",
      confidence: "high",
      sourceUrl: "https://example.com",
      sourceName: "Team",
      observedAt: new Date().toISOString(),
      contactPoints: [
        {
          id: "cp1",
          type: "email",
          value: "hannah@examplebrand.com",
          scope: "individual",
          verificationStatus: "VERIFIED",
          confidence: "high",
          sourceUrl: "https://example.com",
          sourceName: "Team",
          observedAt: new Date().toISOString(),
          isDirect: true,
        },
      ],
    };

    const companyCps: ContactPoint[] = [
      {
        id: "cp2",
        type: "instagram",
        value: "https://instagram.com/examplebrand",
        scope: "company",
        verificationStatus: "VERIFIED",
        confidence: "high",
        sourceUrl: "https://example.com",
        sourceName: "Footer",
        observedAt: new Date().toISOString(),
        isDirect: false,
      },
    ];

    const legacy = projectLegacyContact(primaryPerson, companyCps, sampleCandidate);
    assert.equal(legacy.founder, "Hannah Montana");
    assert.equal(legacy.publicEmail, "hannah@examplebrand.com");
    assert.equal(legacy.instagram, "https://instagram.com/examplebrand");
    assert.equal(legacy.contactVerified, true);
  });

  it("18. Discovery pipeline integration populates all enrichment fields", async () => {
    const mockSearch: SearchProvider = {
      search: async () => [sampleCandidate],
    };

    const mockResearch: ResearchProvider = {
      scrapePage: async (url: string) => ({
        url,
        domain: "luminastudio.com",
        title: "Lumina Studio - Artisanal Ceramics",
        description: "Modern ceramic essentials for everyday living.",
        markdown: `
          # Lumina Studio
          Buy our handcrafted ceramics. $48.00 [Add to Cart]
          ### Sophia Martinez - Head of Creative & Marketing
          Sophia oversees brand storytelling and creator campaigns.
          Reach out: [Email Sophia](mailto:sophia@luminastudio.com)
        `,
        scrapedAt: new Date().toISOString(),
      }),
    };

    const radar: Radar = {
      id: "radar-phase2-3-test",
      name: "Ceramics UGC Radar",
      description: "Find DTC ceramics brands needing UGC video",
      target: "D2C ceramics brands",
      offer: "High converting TikTok and Instagram Reels UGC video packages",
      criteria: ["E-commerce store", "Creator content", "Handcrafted goods"],
      status: "active",
      leadCount: 0,
    };

    const runResult = await runDiscoveryPipeline(radar, {
      searchProvider: mockSearch,
      researchProvider: mockResearch,
    });

    assert.equal(runResult.leads.length, 1);
    const lead = runResult.leads[0];

    // Check Phase 2.3 enrichment properties on Lead
    assert.ok(lead.people, "Lead must have people array");
    assert.equal(lead.people.length, 1);
    assert.equal(lead.people[0].name, "Sophia Martinez");
    assert.equal(lead.people[0].roleCategory, "creative_marketing");

    assert.ok(lead.primaryContact, "Lead must have primaryContact");
    assert.equal(lead.primaryContact.name, "Sophia Martinez");

    assert.ok(lead.contactPoints, "Lead must have contactPoints");
    assert.ok(lead.contactPoints.length >= 1);
    assert.equal(lead.contactPoints[0].value, "sophia@luminastudio.com");

    assert.ok(lead.enrichmentSummary, "Lead must have enrichmentSummary");
    assert.equal(lead.founder, "Sophia Martinez");
    assert.equal(lead.publicEmail, "sophia@luminastudio.com");
    assert.equal(lead.contactVerified, true);
  });

  it("19. Database storage round-trip persists and retrieves enrichment fields", async () => {
    const testLeadId = `lead-test-enrichment-${Date.now()}`;
    const testLead: Lead = {
      id: testLeadId,
      radarId: "radar-db-test",
      companyName: "Artisan Craft Co",
      description: "Artisan pottery makers",
      industry: "Ceramics",
      location: "Verified web domain",
      relevance: 85,
      signals: ["E-commerce cart observed"],
      evidence: [
        {
          id: "ev-1",
          statement: "E-commerce store observed",
          sourceName: "Artisan Craft",
          sourceUrl: "https://artisancraft.com",
          sourceStatus: "connected",
          observedAt: new Date().toISOString(),
          type: "VERIFIED",
          confidence: "high",
        },
      ],
      opportunity: ["Offer UGC creator videos"],
      source: "Firecrawl Live Discovery",
      sourceStatus: "connected",
      discoveredAt: new Date().toISOString(),
      status: "researched",
      saved: false,
      contactVerified: true,
      founder: "Liam Chen",
      publicEmail: "liam@artisancraft.com",
      people: [
        {
          id: "person-1",
          name: "Liam Chen",
          role: "Co-Founder & CMO",
          roleCategory: "creative_marketing",
          verificationStatus: "VERIFIED",
          confidence: "high",
          sourceUrl: "https://artisancraft.com/team",
          sourceName: "Team",
          observedAt: new Date().toISOString(),
          contactPoints: [
            {
              id: "cp-1",
              type: "email",
              value: "liam@artisancraft.com",
              scope: "individual",
              verificationStatus: "VERIFIED",
              confidence: "high",
              sourceUrl: "https://artisancraft.com/team",
              sourceName: "Team",
              observedAt: new Date().toISOString(),
              isDirect: true,
            },
          ],
        },
      ],
      contactPoints: [
        {
          id: "cp-1",
          type: "email",
          value: "liam@artisancraft.com",
          scope: "individual",
          verificationStatus: "VERIFIED",
          confidence: "high",
          sourceUrl: "https://artisancraft.com/team",
          sourceName: "Team",
          observedAt: new Date().toISOString(),
          isDirect: true,
        },
      ],
      primaryContact: {
        id: "person-1",
        name: "Liam Chen",
        role: "Co-Founder & CMO",
        roleCategory: "creative_marketing",
        verificationStatus: "VERIFIED",
        confidence: "high",
        sourceUrl: "https://artisancraft.com/team",
        sourceName: "Team",
        observedAt: new Date().toISOString(),
        selectionReason: "Matched creative/marketing offer",
        contactPoints: [],
      },
      enrichmentSummary: "Observed 1 team member: Liam Chen (Co-Founder & CMO). Direct contact email found: liam@artisancraft.com.",
    };

    // Save and retrieve
    await saveLiveLeads([testLead]);
    const fetched = await getLiveLeadById(testLeadId);

    assert.ok(fetched, "Lead must be retrieved from storage");
    assert.equal(fetched.companyName, "Artisan Craft Co");
    assert.equal(fetched.people?.length, 1);
    assert.equal(fetched.people?.[0].name, "Liam Chen");
    assert.equal(fetched.primaryContact?.name, "Liam Chen");
    assert.equal(fetched.contactPoints?.length, 1);
    assert.equal(fetched.enrichmentSummary, testLead.enrichmentSummary);
  });

  it("20. Audit 2 — Product names, corporate terms, and UI phrases rejected by isValidPersonName", () => {
    // Product titles & merchandise phrases
    assert.equal(isValidPersonName("Rachel Green Collection"), false);
    assert.equal(isValidPersonName("Summer Linen Dress"), false);
    assert.equal(isValidPersonName("Silk Blend Shirt"), false);
    assert.equal(isValidPersonName("Cozy Wool Blanket"), false);
    assert.equal(isValidPersonName("Limited Edition Pack"), false);

    // Corporate, business, and entity names
    assert.equal(isValidPersonName("Acme Studio"), false);
    assert.equal(isValidPersonName("Global Solutions"), false);
    assert.equal(isValidPersonName("Horizon Partners"), false);
    assert.equal(isValidPersonName("Nexus Technologies"), false);

    // UI, navigation, and legal phrases
    assert.equal(isValidPersonName("Free Shipping"), false);
    assert.equal(isValidPersonName("Terms of Service"), false);
    assert.equal(isValidPersonName("Privacy Policy"), false);
    assert.equal(isValidPersonName("Customer Support Team"), false);
    assert.equal(isValidPersonName("Returns & Refunds"), false);

    // Genuine person names must pass
    assert.equal(isValidPersonName("Rachel Green"), true);
    assert.equal(isValidPersonName("Elena Rostova"), true);
    assert.equal(isValidPersonName("Marcus Vance"), true);
    assert.equal(isValidPersonName("Summer Smith"), true);
    assert.equal(isValidPersonName("Alexander von Humboldt"), true);

    // Ensure extractPeopleFromPage does not extract product names as people
    const pageWithProducts: ScrapedPage = {
      url: "https://shopbrand.com",
      domain: "shopbrand.com",
      title: "Store",
      markdown: `
        ### Rachel Green Collection - Best Seller
        ### Summer Linen Dress - New Arrival
        ### Customer Support Team - Available 24/7
        ### Elena Rostova - Founder & CEO
      `,
      scrapedAt: new Date().toISOString(),
    };
    const people = extractPeopleFromPage(pageWithProducts);
    assert.equal(people.length, 1, "Only genuine people must be extracted, not products or support teams");
    assert.equal(people[0].name, "Elena Rostova");
  });

  it("21. Audit 1 — General emails, phones, and company socials remain scope=company, isDirect=false", async () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com/team",
      domain: "luminastudio.com",
      title: "Team & Contact",
      markdown: `
        # Meet Our Team
        ### Marcus Vance - Founder & CEO
        General inquiries: mailto:info@luminastudio.com
        Support line: [Call us](tel:+15551234567)
        Company Social: https://instagram.com/luminastudio
        Company LinkedIn: https://linkedin.com/company/luminastudio
      `,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(sampleCandidate, page, {
      offer: "general consulting",
      target: "brands",
    });

    assert.equal(result.people.length, 1);
    const marcus = result.people[0];
    // General info@ email must NOT be attributed to Marcus Vance as direct email!
    assert.equal(
      marcus.contactPoints.length,
      0,
      "General email info@ must not be attributed as Marcus Vance's direct email",
    );

    // All general contact points must be in companyContactPoints with scope=company, isDirect=false
    for (const cp of result.companyContactPoints) {
      assert.equal(cp.scope, "company", `Contact ${cp.value} must have scope=company`);
      assert.equal(cp.isDirect, false, `Contact ${cp.value} must have isDirect=false`);
    }

    const emailPoint = result.companyContactPoints.find((cp) => cp.type === "email");
    const phonePoint = result.companyContactPoints.find((cp) => cp.type === "phone");
    const liPoint = result.companyContactPoints.find((cp) => cp.type === "linkedin");

    assert.ok(emailPoint);
    assert.equal(emailPoint.value, "info@luminastudio.com");
    assert.ok(phonePoint);
    assert.equal(phonePoint.value, "+15551234567");
    assert.ok(liPoint);
    assert.equal(liPoint.value, "https://www.linkedin.com/company/luminastudio");
  });

  it("22. Audit 1 — Name similarity alone does NOT create direct contact association", async () => {
    const page: ScrapedPage = {
      url: "https://luminastudio.com/about",
      domain: "luminastudio.com",
      title: "About",
      markdown: `
        # About Us
        ### Dan Smith - Lead Designer
        Dan joined in 2021.

        ---
        ## Footer & Partners
        Partner contact: mailto:danielle@externalpartner.com
        Repairs email: mailto:smith-repairs@luminastudio.com
      `,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(sampleCandidate, page, {
      offer: "design systems",
      target: "studios",
    });

    assert.equal(result.people.length, 1);
    const dan = result.people[0];
    assert.equal(dan.name, "Dan Smith");

    // Neither danielle@ nor smith-repairs@ should be associated with Dan Smith!
    assert.equal(
      dan.contactPoints.length,
      0,
      "Name substring similarity ('dan' in 'danielle', 'smith' in 'smith-repairs') must not create direct association",
    );

    // Both should be company contacts with isDirect=false
    for (const cp of result.companyContactPoints) {
      assert.equal(cp.scope, "company");
      assert.equal(cp.isDirect, false);
    }
  });

  it("23. Audit 3 — Verification invariants: verified person does not mean verified email; company can have verified contacts with 0 people", async () => {
    // Case A: Verified person without any email
    const pageA: ScrapedPage = {
      url: "https://brand.com/team",
      domain: "brand.com",
      title: "Leadership",
      markdown: `
        ### Clara Oswald - Chief Creative Officer
        Clara oversees brand identity across all media channels.
      `,
      scrapedAt: new Date().toISOString(),
    };
    const resultA = await enrichCandidate(sampleCandidate, pageA, { offer: "creative", target: "brands" });
    assert.equal(resultA.people.length, 1);
    assert.equal(resultA.people[0].verificationStatus, "VERIFIED");
    assert.equal(resultA.people[0].contactPoints.length, 0);
    assert.equal(resultA.legacyContact.founder, "Clara Oswald");
    assert.equal(resultA.legacyContact.publicEmail, null);
    assert.equal(resultA.legacyContact.contactVerified, false);

    // Case B: Company has verified mailto: contact point with 0 verified people
    const pageB: ScrapedPage = {
      url: "https://brand.com/contact",
      domain: "brand.com",
      title: "Contact Us",
      markdown: `
        # Contact Our Team
        Send all press and business inquiries to mailto:contact@brand.com.
        Customer line: [Support Phone](tel:+18005550199)
      `,
      scrapedAt: new Date().toISOString(),
    };
    const resultB = await enrichCandidate(sampleCandidate, pageB, { offer: "consulting", target: "brands" });
    assert.equal(resultB.people.length, 0, "No people on contact page");
    assert.ok(resultB.companyContactPoints.length >= 2);
    const emailCp = resultB.companyContactPoints.find((cp) => cp.type === "email");
    assert.ok(emailCp);
    assert.equal(emailCp.verificationStatus, "VERIFIED");
    assert.equal(emailCp.scope, "company");
    assert.equal(emailCp.isDirect, false);
    assert.equal(resultB.primaryContact, null, "No verified people means primaryContact is null");
  });

  it("24. Audit 4 — Primary contact: SUGGESTED person is NEVER chosen over VERIFIED/SUPPORTED person, and primaryContact is null if only SUGGESTED exist", () => {
    // Sub-case 1: Only SUGGESTED person exists -> primaryContact must be null!
    const suggestedOnly: Person[] = [
      {
        id: "p-sug-1",
        name: "Arthur Pendragon",
        role: "Head of Marketing",
        roleCategory: "creative_marketing",
        verificationStatus: "SUGGESTED",
        confidence: "low",
        sourceUrl: "https://example.com",
        sourceName: "Blog Post",
        observedAt: new Date().toISOString(),
        contactPoints: [],
      },
    ];
    const { primaryContact: res1 } = selectPrimaryContact(suggestedOnly, "UGC video ads");
    assert.equal(
      res1,
      null,
      "If only SUGGESTED people exist, primaryContact must be null (never pick an uncertain person)",
    );

    // Sub-case 2: SUGGESTED marketing person vs VERIFIED founder for UGC offer
    // The SUGGESTED marketing person must NOT be chosen over the VERIFIED founder!
    const mixedPeople: Person[] = [
      {
        id: "p-sug-cmo",
        name: "Arthur Pendragon",
        role: "Head of Marketing",
        roleCategory: "creative_marketing",
        verificationStatus: "SUGGESTED",
        confidence: "low",
        sourceUrl: "https://example.com",
        sourceName: "Blog Mention",
        observedAt: new Date().toISOString(),
        contactPoints: [],
      },
      {
        id: "p-ver-founder",
        name: "Guinevere Vance",
        role: "Founder & CEO",
        roleCategory: "founder",
        verificationStatus: "VERIFIED",
        confidence: "high",
        sourceUrl: "https://example.com/team",
        sourceName: "Team Page",
        observedAt: new Date().toISOString(),
        contactPoints: [],
      },
    ];
    const { primaryContact: res2, selectionReason: reason2 } = selectPrimaryContact(mixedPeople, "UGC video ads");
    assert.ok(res2, "Must select verified founder");
    assert.equal(
      res2.name,
      "Guinevere Vance",
      "VERIFIED founder must be selected over SUGGESTED marketing contact",
    );
    assert.ok(reason2?.includes("Founder as primary contact because no dedicated marketing"));
  });

  it("25. Audit 5 — Secondary scrape boundary: same-domain only, max 1 scrape, graceful degradation on failure", async () => {
    // Verify findSecondaryScrapeTargets rejects external domains
    const markdownWithExternalLinks = `
      Check out our [Team](https://external-payroll-system.com/team)
      Or read [About us on Medium](https://medium.com/@brand/about)
      Internal contact: [Contact](/contact)
    `;
    const targets = findSecondaryScrapeTargets(markdownWithExternalLinks, "https://brand.com");
    assert.equal(targets.teamUrl, undefined, "External team URL must be rejected");
    assert.equal(targets.aboutUrl, undefined, "External about URL must be rejected");
    assert.equal(targets.contactUrl, "https://brand.com/contact", "Internal contact URL must be kept");

    // Graceful degradation when secondary scrape throws network error or timeout
    const failingResearch: ResearchProvider = {
      scrapePage: async () => {
        throw new Error("HTTP 504 Gateway Timeout");
      },
    };

    const primaryPage: ScrapedPage = {
      url: "https://brand.com",
      domain: "brand.com",
      title: "Home",
      markdown: `
        Welcome to Brand! Visit our [Team](/team) page.
        Email: mailto:hello@brand.com
      `,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(
      sampleCandidate,
      primaryPage,
      { offer: "consulting", target: "brands" },
      failingResearch,
    );

    // Pipeline must not throw; must proceed with primary page findings
    assert.equal(result.people.length, 0);
    assert.equal(result.companyContactPoints.length, 1);
    assert.equal(result.companyContactPoints[0].value, "hello@brand.com");
    assert.ok(
      result.summary.includes("No team members or leadership profiles observed on researched public pages"),
      "Summary must reflect absence honestly",
    );
  });

  it("26. Audit 5 — Honest absence wording: never declares universal absence", async () => {
    const page: ScrapedPage = {
      url: "https://brand.com",
      domain: "brand.com",
      title: "Home",
      markdown: `# Simple Landing Page\nOur products are coming soon.`,
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichCandidate(sampleCandidate, page, {
      offer: "growth services",
      target: "brands",
    });

    assert.ok(result.summary.includes("observed on researched public pages"));
    assert.equal(result.summary.includes("this company has no leadership"), false);
    assert.equal(result.summary.includes("the company has no team"), false);
    assert.equal(result.summary.includes("has no email"), false);
  });
});
