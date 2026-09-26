import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../app";
import { saveLiveLeads } from "../services/db-storage";
import type { Lead } from "@workspace/api-zod";

async function withServer(fn: (baseUrl: string) => Promise<void>) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Phase 2.8 — Human-Reviewed Outreach Drafting", () => {
  it("drafts evidence-grounded outreach addressed to verified primary contact", async () => {
    await withServer(async (baseUrl) => {
      const leadId = `lead-outreach-person-${Date.now()}`;
      const testLead: Lead = {
        id: leadId,
        radarId: "radar-outreach-test",
        companyName: "Nordic Woolens",
        website: "https://nordicwoolens.example.com",
        instagram: "https://instagram.com/nordicwoolens",
        linkedin: null,
        description: "Hand-knit merino wool garments from sustainable farms",
        industry: "Apparel",
        location: "Oslo, Norway",
        founder: "Freja Lindqvist",
        publicEmail: "freja@nordicwoolens.example.com",
        relevance: 88,
        signals: ["Recently released thermal cardigan line", "High comment engagement on care guide posts"],
        evidence: [],
        opportunity: ["Short-form try-on videos demonstrating garment drape and weight"],
        source: "Manual test",
        sourceStatus: "connected",
        discoveredAt: new Date().toISOString(),
        status: "outreach_ready",
        saved: true,
        contactVerified: true,
        primaryContact: {
          id: "person-freja",
          name: "Freja Lindqvist",
          role: "Founder & Creative Director",
          roleCategory: "founder",
          verificationStatus: "VERIFIED",
          confidence: "high",
          observedAt: new Date().toISOString(),
          contactPoints: [],
          selectionReason: "Direct leadership of creative and product direction",
          sourceUrl: "https://nordicwoolens.example.com/about",
          sourceName: "About Page",
        },
        observableSignals: [
          {
            id: "sig-1",
            statement: "Recently released thermal cardigan line",
            sourceUrl: "https://nordicwoolens.example.com/shop",
            sourceName: "Store Page",
            type: "VERIFIED",
            confidence: "high",
          },
        ],
      };

      await saveLiveLeads([testLead]);

      const res = await fetch(`${baseUrl}/api/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          offer: "Short-form try-on videos",
          channel: "email",
          tone: "human",
          recipientScope: "person",
        }),
      });

      assert.equal(res.status, 201);
      const draft = (await res.json()) as any;

      // Strict Personalization checks
      assert.ok(draft.message.startsWith("Hi Freja —"), "Greeting must use verified contact's first name");
      assert.ok(
        draft.message.includes("Founder & Creative Director"),
        "Message must accurately mention verified role without hallucinating",
      );
      assert.ok(
        draft.message.toLowerCase().includes("thermal cardigan") ||
          draft.message.toLowerCase().includes("nordic woolens"),
        "Message must reference observable facts from evidence",
      );

      // Strict Guardrails
      assert.equal(draft.canSend, false, "canSend must strictly be false — human review required");
      assert.equal(draft.status, "draft", "Draft must have status: draft");
      assert.ok(draft.whyThisMessage.includes("Freja Lindqvist"), "Rationale must document attribution");
    });
  });

  it("drafts company-scoped outreach when only company contact or no personal contact exists", async () => {
    await withServer(async (baseUrl) => {
      const leadId = `lead-outreach-company-${Date.now()}`;
      const testLead: Lead = {
        id: leadId,
        radarId: "radar-outreach-test",
        companyName: "Sol Botanics",
        website: "https://solbotanics.example.com",
        instagram: null,
        linkedin: null,
        description: "Plant-derived skincare serums with zero synthetics",
        industry: "Beauty",
        location: "California, USA",
        founder: null,
        publicEmail: "hello@solbotanics.example.com",
        relevance: 82,
        signals: ["Launched vitamin C daytime serum", "Product photography dominates feed"],
        evidence: [],
        opportunity: ["Routine demonstration videos highlighting ingredient texture"],
        source: "Manual test",
        sourceStatus: "connected",
        discoveredAt: new Date().toISOString(),
        status: "review",
        saved: false,
        contactVerified: false,
        primaryContact: null,
        observableSignals: [
          {
            id: "sig-1",
            statement: "Launched vitamin C daytime serum",
            sourceUrl: "https://solbotanics.example.com/shop",
            sourceName: "Store Catalog",
            type: "VERIFIED",
            confidence: "high",
          },
        ],
      };

      await saveLiveLeads([testLead]);

      const res = await fetch(`${baseUrl}/api/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          offer: "UGC routine videos",
          channel: "email",
          tone: "human",
          recipientScope: "company",
        }),
      });

      assert.equal(res.status, 201);
      const draft = (await res.json()) as any;

      // Company scope checks
      assert.ok(draft.message.startsWith("Hi Sol Botanics team —"), "Greeting must address the company team");
      assert.ok(
        draft.message.toLowerCase().includes("vitamin c") ||
          draft.message.toLowerCase().includes("sol botanics"),
        "Message must ground in observed signal without inventing facts",
      );

      // Strict Guardrails
      assert.equal(draft.canSend, false, "canSend must strictly be false");
      assert.equal(draft.status, "draft");
      assert.ok(draft.whyThisMessage.toLowerCase().includes("company-scoped"));
    });
  });

  it("adapts format to selected communication channel without changing factual groundings", async () => {
    await withServer(async (baseUrl) => {
      const leadId = `lead-outreach-channel-${Date.now()}`;
      const testLead: Lead = {
        id: leadId,
        radarId: "radar-outreach-test",
        companyName: "Peak Apparel",
        website: "https://peakapparel.example.com",
        instagram: "https://instagram.com/peakapparel",
        linkedin: null,
        description: "Technical trail running apparel",
        industry: "Athletic wear",
        location: "Denver, Colorado",
        founder: "Alex Morgan",
        publicEmail: null,
        relevance: 79,
        signals: ["New weatherproof shell jacket announced"],
        evidence: [],
        opportunity: ["Field test review videos in rainy conditions"],
        source: "Manual test",
        sourceStatus: "connected",
        discoveredAt: new Date().toISOString(),
        status: "shortlisted",
        saved: true,
        contactVerified: true,
        primaryContact: {
          id: "person-alex",
          name: "Alex Morgan",
          role: "Head of Marketing",
          roleCategory: "creative_marketing",
          verificationStatus: "VERIFIED",
          confidence: "high",
          observedAt: new Date().toISOString(),
          contactPoints: [],
          selectionReason: "Direct marketing role matching offer",
          sourceUrl: "https://peakapparel.example.com/team",
          sourceName: "Team",
        },
      };

      await saveLiveLeads([testLead]);

      // Test LinkedIn channel
      const resLinkedIn = await fetch(`${baseUrl}/api/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          offer: "Field test video reviews",
          channel: "linkedin",
          tone: "human",
        }),
      });

      assert.equal(resLinkedIn.status, 201);
      const draftLinkedIn = (await resLinkedIn.json()) as any;
      assert.equal(draftLinkedIn.channel, "linkedin");
      assert.equal(draftLinkedIn.subject, "", "LinkedIn messages do not have an email subject header");
      assert.ok(draftLinkedIn.message.includes("Hi Alex —"));
      assert.equal(draftLinkedIn.canSend, false);

      // Test Instagram channel
      const resIG = await fetch(`${baseUrl}/api/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          offer: "Field test video reviews",
          channel: "instagram",
          tone: "human",
        }),
      });

      assert.equal(resIG.status, 201);
      const draftIG = (await resIG.json()) as any;
      assert.equal(draftIG.channel, "instagram");
      assert.equal(draftIG.subject, "");
      assert.ok(draftIG.message.includes("Hi Alex —"));
      assert.equal(draftIG.canSend, false);
    });
  });
});
