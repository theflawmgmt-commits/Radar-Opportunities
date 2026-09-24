import type {
  Activity,
  Dashboard,
  Evidence,
  Lead,
  Outreach,
  Pipeline,
  Radar,
} from "@workspace/api-zod";

const demoRadar: Radar = {
  id: "radar-inframe",
  name: "InFrame",
  description: "Brands that could benefit from creator-led product stories.",
  target: "Indian consumer brands",
  offer: "Short-form UGC videos",
  criteria: ["Active social presence", "Recent launches", "Low creator-content presence"],
  status: "active",
  leadCount: 10,
};

import { buildOpportunityBrief } from "./opportunity-brief";

const evidence = (id: string, statement: string, sourceName: string): Evidence => ({
  id,
  statement,
  sourceName,
  sourceUrl: null,
  sourceStatus: "demo",
  observedAt: "2026-09-18",
});

const demoLead = (
  id: string,
  companyName: string,
  industry: string,
  location: string,
  description: string,
  relevance: number,
  signals: string[],
  opportunity: string[],
  founder: string | null,
  publicEmail: string | null,
  website: string | null,
  instagram: string | null,
  status: Lead["status"] = "new",
): Lead => {
  const lead: Lead = {
    id,
    companyName,
    website,
    instagram,
    linkedin: null,
    description,
    industry,
    location,
    founder,
    publicEmail,
    relevance,
    signals,
    evidence: signals.map((signal, index) => evidence(`${id}-e${index + 1}`, signal, "RADAR demo research")),
    opportunity,
    source: "RADAR demo dataset",
    sourceStatus: "demo",
    discoveredAt: "2026-09-18",
    radarId: demoRadar.id,
    status,
    saved: false,
    contactVerified: false,
  };
  lead.opportunityBrief = buildOpportunityBrief(lead);
  return lead;
};

export const leads: Lead[] = [
  demoLead(
    "lead-xyz-pet-foods",
    "XYZ Pet Foods",
    "Pet food",
    "Mumbai, India",
    "A direct-to-consumer pet nutrition brand focused on freshly made meals and treats.",
    92,
    ["Active Instagram presence", "Recently launched a salmon topper", "Recent content is primarily product photography", "Limited creator-style content detected"],
    ["UGC", "Product demonstration", "Founder story"],
    "Priya Sharma",
    null,
    "https://example.com/xyz-pet-foods",
    "https://instagram.com/xyzpetfoods",
    "researched",
  ),
  demoLead(
    "lead-nestle-home",
    "Nestle Home",
    "Home goods",
    "Bengaluru, India",
    "A small-batch home fragrance studio selling refillable candles and room mists.",
    86,
    ["Growing social presence", "New refill line announced", "Strong customer questions in comments", "Few customer-facing videos"],
    ["UGC", "Unboxing", "How-to content"],
    null,
    "Not found",
    "https://example.com/nestle-home",
    "https://instagram.com/nestlehome.demo",
    "ready",
  ),
  demoLead(
    "lead-luma-skin",
    "Luma Skin Lab",
    "Beauty",
    "Delhi, India",
    "A skin-care label built around simple routines for humid climates.",
    88,
    ["Recent product launch", "Educational posts receive high comment volume", "No visible creator testimonials", "Active founder-led account"],
    ["Routine videos", "Founder-led education", "Product demo"],
    "Anika Rao",
    null,
    "https://example.com/luma-skin",
    "https://instagram.com/lumaskin.demo",
  ),
  demoLead(
    "lead-monsoon-coffee",
    "Monsoon Coffee Co.",
    "Food and beverage",
    "Pune, India",
    "A specialty coffee subscription with rotating Indian estate beans.",
    81,
    ["Subscription offer recently refreshed", "Strong visual product identity", "Limited brewing education", "Active community replies"],
    ["Brew tutorials", "Unboxing", "Customer story"],
    null,
    null,
    "https://example.com/monsoon-coffee",
    "https://instagram.com/monsooncoffee.demo",
  ),
  demoLead(
    "lead-mitti-play",
    "Mitti Play",
    "Toys and games",
    "Jaipur, India",
    "An independent maker of tactile, screen-free games for young families.",
    79,
    ["New game set announced", "Parents ask for play examples", "Product photography dominates recent feed", "Founder is active in comments"],
    ["Play-through video", "Parent testimonial", "Product demo"],
    "Kabir Mehta",
    null,
    "https://example.com/mitti-play",
    "https://instagram.com/mittiplay.demo",
  ),
  demoLead(
    "lead-arc-studio",
    "Arc Studio Objects",
    "Interiors",
    "Ahmedabad, India",
    "A design studio creating small-batch objects for modern Indian homes.",
    77,
    ["Portfolio updated recently", "Strong editorial product images", "No short-form process content found", "New collection mentioned in bio"],
    ["Studio tour", "Making-of story", "Collection launch"],
    null,
    null,
    "https://example.com/arc-studio-objects",
    "https://instagram.com/arcstudioobjects.demo",
    "ready",
  ),
  demoLead(
    "lead-woven-days",
    "Woven Days",
    "Apparel",
    "Kochi, India",
    "A slow-fashion label working with handloom cotton and small production runs.",
    75,
    ["New summer edit listed", "Customers ask about fit and fabric", "Mostly flat-lay imagery", "Consistent Instagram activity"],
    ["Try-on video", "Fabric story", "Founder interview"],
    null,
    "hello@woven-days.example",
    "https://example.com/woven-days",
    "https://instagram.com/wovendays.demo",
    "contacted",
  ),
  demoLead(
    "lead-brightpath",
    "BrightPath Learning",
    "Education",
    "Hyderabad, India",
    "A career-skills platform for early professionals switching into product roles.",
    73,
    ["New cohort opening", "Active webinar calendar", "Landing page relies on text-heavy explanations", "Student proof is mostly written"],
    ["Student story", "Course walkthrough", "Explainer"],
    null,
    null,
    "https://example.com/brightpath-learning",
    "https://instagram.com/brightpath.demo",
  ),
  demoLead(
    "lead-field-notes",
    "Field Notes Supply",
    "Stationery",
    "Chennai, India",
    "A stationery label for planners, sketchers, and people who work away from a desk.",
    71,
    ["New weekly planner release", "Strong repeat-customer comments", "Product details need close-up demonstrations", "Consistent founder posts"],
    ["Desk setup", "Product demo", "Customer routine"],
    "Nisha Menon",
    null,
    "https://example.com/field-notes-supply",
    "https://instagram.com/fieldnotessupply.demo",
  ),
  demoLead(
    "lead-terracotta-labs",
    "Terracotta Labs",
    "Wellness",
    "Goa, India",
    "A small wellness company making botanical bath and body products in small runs.",
    68,
    ["Seasonal bundle recently introduced", "Active product education", "Packaging is visually distinctive", "Few human-led demonstrations"],
    ["Unboxing", "Routine video", "Founder story"],
    null,
    null,
    "https://example.com/terracotta-labs",
    "https://instagram.com/terracottalabs.demo",
  ),
];

export const radars: Radar[] = [demoRadar];
export const outreach: Outreach[] = [
  {
    id: "outreach-woven-days",
    leadId: "lead-woven-days",
    companyName: "Woven Days",
    channel: "email",
    subject: "A simple way to show the new summer edit in motion",
    message:
      "Hi Woven Days team — the new summer edit is a strong fit for short try-on and fabric-detail videos. I make concise UGC that helps shoppers understand how a piece moves and feels before they buy. Would it be useful if I sent over three concepts for the edit?",
    whyThisMessage: "It references the new summer edit and the specific fit questions visible in the demo research.",
    status: "draft",
    createdAt: "2026-09-19",
    canSend: false,
  },
];

export const activity: Activity[] = [
  {
    id: "activity-1",
    type: "opportunity",
    title: "XYZ Pet Foods",
    detail: "Strong Instagram activity · Recent product launch · Potential: UGC",
    leadId: "lead-xyz-pet-foods",
    createdAt: "2026-09-18",
  },
  {
    id: "activity-2",
    type: "follow_up",
    title: "Woven Days",
    detail: "Contacted 4 days ago · Follow-up draft ready",
    leadId: "lead-woven-days",
    createdAt: "2026-09-19",
  },
  {
    id: "activity-3",
    type: "opportunity",
    title: "Luma Skin Lab",
    detail: "Recently launched · Potential: routine videos",
    leadId: "lead-luma-skin",
    createdAt: "2026-09-18",
  },
];

export const getDashboard = (): Dashboard => ({
  newOpportunities: leads.filter((lead) => lead.status === "new").length,
  needsAttention: leads.filter((lead) => ["ready", "contacted"].includes(lead.status)).length,
  outreachReady: leads.filter((lead) => lead.status === "ready").length,
  totalLeads: leads.length,
  demoMode: true,
  activeRadar: radars[0] ?? null,
});

export const getPipeline = (): Pipeline => ({
  columns: ["new", "researched", "ready", "contacted", "replied", "interested", "won", "lost"].reduce(
    (columns, status) => {
      columns[status] = leads.filter((lead) => lead.status === status);
      return columns;
    },
    {} as Record<string, Lead[]>,
  ),
});

export const findLead = (id: string) => leads.find((lead) => lead.id === id);
export const findRadar = (id: string) => radars.find((radar) => radar.id === id);
export const findOutreach = (id: string) => outreach.find((draft) => draft.id === id);