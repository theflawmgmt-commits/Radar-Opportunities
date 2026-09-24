import { db, getDb, isDatabaseConfigured, leadsTable, radarsTable } from "@workspace/db";
import type { Lead, Radar } from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { buildOpportunityBrief } from "./opportunity-brief";

export function withOpportunityBrief(lead: Lead): Lead {
  return {
    ...lead,
    opportunityBrief: lead.opportunityBrief ?? buildOpportunityBrief(lead),
  };
}

// Fallback in-memory store for live records when PostgreSQL is not configured in dev
const inMemoryLiveRadars = new Map<string, Radar>();
const inMemoryLiveLeads = new Map<string, Lead>();

export function isDbConnected(): boolean {
  return isDatabaseConfigured && db !== null;
}

export async function saveLiveRadar(radar: Radar): Promise<Radar> {
  if (isDbConnected()) {
    try {
      const database = getDb();
      await database
        .insert(radarsTable)
        .values({
          id: radar.id,
          name: radar.name,
          description: radar.description,
          target: radar.target,
          offer: radar.offer,
          criteria: radar.criteria,
          status: radar.status,
          leadCount: radar.leadCount,
        })
        .onConflictDoUpdate({
          target: radarsTable.id,
          set: {
            name: radar.name,
            description: radar.description,
            target: radar.target,
            offer: radar.offer,
            criteria: radar.criteria,
            status: radar.status,
            leadCount: radar.leadCount,
          },
        });
      logger.info({ radarId: radar.id }, "Live radar saved to PostgreSQL");
    } catch (err) {
      logger.error({ err, radarId: radar.id }, "Error saving live radar to database, using memory fallback");
    }
  }

  inMemoryLiveRadars.set(radar.id, radar);
  return radar;
}

export async function saveLiveLeads(leads: Lead[]): Promise<void> {
  const preparedLeads = leads.map(withOpportunityBrief);
  for (const lead of preparedLeads) {
    inMemoryLiveLeads.set(lead.id, lead);
  }

  if (isDbConnected() && preparedLeads.length > 0) {
    try {
      const database = getDb();
      for (const lead of preparedLeads) {
        await database
          .insert(leadsTable)
          .values({
            id: lead.id,
            radarId: lead.radarId,
            companyName: lead.companyName,
            website: lead.website ?? null,
            instagram: lead.instagram ?? null,
            linkedin: lead.linkedin ?? null,
            description: lead.description,
            industry: lead.industry,
            location: lead.location,
            founder: lead.founder ?? null,
            publicEmail: lead.publicEmail ?? null,
            relevance: lead.relevance,
            signals: lead.signals,
            evidence: lead.evidence,
            opportunity: lead.opportunity,
            source: lead.source,
            sourceStatus: lead.sourceStatus,
            discoveredAt: new Date(lead.discoveredAt),
            status: lead.status,
            saved: lead.saved,
            contactVerified: lead.contactVerified,
            fit: lead.fit ?? null,
            scoreBreakdown: lead.scoreBreakdown ?? null,
            observableSignals: lead.observableSignals ?? null,
            people: lead.people ?? null,
            contactPoints: lead.contactPoints ?? null,
            primaryContact: lead.primaryContact ?? null,
            enrichmentSummary: lead.enrichmentSummary ?? null,
          })
          .onConflictDoUpdate({
            target: leadsTable.id,
            set: {
              status: lead.status,
              saved: lead.saved,
              relevance: lead.relevance,
              signals: lead.signals,
              evidence: lead.evidence,
              opportunity: lead.opportunity,
              fit: lead.fit ?? null,
              scoreBreakdown: lead.scoreBreakdown ?? null,
              observableSignals: lead.observableSignals ?? null,
              people: lead.people ?? null,
              contactPoints: lead.contactPoints ?? null,
              primaryContact: lead.primaryContact ?? null,
              enrichmentSummary: lead.enrichmentSummary ?? null,
            },
          });
      }
      logger.info({ count: leads.length }, "Live leads saved to PostgreSQL");
    } catch (err) {
      logger.error({ err }, "Error saving live leads to database");
    }
  }
}

export async function getLiveLeadsForRadar(
  radarId: string,
  search?: string,
): Promise<Lead[]> {
  const query = search?.toLowerCase();

  if (isDbConnected()) {
    try {
      const database = getDb();
      const rows = await database
        .select()
        .from(leadsTable)
        .where(eq(leadsTable.radarId, radarId));

      return rows
        .map((row) =>
          withOpportunityBrief({
            id: row.id,
            radarId: row.radarId,
            companyName: row.companyName,
            website: row.website,
            instagram: row.instagram,
            linkedin: row.linkedin,
            description: row.description,
            industry: row.industry,
            location: row.location,
            founder: row.founder,
            publicEmail: row.publicEmail,
            relevance: row.relevance,
            signals: row.signals as string[],
            evidence: row.evidence as Lead["evidence"],
            opportunity: row.opportunity as string[],
            source: row.source,
            sourceStatus: row.sourceStatus as Lead["sourceStatus"],
            discoveredAt: row.discoveredAt.toISOString(),
            status: row.status as Lead["status"],
            saved: row.saved,
            contactVerified: row.contactVerified,
            fit: (row.fit as Lead["fit"]) ?? undefined,
            scoreBreakdown: (row.scoreBreakdown as Lead["scoreBreakdown"]) ?? undefined,
            observableSignals: (row.observableSignals as Lead["observableSignals"]) ?? undefined,
            people: (row.people as Lead["people"]) ?? undefined,
            contactPoints: (row.contactPoints as Lead["contactPoints"]) ?? undefined,
            primaryContact: (row.primaryContact as Lead["primaryContact"]) ?? undefined,
            enrichmentSummary: row.enrichmentSummary ?? undefined,
          }),
        )
        .filter((lead) => {
          if (!query) return true;
          return [
            lead.companyName,
            lead.industry,
            lead.location,
            lead.description,
          ].some((val) => val.toLowerCase().includes(query));
        });
    } catch (err) {
      logger.error({ err, radarId }, "Failed to query live leads from PostgreSQL, using memory");
    }
  }

  // Fallback to in-memory live leads
  return Array.from(inMemoryLiveLeads.values())
    .map(withOpportunityBrief)
    .filter((lead) => lead.radarId === radarId)
    .filter((lead) => {
      if (!query) return true;
      return [
        lead.companyName,
        lead.industry,
        lead.location,
        lead.description,
      ].some((val) => val.toLowerCase().includes(query));
    });
}

export async function getAllLiveLeads(search?: string): Promise<Lead[]> {
  const query = search?.toLowerCase();

  if (isDbConnected()) {
    try {
      const database = getDb();
      const rows = await database.select().from(leadsTable);

      return rows
        .map((row) =>
          withOpportunityBrief({
            id: row.id,
            radarId: row.radarId,
            companyName: row.companyName,
            website: row.website,
            instagram: row.instagram,
            linkedin: row.linkedin,
            description: row.description,
            industry: row.industry,
            location: row.location,
            founder: row.founder,
            publicEmail: row.publicEmail,
            relevance: row.relevance,
            signals: row.signals as string[],
            evidence: row.evidence as Lead["evidence"],
            opportunity: row.opportunity as string[],
            source: row.source,
            sourceStatus: row.sourceStatus as Lead["sourceStatus"],
            discoveredAt: row.discoveredAt.toISOString(),
            status: row.status as Lead["status"],
            saved: row.saved,
            contactVerified: row.contactVerified,
            fit: (row.fit as Lead["fit"]) ?? undefined,
            scoreBreakdown: (row.scoreBreakdown as Lead["scoreBreakdown"]) ?? undefined,
            observableSignals: (row.observableSignals as Lead["observableSignals"]) ?? undefined,
            people: (row.people as Lead["people"]) ?? undefined,
            contactPoints: (row.contactPoints as Lead["contactPoints"]) ?? undefined,
            primaryContact: (row.primaryContact as Lead["primaryContact"]) ?? undefined,
            enrichmentSummary: row.enrichmentSummary ?? undefined,
          }),
        )
        .filter((lead) => {
          if (!query) return true;
          return [
            lead.companyName,
            lead.industry,
            lead.location,
            lead.description,
          ].some((val) => val.toLowerCase().includes(query));
        });
    } catch (err) {
      logger.error({ err }, "Failed to query all live leads from PostgreSQL, using memory");
    }
  }

  return Array.from(inMemoryLiveLeads.values())
    .map(withOpportunityBrief)
    .filter((lead) => {
      if (!query) return true;
      return [
        lead.companyName,
        lead.industry,
        lead.location,
        lead.description,
      ].some((val) => val.toLowerCase().includes(query));
    });
}

export async function getLiveLeadById(leadId: string): Promise<Lead | null> {
  if (isDbConnected()) {
    try {
      const database = getDb();
      const rows = await database
        .select()
        .from(leadsTable)
        .where(eq(leadsTable.id, leadId))
        .limit(1);

      if (rows[0]) {
        const row = rows[0];
        return withOpportunityBrief({
          id: row.id,
          radarId: row.radarId,
          companyName: row.companyName,
          website: row.website,
          instagram: row.instagram,
          linkedin: row.linkedin,
          description: row.description,
          industry: row.industry,
          location: row.location,
          founder: row.founder,
          publicEmail: row.publicEmail,
          relevance: row.relevance,
          signals: row.signals as string[],
          evidence: row.evidence as Lead["evidence"],
          opportunity: row.opportunity as string[],
          source: row.source,
          sourceStatus: row.sourceStatus as Lead["sourceStatus"],
          discoveredAt: row.discoveredAt.toISOString(),
          status: row.status as Lead["status"],
          saved: row.saved,
          contactVerified: row.contactVerified,
          fit: (row.fit as Lead["fit"]) ?? undefined,
          scoreBreakdown: (row.scoreBreakdown as Lead["scoreBreakdown"]) ?? undefined,
          observableSignals: (row.observableSignals as Lead["observableSignals"]) ?? undefined,
          people: (row.people as Lead["people"]) ?? undefined,
          contactPoints: (row.contactPoints as Lead["contactPoints"]) ?? undefined,
          primaryContact: (row.primaryContact as Lead["primaryContact"]) ?? undefined,
          enrichmentSummary: row.enrichmentSummary ?? undefined,
        });
      }
    } catch (err) {
      logger.error({ err, leadId }, "Failed to fetch live lead from PostgreSQL");
    }
  }

  const inMemory = inMemoryLiveLeads.get(leadId);
  return inMemory ? withOpportunityBrief(inMemory) : null;
}

export async function updateLiveLead(
  leadId: string,
  updates: Partial<Pick<Lead, "status" | "saved">>,
): Promise<Lead | null> {
  const existing = inMemoryLiveLeads.get(leadId);
  if (existing) {
    Object.assign(existing, updates);
  }

  if (isDbConnected()) {
    try {
      const database = getDb();
      await database
        .update(leadsTable)
        .set(updates)
        .where(eq(leadsTable.id, leadId));
    } catch (err) {
      logger.error({ err, leadId }, "Failed to update live lead in PostgreSQL");
    }
  }

  return existing ? withOpportunityBrief(existing) : (await getLiveLeadById(leadId));
}
