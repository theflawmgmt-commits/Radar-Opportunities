import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const radarsTable = pgTable("radars", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  target: text("target").notNull(),
  offer: text("offer").notNull(),
  criteria: jsonb("criteria").$type<string[]>().notNull(),
  status: text("status").notNull().default("active"),
  leadCount: integer("lead_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leadsTable = pgTable("leads", {
  id: text("id").primaryKey(),
  radarId: text("radar_id").notNull(),
  companyName: text("company_name").notNull(),
  website: text("website"),
  instagram: text("instagram"),
  linkedin: text("linkedin"),
  description: text("description").notNull(),
  industry: text("industry").notNull(),
  location: text("location").notNull(),
  founder: text("founder"),
  publicEmail: text("public_email"),
  relevance: integer("relevance").notNull(),
  signals: jsonb("signals").$type<string[]>().notNull(),
  evidence: jsonb("evidence").$type<unknown[]>().notNull(),
  opportunity: jsonb("opportunity").$type<string[]>().notNull(),
  source: text("source").notNull(),
  sourceStatus: text("source_status").notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("new"),
  saved: boolean("saved").notNull().default(false),
  contactVerified: boolean("contact_verified").notNull().default(false),
  fit: text("fit"),
  scoreBreakdown: jsonb("score_breakdown").$type<unknown>(),
  observableSignals: jsonb("observable_signals").$type<unknown[]>(),
});

export const outreachTable = pgTable("outreach", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull(),
  companyName: text("company_name").notNull(),
  channel: text("channel").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  whyThisMessage: text("why_this_message").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  canSend: boolean("can_send").notNull().default(false),
});

export const insertRadarSchema = createInsertSchema(radarsTable).omit({ createdAt: true });
export const insertLeadSchema = createInsertSchema(leadsTable).omit({ discoveredAt: true });
export const insertOutreachSchema = createInsertSchema(outreachTable).omit({ createdAt: true });

export type RadarRecord = z.infer<typeof insertRadarSchema>;
export type LeadRecord = z.infer<typeof insertLeadSchema>;
export type OutreachRecord = z.infer<typeof insertOutreachSchema>;