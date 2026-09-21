import { Router, type IRouter } from "express";
import {
  CreateOutreachBody,
  CreateOutreachResponse,
  CreateRadarBody,
  CreateRadarResponse,
  GetDashboardResponse,
  GetLeadParams,
  GetLeadResponse,
  GetPipelineResponse,
  GetRadarParams,
  GetRadarResponse,
  ListActivityResponse,
  ListLeadsQueryParams,
  ListLeadsResponse,
  ListOutreachResponse,
  ListRadarsResponse,
  RunRadarBody,
  RunRadarParams,
  RunRadarResponse,
  UpdateLeadBody,
  UpdateLeadParams,
  UpdateLeadResponse,
  UpdateOutreachBody,
  UpdateOutreachParams,
  UpdateOutreachResponse,
  UpdatePipelineStageBody,
  UpdatePipelineStageParams,
  UpdatePipelineStageResponse,
} from "@workspace/api-zod";
import {
  activity,
  findLead,
  findOutreach,
  findRadar,
  getDashboard,
  getPipeline,
  leads,
  outreach,
  radars,
} from "../services/radar-data";
import { firecrawlService } from "../services/firecrawl";
import { runDiscoveryPipeline } from "../services/discovery-pipeline";
import {
  getAllLiveLeads,
  getLiveLeadById,
  getLiveLeadsForRadar,
  saveLiveRadar,
  updateLiveLead,
} from "../services/db-storage";
import { ProviderError } from "../services/providers";

const router: IRouter = Router();

router.get("/dashboard", (_req, res) => {
  res.json(GetDashboardResponse.parse(getDashboard()));
});

router.get("/radars", (_req, res) => {
  res.json(ListRadarsResponse.parse(radars));
});

router.post("/radars", async (req, res) => {
  const parsed = CreateRadarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const radar = {
    id: `radar-${Date.now()}`,
    ...parsed.data,
    status: "active" as const,
    leadCount: 0,
  };
  radars.unshift(radar);
  await saveLiveRadar(radar);
  res.status(201).json(CreateRadarResponse.parse(radar));
});

router.get("/radars/:radarId", (req, res) => {
  const params = GetRadarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const radar = findRadar(params.data.radarId);
  if (!radar) {
    res.status(404).json({ error: "Radar not found" });
    return;
  }
  res.json(GetRadarResponse.parse(radar));
});

router.post("/radars/:radarId", async (req, res) => {
  const params = RunRadarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const bodyParsed = RunRadarBody.safeParse(req.body ?? {});
  const mode = bodyParsed.success ? bodyParsed.data.mode : "demo";

  const radar = findRadar(params.data.radarId);
  if (!radar) {
    res.status(404).json({ error: "Radar not found" });
    return;
  }

  // -------------------------------------------------------------
  // LIVE MODE: Run real external discovery pipeline via Firecrawl
  // -------------------------------------------------------------
  if (mode === "live") {
    // 1. Strict guardrail: Fail clearly if FIRECRAWL_API_KEY is not configured
    if (!firecrawlService.isConfigured() && !process.env.FIRECRAWL_API_KEY) {
      res.status(400).json({
        error: "Firecrawl API key is missing. Set FIRECRAWL_API_KEY in server environment to enable Live Mode discovery.",
        code: "MISSING_FIRECRAWL_KEY",
      });
      return;
    }

    try {
      const result = await runDiscoveryPipeline(radar, {
        searchProvider: firecrawlService,
        researchProvider: firecrawlService,
      });

      res.json(
        RunRadarResponse.parse({
          radar,
          stages: [
            "Searching live web…",
            "Deduplicating candidates…",
            "Researching websites…",
            "Saving verified opportunities…",
          ],
          leadsFound: result.leadsFound,
          demoMode: false,
          mode: "live",
          candidatesResearched: result.candidatesResearched,
        }),
      );
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof ProviderError ? err.code : "DISCOVERY_FAILED";
      res.status(400).json({
        error: `Live discovery failed: ${message}`,
        code,
      });
      return;
    }
  }

  // -------------------------------------------------------------
  // DEMO MODE: Continue using existing fictional in-memory dataset
  // -------------------------------------------------------------
  res.json(
    RunRadarResponse.parse({
      radar,
      stages: ["Finding candidates…", "Researching websites…", "Checking activity…", "Preparing results…"],
      leadsFound: leads.filter((lead) => lead.radarId === radar.id).length,
      demoMode: true,
      mode: "demo",
    }),
  );
});

router.get("/leads", async (req, res) => {
  const parsed = ListLeadsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const search = parsed.data.search?.toLowerCase();
  const mode = parsed.data.mode;

  // Strict Demo vs Live Isolation:
  if (parsed.data.radarId) {
    if (parsed.data.radarId === "radar-inframe") {
      // Demo Radar: only show demo leads
      const filtered = leads.filter((lead) => {
        const matchesRadar = lead.radarId === "radar-inframe";
        const matchesSearch =
          !search ||
          [lead.companyName, lead.industry, lead.location, lead.description].some((value) =>
            value.toLowerCase().includes(search),
          );
        return matchesRadar && matchesSearch;
      });
      res.json(ListLeadsResponse.parse(filtered));
      return;
    }

    // Live Radar: fetch live persisted leads
    const liveLeads = await getLiveLeadsForRadar(parsed.data.radarId, search);
    res.json(ListLeadsResponse.parse(liveLeads));
    return;
  }

  // If mode === "live", return only live leads
  if (mode === "live") {
    const liveLeads = await getAllLiveLeads(search);
    res.json(ListLeadsResponse.parse(liveLeads));
    return;
  }

  // Default demo mode: return demo leads matching search
  const filtered = leads.filter((lead) => {
    return (
      !search ||
      [lead.companyName, lead.industry, lead.location, lead.description].some((value) =>
        value.toLowerCase().includes(search),
      )
    );
  });
  res.json(ListLeadsResponse.parse(filtered));
});

router.get("/leads/:leadId", async (req, res) => {
  const params = GetLeadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const lead = findLead(params.data.leadId) ?? (await getLiveLeadById(params.data.leadId));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json(GetLeadResponse.parse(lead));
});

router.patch("/leads/:leadId", async (req, res) => {
  const params = UpdateLeadParams.safeParse(req.params);
  const body = UpdateLeadBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Invalid request body" });
    return;
  }
  const demoLead = findLead(params.data.leadId);
  if (demoLead) {
    Object.assign(demoLead, body.data);
    res.json(UpdateLeadResponse.parse(demoLead));
    return;
  }

  const liveLead = await updateLiveLead(params.data.leadId, body.data);
  if (!liveLead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json(UpdateLeadResponse.parse(liveLead));
});

router.get("/outreach", (_req, res) => {
  res.json(ListOutreachResponse.parse(outreach));
});

router.post("/outreach", async (req, res) => {
  const parsed = CreateOutreachBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const lead = findLead(parsed.data.leadId) ?? (await getLiveLeadById(parsed.data.leadId));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const isEmail = parsed.data.channel === "email";
  const draft = {
    id: `outreach-${Date.now()}`,
    leadId: lead.id,
    companyName: lead.companyName,
    channel: parsed.data.channel,
    subject: isEmail ? `A content idea for ${lead.companyName}` : "",
    message: isEmail
      ? `Hi ${lead.companyName} team — ${lead.signals[1]?.toLowerCase() ?? "your recent activity"} made me think there may be room for a few short creator-led videos. I make concise ${parsed.data.offer} for brands that want more human product stories. Would it be useful if I sent over two ideas?`
      : `Saw ${lead.signals[1]?.toLowerCase() ?? "the recent activity"} at ${lead.companyName}. I make ${parsed.data.offer} and had two quick ideas for you — open to seeing them?`,
    whyThisMessage: `It uses the specific signal “${lead.signals[1] ?? lead.signals[0]}” as a reason for the message to exist.`,
    status: "draft" as const,
    createdAt: new Date().toISOString(),
    canSend: false,
  };
  outreach.unshift(draft);
  res.status(201).json(CreateOutreachResponse.parse(draft));
});

router.patch("/outreach/:outreachId", (req, res) => {
  const params = UpdateOutreachParams.safeParse(req.params);
  const body = UpdateOutreachBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Invalid request body" });
    return;
  }
  const draft = findOutreach(params.data.outreachId);
  if (!draft) {
    res.status(404).json({ error: "Outreach draft not found" });
    return;
  }
  Object.assign(draft, body.data);
  res.json(UpdateOutreachResponse.parse(draft));
});

router.get("/pipeline", (_req, res) => {
  res.json(GetPipelineResponse.parse(getPipeline()));
});

router.patch("/pipeline/:leadId", async (req, res) => {
  const params = UpdatePipelineStageParams.safeParse(req.params);
  const body = UpdatePipelineStageBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Invalid request body" });
    return;
  }
  const demoLead = findLead(params.data.leadId);
  if (demoLead) {
    demoLead.status = body.data.status;
    res.json(UpdatePipelineStageResponse.parse(demoLead));
    return;
  }

  const liveLead = await updateLiveLead(params.data.leadId, { status: body.data.status });
  if (!liveLead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json(UpdatePipelineStageResponse.parse(liveLead));
});

router.get("/activity", (_req, res) => {
  res.json(ListActivityResponse.parse(activity));
});

export default router;