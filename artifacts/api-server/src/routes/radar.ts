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
  UpdateRadarBody,
  UpdateRadarParams,
  UpdateRadarResponse,
  type Lead,
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
  PIPELINE_STAGES,
  radars,
} from "../services/radar-data";
import { firecrawlService } from "../services/firecrawl";
import { runDiscoveryPipeline } from "../services/discovery-pipeline";
import {
  getAllLiveLeads,
  getAllLiveRadars,
  getLiveLeadById,
  getLiveLeadsForRadar,
  getLiveRadarById,
  saveLiveRadar,
  updateLiveLead,
  updateLiveRadar,
} from "../services/db-storage";
import { ProviderError } from "../services/providers";

const router: IRouter = Router();

router.get("/dashboard", (_req, res) => {
  res.json(GetDashboardResponse.parse(getDashboard()));
});

router.get("/radars", async (_req, res) => {
  const liveRadars = await getAllLiveRadars();
  const allRadars = [...radars];
  for (const lr of liveRadars) {
    if (!allRadars.some((r) => r.id === lr.id)) {
      allRadars.push(lr);
    }
  }
  res.json(ListRadarsResponse.parse(allRadars));
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

router.get("/radars/:radarId", async (req, res) => {
  const params = GetRadarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const radar = findRadar(params.data.radarId) ?? (await getLiveRadarById(params.data.radarId));
  if (!radar) {
    res.status(404).json({ error: "Radar not found" });
    return;
  }
  res.json(GetRadarResponse.parse(radar));
});

router.patch("/radars/:radarId", async (req, res) => {
  const params = UpdateRadarParams.safeParse(req.params);
  const body = UpdateRadarBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : body.error?.message ?? "Invalid request body",
    });
    return;
  }
  const demoRadar = findRadar(params.data.radarId);
  if (demoRadar) {
    Object.assign(demoRadar, body.data);
    res.json(UpdateRadarResponse.parse(demoRadar));
    return;
  }

  const updated = await updateLiveRadar(params.data.radarId, body.data);
  if (!updated) {
    res.status(404).json({ error: "Radar not found" });
    return;
  }
  res.json(UpdateRadarResponse.parse(updated));
});

router.post("/radars/:radarId", async (req, res) => {
  const params = RunRadarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const bodyParsed = RunRadarBody.safeParse(req.body ?? {});
  const mode = bodyParsed.success ? bodyParsed.data.mode : "demo";

  const radar = findRadar(params.data.radarId) ?? (await getLiveRadarById(params.data.radarId));
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
            "Extracting observable signals…",
            "Evaluating qualification & score…",
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

  const primaryPerson = lead.primaryContact;
  const isPersonVerified =
    primaryPerson &&
    (primaryPerson.verificationStatus === "VERIFIED" || primaryPerson.verificationStatus === "SUPPORTED");

  // Determine recipient scope
  const usePersonScope =
    parsed.data.recipientScope === "person" ||
    (!parsed.data.recipientScope && Boolean(isPersonVerified));

  const channel = parsed.data.channel;
  const isEmail = channel === "email";
  const isLinkedIn = channel === "linkedin";

  // Grounding in real observable signals & opportunity
  const factualSignal =
    lead.observableSignals?.[0]?.statement ?? lead.signals?.[0] ?? "your recent products";
  const secondarySignal =
    lead.observableSignals?.[1]?.statement ?? lead.signals?.[1] ?? "";
  const observedEvidence = secondarySignal || factualSignal;

  const opportunityAngle =
    lead.opportunity?.[0] ?? `${parsed.data.offer} product demonstration`;

  let subject = "";
  let message = "";
  let whyThisMessage = "";

  if (usePersonScope && primaryPerson) {
    const firstName = primaryPerson.name.split(" ")[0];
    const greeting = `Hi ${firstName} —`;

    if (isEmail) {
      subject = `${parsed.data.offer} for ${lead.companyName}`;
      message = `${greeting} saw your work leading ${primaryPerson.role} at ${lead.companyName}. Looking at ${observedEvidence.toLowerCase()}, there's a natural fit for ${opportunityAngle.toLowerCase()}. I make concise ${parsed.data.offer} that help customer conversion. Would it be useful if I sent over two quick concepts?`;
      whyThisMessage = `Addressed directly to ${primaryPerson.name} (${primaryPerson.role}) grounded in observed fact: "${observedEvidence}".`;
    } else if (isLinkedIn) {
      subject = "";
      message = `${greeting} came across your profile as ${primaryPerson.role} at ${lead.companyName}. Noticed ${observedEvidence.toLowerCase()} — had two quick concepts for ${opportunityAngle.toLowerCase()} using ${parsed.data.offer}. Open to seeing them?`;
      whyThisMessage = `Direct LinkedIn outreach to ${primaryPerson.name} (${primaryPerson.role}) based on "${observedEvidence}".`;
    } else {
      // Instagram / other
      subject = "";
      message = `${greeting} love what you're doing with ${lead.companyName}. Saw ${observedEvidence.toLowerCase()} and had a couple of ideas on ${parsed.data.offer} — mind if I share them?`;
      whyThisMessage = `Personal direct message referencing ${primaryPerson.name} and "${observedEvidence}".`;
    }
  } else {
    const greeting = `Hi ${lead.companyName} team —`;

    if (isEmail) {
      subject = `Content concept for ${lead.companyName}`;
      message = `${greeting} noticed ${observedEvidence.toLowerCase()} at ${lead.companyName}, which creates an interesting opportunity for ${opportunityAngle.toLowerCase()}. I create concise ${parsed.data.offer} for growing brands. Would it be useful if I shared two ideas with your team?`;
      whyThisMessage = `Company-scoped outreach grounded in observable signal: "${observedEvidence}".`;
    } else if (isLinkedIn) {
      subject = "";
      message = `${greeting} following ${lead.companyName}'s work — especially ${observedEvidence.toLowerCase()}. I create ${parsed.data.offer} and had two quick concepts on ${opportunityAngle.toLowerCase()}. Would you be open to connecting?`;
      whyThisMessage = `Company LinkedIn inquiry grounded in "${observedEvidence}".`;
    } else {
      subject = "";
      message = `${greeting} loved seeing ${observedEvidence.toLowerCase()} at ${lead.companyName}. I make ${parsed.data.offer} and had two quick ideas that match your aesthetic — open to seeing them?`;
      whyThisMessage = `Social message referencing observed company activity: "${observedEvidence}".`;
    }
  }

  const draft = {
    id: `outreach-${Date.now()}`,
    leadId: lead.id,
    companyName: lead.companyName,
    channel: parsed.data.channel,
    subject,
    message,
    whyThisMessage,
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

router.get("/pipeline", async (_req, res) => {
  const liveLeads = await getAllLiveLeads();
  const allLeads = [...leads];
  for (const ll of liveLeads) {
    if (!allLeads.some((l) => l.id === ll.id)) {
      allLeads.push(ll);
    }
  }

  const columns = PIPELINE_STAGES.reduce(
    (acc, status) => {
      acc[status] = allLeads.filter((lead) => lead.status === status);
      return acc;
    },
    {} as Record<string, Lead[]>,
  );

  res.json(GetPipelineResponse.parse({ columns }));
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