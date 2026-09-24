import type {
  Lead,
  OpportunityBrief,
  OpportunityBriefConfidence,
  OpportunityBriefContactEvidence,
  OpportunityBriefContactEvidenceStatus,
  OpportunityBriefRecommendedNextAction,
  OpportunityBriefRecommendedNextActionAction,
  OpportunityBriefSourcesItem,
  Evidence,
  Person,
  ContactPoint,
} from "@workspace/api-zod";

/**
 * Filter: Never select a SUGGESTED person as primary contact.
 * Must be explicitly VERIFIED or SUPPORTED by research evidence.
 */
export function filterValidPrimaryContact(lead: Lead): Person | null {
  if (
    lead.primaryContact &&
    (lead.primaryContact.verificationStatus === "VERIFIED" ||
      lead.primaryContact.verificationStatus === "SUPPORTED")
  ) {
    return lead.primaryContact;
  }
  return null;
}

/**
 * Determines contact evidence status and descriptive scope.
 * Scoped strictly to researched public pages — never synthesizes unverified email addresses.
 */
export function determineContactEvidence(
  contactPoints: ContactPoint[],
  validPrimary: Person | null,
  publicEmail: string | null = null,
  socialChannels: { instagram?: string | null; linkedin?: string | null; website?: string | null } = {},
): OpportunityBriefContactEvidence {
  const directEmail = validPrimary?.contactPoints?.find(
    (cp) => cp.type === "email" && cp.isDirect,
  );
  const directContact = validPrimary?.contactPoints?.find(
    (cp) => cp.isDirect && (cp.verificationStatus === "VERIFIED" || cp.verificationStatus === "SUPPORTED"),
  );
  const companyEmail = contactPoints.find((cp) => cp.type === "email" && !cp.isDirect) || contactPoints.find((cp) => cp.type === "email");
  const hasPhone = contactPoints.some((cp) => cp.type === "phone");
  const hasContactForm = contactPoints.some((cp) => cp.type === "contact_form");

  const channelSet = new Set<string>();
  contactPoints.forEach((cp) => channelSet.add(cp.type));
  if (publicEmail) channelSet.add("email");
  if (socialChannels.instagram) channelSet.add("instagram");
  if (socialChannels.linkedin) channelSet.add("linkedin");
  if (socialChannels.website) channelSet.add("website");

  let status: OpportunityBriefContactEvidenceStatus = "ABSENT";
  let details = "No public contact channels were observed on researched pages.";
  const primaryEmail = directEmail?.value || companyEmail?.value || publicEmail || null;

  if (directContact && directContact.verificationStatus === "VERIFIED") {
    status = "VERIFIED_DIRECT";
    details = `Verified direct ${directContact.type} available for ${validPrimary?.name}: ${directContact.value}`;
  } else if (directContact && directContact.verificationStatus === "SUPPORTED") {
    status = "SUPPORTED_DIRECT";
    details = `Supported direct ${directContact.type} available for ${validPrimary?.name}: ${directContact.value}`;
  } else if (companyEmail || hasPhone || hasContactForm || publicEmail) {
    status = "COMPANY_ONLY";
    if (validPrimary) {
      details = (companyEmail || publicEmail)
        ? `General company email observed: ${companyEmail?.value || publicEmail}. Key person identified (${validPrimary.name} - ${validPrimary.role}), but no verified direct personal email observed on researched pages.`
        : `Company contact channel observed. Key person identified (${validPrimary.name} - ${validPrimary.role}), but no direct personal contact observed on researched pages.`;
    } else {
      details = (companyEmail || publicEmail)
        ? `General company email observed: ${companyEmail?.value || publicEmail}. No verified direct personal email observed on researched pages.`
        : "Company contact channel observed. No direct personal contact observed on researched pages.";
    }
  } else if (validPrimary) {
    status = "ABSENT";
    details = `Key person identified (${validPrimary.name} - ${validPrimary.role}), but no direct personal contact channel was observed on researched pages.`;
  }

  return {
    status,
    details,
    primaryEmail,
    channels: Array.from(channelSet),
  };
}

/**
 * Deterministic Next Action State Machine:
 * 1. If relevance < 35 OR fit === LOW RELEVANCE: archive_lead
 * 2. Else if a VERIFIED/SUPPORTED primary contact exists AND a direct contact channel exists: draft_outreach
 * 3. Else if relevance >= 50: research_contact
 * 4. Else if relevance is 35–49: review_evidence
 *
 * NOTE: confidence represents descriptive evidence completeness only and must NEVER
 * override the relevance/contact rules.
 */
export function determineRecommendedNextAction(
  lead: Lead,
  contactStatus: OpportunityBriefContactEvidenceStatus,
  validPrimary: Person | null,
  _confidence?: OpportunityBriefConfidence,
): OpportunityBriefRecommendedNextAction {
  // 1. If relevance < 35 OR fit === LOW RELEVANCE: archive_lead
  if (lead.relevance < 35 || lead.fit === "LOW RELEVANCE") {
    return {
      action: "archive_lead",
      label: "Archive lead",
      reason: "Low alignment with radar criteria or target profile based on researched signals.",
    };
  }

  // 2. Else if a VERIFIED/SUPPORTED primary contact exists AND a direct contact channel exists: draft_outreach
  if (validPrimary && (contactStatus === "VERIFIED_DIRECT" || contactStatus === "SUPPORTED_DIRECT")) {
    return {
      action: "draft_outreach",
      label: "Draft outreach",
      reason: `A verified or supported key contact (${validPrimary.name} - ${validPrimary.role}) is available for targeted review.`,
    };
  }

  // 3. Else if relevance >= 50: research_contact
  if (lead.relevance >= 50) {
    return {
      action: "research_contact",
      label: "Research contact",
      reason: `Company has strong relevance (${lead.relevance}/100), but no verified leadership contact was observed on public pages.`,
    };
  }

  // 4. Else if relevance is 35–49: review_evidence
  return {
    action: "review_evidence",
    label: "Review evidence",
    reason: `Relevance is moderate (${lead.relevance}/100). Review observed web facts before deciding to research or reach out.`,
  };
}

/**
 * Confidence represents evidence completeness only.
 * It NEVER alters or influences lead.relevance score, fit, scoreBreakdown, ranking, or intelligence.
 */
export function determineEvidenceConfidence(
  observableFactsCount: number,
  contactVerified?: boolean,
  sourceStatus?: string,
): OpportunityBriefConfidence {
  if (observableFactsCount >= 3 && Boolean(contactVerified)) {
    return "high";
  }
  if (observableFactsCount <= 1 || sourceStatus === "not_verified") {
    return "low";
  }
  return "medium";
}

/**
 * Builds an Opportunity Brief deterministically from existing Lead data.
 * Adheres strictly to the following invariants:
 * 1. Zero LLM, zero hallucinations, zero invented facts.
 * 2. Fact vs. inference separation: Observable facts remain facts; opportunity hypotheses remain explicitly labeled inferences.
 * 3. Objective phrasing only: "Research surfaced...", "Observable signals include...", "This suggests a potential...".
 *    Never "They need...", "They are struggling with...", etc.
 * 4. Contact verification semantics: VERIFIED person does not imply verified email; absence is scoped strictly to researched pages.
 * 5. Confidence represents evidence completeness only and NEVER alters lead relevance score, fit, or intelligence scoring.
 * 6. Identical derivation for Demo and Live leads.
 */
export function buildOpportunityBrief(lead: Lead): OpportunityBrief {
  // 1. Observable Facts vs. Inferences
  const observableFacts: Evidence[] = [];
  const inferences: Evidence[] = [];

  const rawEvidence = lead.evidence ?? [];
  for (const ev of rawEvidence) {
    if (ev.type === "VERIFIED") {
      observableFacts.push(ev);
    } else {
      inferences.push(ev);
    }
  }

  // If no explicit VERIFIED evidence was stored but signals exist, synthesize observable facts from verified signals
  if (observableFacts.length === 0 && lead.signals && lead.signals.length > 0) {
    lead.signals.forEach((sig, idx) => {
      observableFacts.push({
        id: `fact-${lead.id}-${idx + 1}`,
        statement: sig,
        sourceName: `${lead.companyName} website`,
        sourceUrl: lead.website || undefined,
        sourceStatus: lead.sourceStatus ?? "connected",
        observedAt: lead.discoveredAt || new Date().toISOString(),
        type: "VERIFIED",
        confidence: "high",
      });
    });
  }

  // If no explicit INFERRED evidence exists but opportunity hypotheses exist, synthesize inferences
  if (inferences.length === 0 && lead.opportunity && lead.opportunity.length > 0) {
    lead.opportunity.forEach((opp, idx) => {
      inferences.push({
        id: `inf-${lead.id}-${idx + 1}`,
        statement: opp,
        sourceName: "RADAR Opportunity Analysis",
        sourceStatus: lead.sourceStatus ?? "connected",
        observedAt: lead.discoveredAt || new Date().toISOString(),
        type: "INFERRED",
        confidence: "medium",
      });
    });
  }

  // 2. High-clarity Summary (1-2 sentence honest synthesis using objective phrasing)
  const signalsCount = (lead.signals || []).length;
  const verifiedSignals = (lead.signals || []).slice(0, 2);
  const signalSnippet = verifiedSignals.length > 0 ? verifiedSignals.join(" and ") : "public web presence";
  const relevanceLabel = lead.relevance >= 70 ? "high" : lead.relevance >= 40 ? "possible" : "low";

  const summary = `Research surfaced ${lead.companyName} as a ${relevanceLabel}-relevance opportunity within ${lead.industry || "the target category"}. Observable signals include ${signalSnippet}.`;

  // 3. Why Relevant bullet points (grounded in observable facts)
  const whyRelevant: string[] = [];

  if (lead.scoreBreakdown?.factors && lead.scoreBreakdown.factors.length > 0) {
    for (const factor of lead.scoreBreakdown.factors) {
      if ((factor.points ?? 0) > 0) {
        whyRelevant.push(`${factor.factor}: ${factor.reason}`);
      }
    }
  }

  if (whyRelevant.length === 0 && lead.signals && lead.signals.length > 0) {
    for (const sig of lead.signals.slice(0, 3)) {
      whyRelevant.push(`Observable signal: ${sig}`);
    }
  }

  if (whyRelevant.length === 0) {
    whyRelevant.push("Company profile aligns with radar target domain criteria.");
  }

  // 4. Opportunity hypothesis & explanation
  const hasOpportunity = Boolean(lead.opportunity && lead.opportunity.length > 0);
  const opportunityHypothesis = hasOpportunity
    ? lead.opportunity[0]
    : "Research did not surface a specific opportunity angle from the pages researched.";

  const opportunityExplanation = hasOpportunity
    ? `Derived as an inferred conversational entry point based on observed signals: ${(lead.signals || []).slice(0, 3).join(", ") || "public presence"}. This remains an interpretation to explore, not a verified internal requirement.`
    : "No specific opportunity hypothesis was identified from the public pages successfully researched.";

  // 5. Primary Contact
  const validPrimary = filterValidPrimaryContact(lead);

  // 6. Contact Evidence
  const contactPoints = lead.contactPoints ?? [];
  const contactEvidence = determineContactEvidence(contactPoints, validPrimary, lead.publicEmail, {
    instagram: lead.instagram,
    linkedin: lead.linkedin,
    website: lead.website,
  });

  // 7. Confidence (Evidence completeness only — NEVER affects score or ranking)
  const confidence = determineEvidenceConfidence(
    observableFacts.length,
    lead.contactVerified,
    lead.sourceStatus,
  );

  // 8. Recommended Next Action (Deterministic State Machine)
  const recommendedNextAction = determineRecommendedNextAction(
    lead,
    contactEvidence.status,
    validPrimary,
    confidence,
  );

  // 9. Sources (Deduplicated list)
  const sourcesMap = new Map<string, OpportunityBriefSourcesItem>();

  // From website
  if (lead.website) {
    const key = lead.website.toLowerCase().trim();
    sourcesMap.set(key, {
      name: `${lead.companyName} website`,
      url: lead.website,
      observedAt: lead.discoveredAt,
      status: lead.sourceStatus ?? "connected",
    });
  }

  // From evidence
  for (const ev of rawEvidence) {
    if (ev.sourceUrl) {
      const key = ev.sourceUrl.toLowerCase().trim();
      if (!sourcesMap.has(key)) {
        sourcesMap.set(key, {
          name: ev.sourceName || `${lead.companyName} page`,
          url: ev.sourceUrl,
          observedAt: ev.observedAt,
          status: ev.sourceStatus || lead.sourceStatus || "connected",
        });
      }
    }
  }

  // From people
  for (const p of lead.people ?? []) {
    if (p.sourceUrl) {
      const key = p.sourceUrl.toLowerCase().trim();
      if (!sourcesMap.has(key)) {
        sourcesMap.set(key, {
          name: p.sourceName || "Leadership page",
          url: p.sourceUrl,
          observedAt: p.observedAt,
          status: lead.sourceStatus || "connected",
        });
      }
    }
  }

  // From contact points
  for (const cp of contactPoints) {
    if (cp.sourceUrl) {
      const key = cp.sourceUrl.toLowerCase().trim();
      if (!sourcesMap.has(key)) {
        sourcesMap.set(key, {
          name: cp.sourceName || "Contact page",
          url: cp.sourceUrl,
          observedAt: cp.observedAt,
          status: lead.sourceStatus || "connected",
        });
      }
    }
  }

  const sources: OpportunityBriefSourcesItem[] = Array.from(sourcesMap.values());

  return {
    summary,
    whyRelevant,
    opportunity: {
      hypothesis: opportunityHypothesis,
      explanation: opportunityExplanation,
    },
    observableFacts,
    inferences,
    primaryContact: validPrimary,
    contactEvidence,
    recommendedNextAction,
    confidence,
    sources,
  };
}
