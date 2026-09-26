import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  saveLiveRadar,
  getLiveRadarById,
  updateLiveRadar,
  saveLiveLeads,
  getLiveLeadById,
  updateLiveLead,
} from "../services/db-storage";
import { PIPELINE_STAGES, getPipeline, leads as demoLeads } from "../services/radar-data";
import type { Lead, Radar } from "@workspace/api-zod";

describe("Phase 2.6 & 2.7 — Radar & Pipeline Lifecycle", () => {
  describe("Radar Lifecycle & Non-Destructive Archiving", () => {
    it("creates, retrieves, updates, and archives a radar non-destructively", async () => {
      const radarId = `radar-test-lifecycle-${Date.now()}`;
      const radar: Radar = {
        id: radarId,
        name: "Eco Footwear",
        description: "Sustainable footwear brands",
        target: "Eco footwear",
        offer: "UGC video ads",
        geography: "Europe",
        intent: "DTC footwear brands scaling online sales",
        criteria: ["Sustainable materials", "Online store"],
        status: "active",
        leadCount: 0,
      };

      // 1. Create / Save
      await saveLiveRadar(radar);
      const retrieved = await getLiveRadarById(radarId);
      assert.ok(retrieved);
      assert.equal(retrieved.name, "Eco Footwear");
      assert.equal(retrieved.geography, "Europe");
      assert.equal(retrieved.intent, "DTC footwear brands scaling online sales");
      assert.equal(retrieved.status, "active");

      // 2. Update metadata
      const updated = await updateLiveRadar(radarId, {
        name: "Eco Footwear & Apparel",
        offer: "Full UGC and social creative suite",
      });
      assert.ok(updated);
      assert.equal(updated.name, "Eco Footwear & Apparel");
      assert.equal(updated.offer, "Full UGC and social creative suite");

      // 3. Non-destructive archiving
      const archived = await updateLiveRadar(radarId, { status: "archived" });
      assert.ok(archived);
      assert.equal(archived.status, "archived");

      // 4. Verify radar still exists and is retrievable (no data loss)
      const postArchive = await getLiveRadarById(radarId);
      assert.ok(postArchive, "Archived radar must still exist in storage");
      assert.equal(postArchive.status, "archived");
      assert.equal(postArchive.name, "Eco Footwear & Apparel");
    });
  });

  describe("Lead Lifecycle & Pipeline Stages", () => {
    it("supports all 9 lifecycle states: discovered → review → shortlisted → outreach_ready → contacted → replied → won → lost → archived", async () => {
      const expectedStages = [
        "discovered",
        "review",
        "shortlisted",
        "outreach_ready",
        "contacted",
        "replied",
        "won",
        "lost",
        "archived",
      ] as const;

      assert.deepEqual(
        Array.from(PIPELINE_STAGES),
        Array.from(expectedStages),
        "Pipeline must define exactly the 9 lifecycle states",
      );

      const leadId = `lead-test-stages-${Date.now()}`;
      const sampleLead: Lead = {
        id: leadId,
        radarId: "radar-stage-test",
        companyName: "Stage Progression Co.",
        website: "https://stageprogression.example.com",
        instagram: null,
        linkedin: null,
        description: "Testing stage transitions",
        industry: "Apparel",
        location: "Mumbai, India",
        founder: null,
        publicEmail: null,
        relevance: 80,
        signals: ["Active store"],
        evidence: [],
        opportunity: ["UGC videos"],
        source: "Manual test",
        sourceStatus: "connected",
        discoveredAt: new Date().toISOString(),
        status: "discovered",
        saved: false,
        contactVerified: false,
      };

      await saveLiveLeads([sampleLead]);
      const initial = await getLiveLeadById(leadId);
      assert.ok(initial);
      assert.equal(initial.status, "discovered");

      // Progress through all stages sequentially
      for (const stage of expectedStages) {
        const updated = await updateLiveLead(leadId, { status: stage });
        assert.ok(updated);
        assert.equal(updated.status, stage, `Lead status should transition to ${stage}`);
      }
    });

    it("pipeline organizes leads into distinct columns without data loss", () => {
      const pipeline = getPipeline();
      assert.ok(pipeline.columns);

      for (const stage of PIPELINE_STAGES) {
        assert.ok(
          Array.isArray(pipeline.columns[stage]),
          `Column for ${stage} must exist and be an array`,
        );
      }

      // Check total demo leads mapped to pipeline columns matches demo dataset count
      let totalPipelineLeads = 0;
      for (const stage of PIPELINE_STAGES) {
        totalPipelineLeads += pipeline.columns[stage]?.length ?? 0;
      }
      assert.equal(totalPipelineLeads, demoLeads.length);
    });
  });
});
