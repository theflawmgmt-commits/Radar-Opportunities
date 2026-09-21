import type {
  CandidateCompany,
  Evidence,
  FitLevel,
  ObservableSignal,
  QualificationResult,
  ScoreBreakdown,
  ScoreFactor,
  ScrapedPage,
  SignalCategory,
} from "./providers";

/**
 * Key identifiers for observable signals
 */
export const SIGNAL_KEYS = {
  ECOMMERCE_STORE: "ecommerce_store_indicators_detected",
  EMBEDDED_VIDEO_OBSERVED: "embedded_video_observed",
  VIDEO_NOT_OBSERVED: "VIDEO_NOT_OBSERVED_IN_RESEARCHED_PAGES",
  ACTIVE_SOCIAL_CHANNELS: "active_social_channels_observed",
  HIRING_SIGNAL: "hiring_signal_observed",
  PRODUCT_VISUALS: "product_visual_showcase_observed",
  ACTIVE_DOMAIN: "verified_accessible_domain",
} as const;

/**
 * Known directory / aggregator domains to downrank or penalize
 */
const AGGREGATOR_DOMAINS = new Set([
  "yelp.com",
  "clutch.co",
  "yellowpages.com",
  "tripadvisor.com",
  "g2.com",
  "capterra.com",
  "trustpilot.com",
  "angi.com",
  "houzz.com",
  "zoominfo.com",
]);

/**
 * Extracts factual, observable signals from a researched page.
 * Never fabricates or infers unobserved business facts.
 * Absence is strictly scoped to what was researched.
 */
export function extractObservableSignals(
  page: ScrapedPage,
  candidate: CandidateCompany,
): ObservableSignal[] {
  const signals: ObservableSignal[] = [];
  const content = `${page.title || ""} ${page.description || ""} ${page.markdown || ""}`.toLowerCase();
  const pageUrl = page.url || candidate.url;
  const sourceName = page.title || candidate.name;
  const now = page.scrapedAt || new Date().toISOString();

  // 1. Base Accessible Domain Signal
  signals.push({
    id: `sig-${candidate.domain || "dom"}-active`,
    category: "technology",
    key: SIGNAL_KEYS.ACTIVE_DOMAIN,
    statement: `Public web domain is live and accessible at ${pageUrl}`,
    sourceUrl: pageUrl,
    sourceName,
    observedAt: now,
    confidence: "high",
    type: "VERIFIED",
  });

  // 2. E-Commerce / Store Indicators (requires multiple corroborating indicators)
  const ecommerceIndicators: string[] = [];
  if (/\b(add to cart|add to bag|buy now|checkout|shopping cart|shopping bag)\b/i.test(content)) {
    ecommerceIndicators.push("cart/checkout purchase actions");
  }
  if (/((\$|£|€|₹|c\$|a\$)\s*[\d,]+(\.\d{2})?|\b[\d,]+\s*(usd|eur|gbp|cad|aud|inr)\b)/i.test(content)) {
    ecommerceIndicators.push("consumer pricing displays");
  }
  if (/\b(shopify|woocommerce|myshopify|wp-content\/plugins\/woocommerce|stripe|bigcommerce)\b/i.test(content)) {
    ecommerceIndicators.push("e-commerce platform signatures");
  }
  if (/\b(collections\/|products\/|shop all|view catalog|catalog|new arrivals)\b/i.test(content)) {
    ecommerceIndicators.push("product catalog structure");
  }

  if (ecommerceIndicators.length >= 2) {
    signals.push({
      id: `sig-${candidate.domain || "ecom"}-store`,
      category: "ecommerce",
      key: SIGNAL_KEYS.ECOMMERCE_STORE,
      statement: `Multiple e-commerce indicators observed on researched page (${ecommerceIndicators.join(", ")}).`,
      sourceUrl: pageUrl,
      sourceName,
      observedAt: now,
      confidence: "high",
      type: "VERIFIED",
      excerpt: ecommerceIndicators.join("; "),
    });
  }

  // 3. Embedded Video Presence vs. Absence on Researched Pages
  const videoRegex = /(youtube\.com\/(embed|watch)|youtu\.be\/|vimeo\.com\/|player\.vimeo\.com\/|wistia\.(com|net)\/|<video\b|\.mp4\b|tiktok\.com\/embed)/i;
  const hasVideo = videoRegex.test(content);

  if (hasVideo) {
    signals.push({
      id: `sig-${candidate.domain || "med"}-video-present`,
      category: "content",
      key: SIGNAL_KEYS.EMBEDDED_VIDEO_OBSERVED,
      statement: `Embedded video player or video tags observed on researched page.`,
      sourceUrl: pageUrl,
      sourceName,
      observedAt: now,
      confidence: "high",
      type: "VERIFIED",
    });
  } else {
    // Scoped strictly to researched page — does not claim "the company has no video"
    signals.push({
      id: `sig-${candidate.domain || "med"}-video-absent`,
      category: "absence",
      key: SIGNAL_KEYS.VIDEO_NOT_OBSERVED,
      statement: `Researched page at ${pageUrl} was inspected and no embedded video player or video tags were observed on that page.`,
      sourceUrl: pageUrl,
      sourceName,
      observedAt: now,
      confidence: "medium", // Lower confidence than positive observations
      type: "VERIFIED",
    });
  }

  // 4. Social Channel Presence (observable links, not contact enrichment)
  const socialChannels: string[] = [];
  if (/instagram\.com\/(?!p\/|reel\/|explore\/|stories\/)([a-zA-Z0-9_.-]+)/i.test(content)) {
    socialChannels.push("Instagram");
  }
  if (/linkedin\.com\/company\/([a-zA-Z0-9_.-]+)/i.test(content)) {
    socialChannels.push("LinkedIn");
  }
  if (/(twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i.test(content)) {
    socialChannels.push("X/Twitter");
  }
  if (/tiktok\.com\/@([a-zA-Z0-9_.-]+)/i.test(content)) {
    socialChannels.push("TikTok");
  }
  if (/youtube\.com\/(@|channel\/|c\/)/i.test(content)) {
    socialChannels.push("YouTube");
  }

  if (socialChannels.length > 0) {
    signals.push({
      id: `sig-${candidate.domain || "soc"}-socials`,
      category: "social",
      key: SIGNAL_KEYS.ACTIVE_SOCIAL_CHANNELS,
      statement: `Public social channel links observed on researched page (${socialChannels.join(", ")}).`,
      sourceUrl: pageUrl,
      sourceName,
      observedAt: now,
      confidence: "high",
      type: "VERIFIED",
      excerpt: socialChannels.join(", "),
    });
  }

  // 5. Hiring Signals
  if (/\b(careers|we're hiring|join our team|open positions|job openings|work with us)\b/i.test(content)) {
    signals.push({
      id: `sig-${candidate.domain || "hire"}-hiring`,
      category: "hiring",
      key: SIGNAL_KEYS.HIRING_SIGNAL,
      statement: `Careers or hiring cues observed on researched page.`,
      sourceUrl: pageUrl,
      sourceName,
      observedAt: now,
      confidence: "high",
      type: "VERIFIED",
    });
  }

  // 6. Product Visual Showcase
  if (/\b(lookbook|gallery|portfolio|our work|product showcase|view collection)\b/i.test(content)) {
    signals.push({
      id: `sig-${candidate.domain || "vis"}-visuals`,
      category: "branding",
      key: SIGNAL_KEYS.PRODUCT_VISUALS,
      statement: `Product visual showcase, gallery, or lookbook elements observed on page.`,
      sourceUrl: pageUrl,
      sourceName,
      observedAt: now,
      confidence: "high",
      type: "VERIFIED",
    });
  }

  return signals;
}

/**
 * Semantic categories for deduplicating overlapping criteria.
 */
export type CriterionCategory =
  | "commerce"
  | "content/media"
  | "hiring"
  | "social"
  | "geography"
  | "custom";

export interface GeographicCheckResult {
  hasGeoConstraint: boolean;
  countryOrRegion?: string;
  isCorroborated: boolean;
  evidence: string[];
}

/**
 * Detects geographic constraints in target or criteria text and independently
 * verifies whether researched page content genuinely corroborates the location
 * via TLD, local currency, phone prefix, or recognized city locations.
 * Prevents false positives such as "Indian cotton" or "UK shipping".
 */
export function detectGeographicCorroboration(
  text: string,
  url: string,
  domain: string,
  targetOrCriterion: string,
): GeographicCheckResult {
  const lowerTarget = targetOrCriterion.toLowerCase();
  const lowerText = text.toLowerCase();
  const lowerUrl = url.toLowerCase();
  const lowerDomain = domain.toLowerCase();

  // Define supported geographic regions with explicit corroboration cues
  interface RegionDefinition {
    id: string;
    label: string;
    constraintRegex: RegExp;
    tlds: string[];
    currencyRegex: RegExp;
    phoneRegex: RegExp;
    cityRegex: RegExp;
  }

  const regions: RegionDefinition[] = [
    {
      id: "india",
      label: "India",
      constraintRegex: /\b(india|indian)\b/i,
      tlds: [".in", ".co.in", ".firm.in", ".ind.in", ".net.in", ".org.in"],
      currencyRegex: /(₹|\binr\b|\brs\.?\s*\d)/i,
      phoneRegex: /(\+91[\s-]?\d|091[\s-]?\d)/i,
      cityRegex: /\b(mumbai|delhi|new delhi|bangalore|bengaluru|hyderabad|chennai|kolkata|pune|ahmedabad|jaipur|surat|gurgaon|gurugram|noida|karnataka|maharashtra|tamil nadu|haryana|gujarat)\b/i,
    },
    {
      id: "uk",
      label: "UK",
      constraintRegex: /\b(uk|united kingdom|britain|british|england|scotland|wales)\b/i,
      tlds: [".uk", ".co.uk", ".org.uk", ".me.uk", ".ac.uk", ".gov.uk"],
      currencyRegex: /(£|\bgbp\b)/i,
      phoneRegex: /(\+44[\s-]?\(?0?\)?[\s-]?\d)/i,
      cityRegex: /\b(london|manchester|birmingham|edinburgh|bristol|glasgow|leeds|liverpool|sheffield|belfast|cardiff|cornwall|st agnes)\b/i,
    },
    {
      id: "canada",
      label: "Canada",
      constraintRegex: /\b(canada|canadian)\b/i,
      tlds: [".ca"],
      currencyRegex: /(\bcad\b|c\$|cdn\$)/i,
      phoneRegex: /(\+1[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4})/i,
      cityRegex: /\b(toronto|vancouver|montreal|calgary|ottawa|edmonton|quebec|ontario|british columbia|alberta)\b/i,
    },
    {
      id: "australia",
      label: "Australia",
      constraintRegex: /\b(australia|australian|aussie)\b/i,
      tlds: [".au", ".com.au", ".net.au", ".org.au"],
      currencyRegex: /(\baud\b|a\$)/i,
      phoneRegex: /(\+61[\s-]?\d)/i,
      cityRegex: /\b(sydney|melbourne|brisbane|perth|adelaide|gold coast|canberra|queensland|victoria|new south wales)\b/i,
    },
    {
      id: "us",
      label: "US",
      constraintRegex: /\b(us|usa|united states|america|american)\b/i,
      tlds: [".us"],
      currencyRegex: /(\busd\b)/i,
      phoneRegex: /(\+1[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4})/i,
      cityRegex: /\b(new york|los angeles|chicago|san francisco|austin|seattle|miami|california|texas|florida|colorado|oregon|washington dc)\b/i,
    },
    {
      id: "europe",
      label: "Europe",
      constraintRegex: /\b(europe|european|germany|german|france|french|italy|italian|spain|spanish)\b/i,
      tlds: [".eu", ".de", ".fr", ".it", ".es"],
      currencyRegex: /(€|\beur\b)/i,
      phoneRegex: /(\+49|\+33|\+39|\+34)[\s-]?\d/i,
      cityRegex: /\b(berlin|munich|paris|milan|rome|madrid|barcelona|amsterdam|frankfurt)\b/i,
    },
  ];

  // Find matching region in target or criterion
  const matchedRegion = regions.find((r) => r.constraintRegex.test(lowerTarget));
  if (!matchedRegion) {
    return {
      hasGeoConstraint: false,
      isCorroborated: true,
      evidence: [],
    };
  }

  const corroboratingEvidence: string[] = [];

  // Check TLD
  if (matchedRegion.tlds.some((tld) => lowerDomain.endsWith(tld) || lowerUrl.includes(tld + "/"))) {
    corroboratingEvidence.push(`country TLD (${matchedRegion.tlds.join(", ")})`);
  }

  // Check currency
  if (matchedRegion.currencyRegex.test(lowerText)) {
    corroboratingEvidence.push(`local currency display`);
  }

  // Check phone prefix
  if (matchedRegion.phoneRegex.test(lowerText)) {
    corroboratingEvidence.push(`country dialing prefix`);
  }

  // Check recognized city/state
  const cityMatch = lowerText.match(matchedRegion.cityRegex);
  if (cityMatch) {
    corroboratingEvidence.push(`verified location cue (${cityMatch[0]})`);
  }

  const isCorroborated = corroboratingEvidence.length > 0;

  return {
    hasGeoConstraint: true,
    countryOrRegion: matchedRegion.label,
    isCorroborated,
    evidence: corroboratingEvidence,
  };
}

/**
 * Maps an input criterion to a semantic category to prevent inflation
 * from multiple criteria describing the same underlying operational reality.
 */
export function categorizeCriterion(criterion: string): CriterionCategory {
  const lower = criterion.toLowerCase();

  // 1. Content / media specific mentions take precedence over general product mentions (e.g. "video on product pages")
  if (/\b(video|tiktok|reels|youtube|media|content|ugc|podcast|blog|visual assets)\b/i.test(lower)) {
    return "content/media";
  }
  // 2. Hiring specific mentions (e.g. "hiring product designers")
  if (/\b(hiring|growing|careers|team|jobs|open positions|work with us)\b/i.test(lower)) {
    return "hiring";
  }
  // 3. Social channel specific mentions
  if (/\b(social|community|instagram|following|twitter|linkedin|followers)\b/i.test(lower)) {
    return "social";
  }
  // 4. Geographic constraints
  if (/\b(india|indian|uk|united kingdom|britain|british|england|canada|canadian|australia|australian|us|usa|united states|america|american|europe|european|based in|located in|headquarters|hq|domestic)\b/i.test(lower)) {
    return "geography";
  }
  // 5. Commerce / retail / store indicators
  if (/\b(shopify|store|ecommerce|e-commerce|products?|cart|d2c|dtc|retail|catalog|checkout|online store|consumer brand|sells? direct\w*|selling direct\w*|direct[- ]to[- ]consumer)\b/i.test(lower)) {
    return "commerce";
  }
  return "custom";
}

/**
 * Multi-indicator evaluation of target audience match.
 * Enforces geographic grounding with independent corroboration (TLD, currency, phone, city)
 * to prevent false positives like "Indian cotton".
 * Maximum target alignment contribution is strictly capped at +25.
 */
export function evaluateTargetAlignment(
  target: string,
  page: ScrapedPage,
  candidate: CandidateCompany,
  signals: ObservableSignal[],
): { matchedIndicators: string[]; score: number } {
  const matchedIndicators: string[] = [];
  const text = `${page.title || ""} ${page.description || ""} ${candidate.snippet || ""} ${page.markdown || ""}`.toLowerCase();
  const domain = (candidate.domain || "").toLowerCase();
  const pageUrl = page.url || candidate.url || "";

  // Check for aggregator/directory penalty
  if (AGGREGATOR_DOMAINS.has(domain)) {
    return {
      matchedIndicators: ["Identified as directory/aggregator portal rather than distinct company"],
      score: -35,
    };
  }

  // 1. Geographic grounding check
  const geoCheck = detectGeographicCorroboration(text, pageUrl, domain, target);
  let geoConstraintMatches = false;

  if (geoCheck.hasGeoConstraint) {
    if (geoCheck.isCorroborated) {
      geoConstraintMatches = true;
      matchedIndicators.push(
        `Verified ${geoCheck.countryOrRegion} geographic alignment (${geoCheck.evidence.join(", ")})`,
      );
    } else {
      matchedIndicators.push(
        `Geographic target "${geoCheck.countryOrRegion}" unverified (lacks local currency, TLD, phone prefix, or verified location cues)`,
      );
    }
  }

  // 2. Tokenize target terms into meaningful keywords (excluding stop words and uncorroborated geo terms)
  const stopWords = new Set(["and", "the", "for", "with", "in", "of", "to", "or", "a", "an", "based"]);
  const geoWords = new Set(["india", "indian", "uk", "british", "britain", "england", "scotland", "canada", "canadian", "australia", "australian", "us", "usa", "american"]);

  const targetKeywords = target
    .toLowerCase()
    .split(/[\s,/-]+/)
    .filter((w) => {
      if (w.length <= 2 || stopWords.has(w)) return false;
      // If geographic term is present in target but NOT corroborated, do not let it match as a free keyword
      if (geoWords.has(w) && (!geoCheck.hasGeoConstraint || !geoCheck.isCorroborated)) {
        return false;
      }
      return true;
    });

  // Check how many target terms appear in high-value page locations (title, description, domain)
  const titleAndMeta = `${page.title || ""} ${page.description || ""} ${candidate.name} ${domain}`.toLowerCase();
  const directMetaMatches = targetKeywords.filter((kw) => {
    if (titleAndMeta.includes(kw)) return true;
    if (kw.endsWith("s") && titleAndMeta.includes(kw.slice(0, -1))) return true;
    if (geoConstraintMatches) {
      if (kw === "indian" && titleAndMeta.includes("india")) return true;
      if (kw === "canadian" && titleAndMeta.includes("canada")) return true;
      if (kw === "australian" && titleAndMeta.includes("australia")) return true;
      if (kw === "british" && (titleAndMeta.includes("britain") || titleAndMeta.includes("uk"))) return true;
    }
    return false;
  });

  if (directMetaMatches.length >= 2) {
    matchedIndicators.push(
      `Direct audience terms in title/meta: "${directMetaMatches.slice(0, 3).join(", ")}"`,
    );
  } else if (directMetaMatches.length === 1) {
    matchedIndicators.push(`Core audience keyword matched: "${directMetaMatches[0]}"`);
  }

  // 3. Check if target involves D2C/Consumer/Brand and verify with observable commerce signals
  const isConsumerOrD2C = /\b(d2c|direct-to-consumer|dtc|ecommerce|retail|brand|apparel|consumer|goods|shop)\b/i.test(target);
  const hasCommerceSignal = signals.some((s) => s.key === SIGNAL_KEYS.ECOMMERCE_STORE);

  let hasCorroboratedProfile = false;
  if (isConsumerOrD2C && hasCommerceSignal) {
    hasCorroboratedProfile = true;
    matchedIndicators.push(
      "Corroborated consumer-brand profile (active cart, pricing, or catalog observed)",
    );
  }

  // 4. Domain/name relevance check
  const domainMatches = targetKeywords.some((kw) => domain.includes(kw) || candidate.name.toLowerCase().includes(kw));
  if (domainMatches) {
    matchedIndicators.push("Company name/domain aligns with audience focus");
  }

  // Calculate score contribution from target matching (strictly capped at +25)
  let score = 5; // Starting baseline for live domain evaluated against target
  if (directMetaMatches.length >= 2) {
    score += 15;
  } else if (directMetaMatches.length === 1) {
    score += 10;
  }

  if (hasCorroboratedProfile) {
    score += 5;
  }

  if (geoConstraintMatches) {
    score += 5;
  }

  if (domainMatches) {
    score += 5;
  }

  // If geographic constraint was present in target but completely failed verification, apply dampener
  if (geoCheck.hasGeoConstraint && !geoCheck.isCorroborated) {
    score = Math.min(score, 10);
  }

  score = Math.min(25, Math.max(0, score));

  return { matchedIndicators, score };
}

/**
 * Evaluates the user's criteria list against observed page content and signals.
 * Groups criteria by semantic category to prevent overlapping criteria inflation:
 * - First strong match in a category: +15
 * - Additional related match in same category: +5
 * - Maximum total criteria contribution: +30
 * - Negative criteria: -20 penalty (does not consume positive cap)
 * Preserves every individual matched criterion in the explanation.
 */
export function evaluateCriteria(
  criteria: string[],
  page: ScrapedPage,
  signals: ObservableSignal[],
  candidate?: CandidateCompany,
): { factors: ScoreFactor[]; matchedCount: number } {
  const factors: ScoreFactor[] = [];
  const text = `${page.title || ""} ${page.description || ""} ${page.markdown || ""}`.toLowerCase();
  const domain = (candidate?.domain || page.domain || "").toLowerCase();
  const pageUrl = page.url || candidate?.url || "";

  let matchedCount = 0;
  const categoryMatchCounts: Record<CriterionCategory, number> = {
    commerce: 0,
    "content/media": 0,
    hiring: 0,
    social: 0,
    geography: 0,
    custom: 0,
  };

  const MAX_CRITERIA_CONTRIBUTION = 30;
  let totalPositivePoints = 0;

  for (const criterion of criteria) {
    const trimmed = criterion.trim();
    if (!trimmed) continue;

    const lowerCrit = trimmed.toLowerCase();

    // 1. Negative criteria evaluation (e.g. "no agencies", "not a marketplace")
    const isNegativeCriterion = /\b(no|not|exclude|never)\b/i.test(lowerCrit);
    const isVideoAbsenceCriterion = /\b(no|weak|without|missing|lacking)\b/i.test(lowerCrit) && /\b(video|tiktok|reels|youtube|media)\b/i.test(lowerCrit);

    if (isNegativeCriterion && !isVideoAbsenceCriterion) {
      const subject = lowerCrit.replace(/\b(no|not|exclude|never)\b/gi, "").trim();
      if (subject && text.includes(subject)) {
        factors.push({
          factor: `Negative criterion hit: "${trimmed}"`,
          points: -20,
          reason: `Researched page exhibits terms matching negative filter: ${subject}.`,
        });
        continue;
      }
    }

    // 2. Positive criteria evaluation by category
    const category = categorizeCriterion(trimmed);
    let matched = false;
    let matchReason = "";

    switch (category) {
      case "commerce": {
        const hasStore = signals.some((s) => s.key === SIGNAL_KEYS.ECOMMERCE_STORE);
        if (hasStore) {
          matched = true;
          matchReason = "Observed multiple e-commerce indicators on page";
        } else if (/\b(add to cart|checkout|shopify|pricing|catalog)\b/i.test(text)) {
          matched = true;
          matchReason = "Observed direct commerce elements on page";
        }
        break;
      }

      case "content/media": {
        if (isVideoAbsenceCriterion) {
          const videoAbsent = signals.some((s) => s.key === SIGNAL_KEYS.VIDEO_NOT_OBSERVED);
          if (videoAbsent) {
            matched = true;
            matchReason = "Embedded video was not observed on researched page";
          }
        } else {
          const videoPresent = signals.some((s) => s.key === SIGNAL_KEYS.EMBEDDED_VIDEO_OBSERVED);
          if (videoPresent) {
            matched = true;
            matchReason = "Embedded video player was observed on page";
          }
        }
        break;
      }

      case "hiring": {
        const hasHiring = signals.some((s) => s.key === SIGNAL_KEYS.HIRING_SIGNAL);
        if (hasHiring || /\b(careers|we're hiring|join our team|job openings)\b/i.test(text)) {
          matched = true;
          matchReason = "Observed active hiring or careers indicators";
        }
        break;
      }

      case "social": {
        const hasSocial = signals.some((s) => s.key === SIGNAL_KEYS.ACTIVE_SOCIAL_CHANNELS);
        if (hasSocial || /\b(instagram\.com|tiktok\.com|linkedin\.com|twitter\.com)\b/i.test(text)) {
          matched = true;
          matchReason = "Observed active social channel presence";
        }
        break;
      }

      case "geography": {
        const geoCheck = detectGeographicCorroboration(text, pageUrl, domain, trimmed);
        if (geoCheck.hasGeoConstraint && geoCheck.isCorroborated) {
          matched = true;
          matchReason = `Verified ${geoCheck.countryOrRegion} geographic alignment (${geoCheck.evidence.join(", ")})`;
        }
        break;
      }

      case "custom":
      default: {
        const critTokens = lowerCrit.split(/[\s,/-]+/).filter((t) => t.length > 3);
        if (critTokens.length > 0 && critTokens.every((token) => text.includes(token))) {
          matched = true;
          matchReason = `Corroborating text found for criterion "${trimmed}"`;
        }
        break;
      }
    }

    if (matched) {
      matchedCount++;
      const isFirstInCategory = categoryMatchCounts[category] === 0;
      categoryMatchCounts[category]++;

      const proposedPoints = isFirstInCategory ? 15 : 5;
      const remainingCap = Math.max(0, MAX_CRITERIA_CONTRIBUTION - totalPositivePoints);
      const points = Math.min(proposedPoints, remainingCap);
      totalPositivePoints += points;

      const categoryLabel = isFirstInCategory
        ? `First match in ${category} category (+${proposedPoints})`
        : `Additional related match in ${category} category (+${proposedPoints})`;

      const reasonWithNote =
        points < proposedPoints
          ? `${matchReason} (${categoryLabel}; capped to maintain max +${MAX_CRITERIA_CONTRIBUTION} criteria contribution)`
          : `${matchReason} (${categoryLabel})`;

      factors.push({
        factor: `Matched criterion: "${trimmed}"`,
        points,
        reason: reasonWithNote,
      });
    }
  }

  return { factors, matchedCount };
}

/**
 * Generates clear, inferential opportunity hypotheses tailored to the user's offer.
 * Every hypothesis is clearly marked as an inference / hypothesis, not an absolute claim.
 */
export function generateOpportunityHypotheses(
  offer: string,
  target: string,
  signals: ObservableSignal[],
  page: ScrapedPage,
): { hypotheses: string[]; synergyFactor?: ScoreFactor } {
  const hypotheses: string[] = [];
  let synergyFactor: ScoreFactor | undefined;

  const lowerOffer = offer.toLowerCase();
  const videoNotObserved = signals.some((s) => s.key === SIGNAL_KEYS.VIDEO_NOT_OBSERVED);
  const videoObserved = signals.some((s) => s.key === SIGNAL_KEYS.EMBEDDED_VIDEO_OBSERVED);
  const hasStore = signals.some((s) => s.key === SIGNAL_KEYS.ECOMMERCE_STORE);
  const hasSocial = signals.some((s) => s.key === SIGNAL_KEYS.ACTIVE_SOCIAL_CHANNELS);

  // Case 1: Offer involves Video/TikTok/UGC
  if (/\b(video|tiktok|reels|ugc|motion|creative ad|short-form)\b/i.test(lowerOffer)) {
    if (videoNotObserved) {
      hypotheses.push(
        "Researched page displays visual product assets, but no embedded video was observed on that page; this may create an opportunity to explore short-form product demonstration or video ad creative.",
      );
      synergyFactor = {
        factor: "Offer synergy: Video creative opportunity",
        points: 15,
        reason: "User offers video services and no embedded video was observed on researched product pages.",
      };
    } else if (videoObserved) {
      hypotheses.push(
        "Company currently incorporates video on its web presence; a potential angle to explore is expanding into specialized short-form iterations or refreshed creative campaigns.",
      );
      synergyFactor = {
        factor: "Offer synergy: Video expansion potential",
        points: 10,
        reason: "Brand actively utilizes video assets, indicating existing budget and openness to video content.",
      };
    }
  }

  // Case 2: Offer involves Branding / Identity / Design
  if (/\b(brand|identity|design|redesign|rebrand|visual|packaging|logo)\b/i.test(lowerOffer)) {
    if (hasStore) {
      hypotheses.push(
        "Active e-commerce operations provide an established brand canvas; this may create an opening to discuss identity refinement, visual consistency, or design system evolution.",
      );
      if (!synergyFactor) {
        synergyFactor = {
          factor: "Offer synergy: Brand evolution opportunity",
          points: 15,
          reason: "Active brand operations offer immediate surface area for visual and identity services.",
        };
      }
    } else {
      hypotheses.push(
        "Public web presence provides an initial visual foundation; this could represent an opportunity to explore holistic brand positioning and digital assets.",
      );
    }
  }

  // Case 3: Offer involves Copy / Messaging / SEO / Conversion / Marketing
  if (/\b(copy|messaging|seo|conversion|funnel|email|retention|marketing|growth)\b/i.test(lowerOffer)) {
    hypotheses.push(
      "Public customer-facing offerings demonstrate active sales intent; this may offer a relevant conversation starter around conversion copy or customer retention optimization.",
    );
    if (!synergyFactor) {
      synergyFactor = {
        factor: "Offer synergy: Growth & conversion optimization",
        points: 10,
        reason: "Observed commercial presence creates natural alignment with performance and messaging services.",
      };
    }
  }

  // Fallback hypothesis connecting target and offer if no specific niche matched
  if (hypotheses.length === 0) {
    hypotheses.push(
      `Observed web presence demonstrates active market operations matching "${target}"; this may provide a relevant entry point for discussing ${offer}.`,
    );
  }

  if (hasSocial) {
    hypotheses.push(
      "Active public social presence observed; could represent an opportunity to reference recent brand initiatives as conversational context before reaching out.",
    );
  }

  return { hypotheses: hypotheses.slice(0, 3), synergyFactor };
}

/**
 * Calculates the explainable RADAR_RELEVANCE_SCORE (0 to 100).
 * This score is explicitly a prioritization heuristic, NOT a probability of conversion or reply.
 * - Base score: 5
 * - Target alignment: up to +25 (directory: -35)
 * - Criteria: up to +30 total (first match in category +15, related +5, negative -20)
 * - Offer synergy: up to +15
 * - Operational breadth: +10 (requires >= 2 distinct non-commerce operational categories)
 * - Total clamped strictly between 0 and 100.
 */
export function calculateRelevanceScore(
  targetAlignment: { matchedIndicators: string[]; score: number },
  criteriaResult: { factors: ScoreFactor[]; matchedCount: number },
  signals: ObservableSignal[],
  synergyFactor?: ScoreFactor,
): ScoreBreakdown {
  const factors: ScoreFactor[] = [];

  // 1. Target Audience Alignment Factor (capped at +25)
  factors.push({
    factor: "Target audience alignment",
    points: targetAlignment.score,
    reason: targetAlignment.matchedIndicators.join("; "),
  });

  // 2. Criteria Factors (deduplicated by semantic category, capped at +30)
  for (const critFactor of criteriaResult.factors) {
    factors.push(critFactor);
  }

  // 3. Offer Synergy Factor
  if (synergyFactor) {
    factors.push(synergyFactor);
  }

  // 4. Corroborated Operational Breadth (requires >= 2 distinct non-commerce operational categories)
  const nonCommerceOperationalSignals = signals.filter(
    (s) =>
      s.type === "VERIFIED" &&
      s.confidence === "high" &&
      s.category !== "ecommerce" &&
      s.category !== "technology" &&
      s.category !== "absence",
  );
  const distinctOperationalCategories = Array.from(
    new Set(nonCommerceOperationalSignals.map((s) => s.category)),
  );

  if (distinctOperationalCategories.length >= 2) {
    factors.push({
      factor: "Corroborated operational breadth",
      points: 10,
      reason: `Observed distinct operational capabilities across multiple non-commerce categories (${distinctOperationalCategories.join(", ")}).`,
    });
  }

  // 5. Total score calculation
  const baseScore = 5; // Recalibrated baseline for a live, researched URL
  let rawTotal = baseScore;
  for (const f of factors) {
    rawTotal += f.points;
  }

  const totalScore = Math.max(0, Math.min(100, rawTotal));

  // Determine fit level according to strict thresholds:
  // HIGH RELEVANCE: >= 75
  // POSSIBLE RELEVANCE: 45 - 74
  // LOW RELEVANCE: < 45
  let fit: FitLevel = "LOW RELEVANCE";
  if (totalScore >= 75) {
    fit = "HIGH RELEVANCE";
  } else if (totalScore >= 45) {
    fit = "POSSIBLE RELEVANCE";
  }

  return {
    baseScore,
    totalScore,
    fit,
    factors,
  };
}

/**
 * Orchestrates full candidate qualification in Phase 2.2:
 * Scraped Page → Observable Signals → Evidence-backed Qualification → Opportunity Hypotheses → Enriched Result.
 */
export function qualifyCandidate(
  candidate: CandidateCompany,
  page: ScrapedPage,
  radar: {
    target: string;
    offer: string;
    criteria: string[];
  },
): QualificationResult {
  const pageUrl = page.url || candidate.url;
  const now = page.scrapedAt || new Date().toISOString();

  // 1. Extract factual observable signals
  const signals = extractObservableSignals(page, candidate);

  // 2. Multi-indicator target audience alignment
  const targetAlignment = evaluateTargetAlignment(radar.target, page, candidate, signals);

  // 3. Criteria matching
  const criteriaResult = evaluateCriteria(radar.criteria, page, signals, candidate);

  // 4. Opportunity hypothesis generation
  const { hypotheses, synergyFactor } = generateOpportunityHypotheses(
    radar.offer,
    radar.target,
    signals,
    page,
  );

  // 5. Calculate transparent RADAR_RELEVANCE_SCORE and fit
  const scoreBreakdown = calculateRelevanceScore(
    targetAlignment,
    criteriaResult,
    signals,
    synergyFactor,
  );

  // 6. Build structured Evidence array:
  // - Fact observations tagged as VERIFIED
  // - Opportunity hypotheses tagged as INFERRED
  const evidence: Evidence[] = [];

  // Factual evidence items (VERIFIED)
  evidence.push({
    id: `ev-${candidate.domain || "dom"}-live`,
    statement: `Public website confirmed live and reachable at ${pageUrl}`,
    sourceName: candidate.name,
    sourceUrl: pageUrl,
    sourceStatus: "connected",
    observedAt: now,
    type: "VERIFIED",
    confidence: "high",
  });

  if (page.title) {
    evidence.push({
      id: `ev-${candidate.domain || "dom"}-title`,
      statement: `Site title observed: "${page.title}"`,
      sourceName: candidate.name,
      sourceUrl: pageUrl,
      sourceStatus: "connected",
      observedAt: now,
      type: "VERIFIED",
      confidence: "high",
      excerpt: page.title,
    });
  }

  for (const sig of signals) {
    if (sig.key === SIGNAL_KEYS.ACTIVE_DOMAIN) continue; // Already covered by first evidence item
    evidence.push({
      id: `ev-${sig.id}`,
      statement: sig.statement,
      sourceName: sig.sourceName,
      sourceUrl: sig.sourceUrl,
      sourceStatus: "connected",
      observedAt: sig.observedAt,
      type: sig.type,
      confidence: sig.confidence,
      excerpt: sig.excerpt,
    });
  }

  // Opportunity hypotheses (INFERRED)
  for (let i = 0; i < hypotheses.length; i++) {
    evidence.push({
      id: `ev-hyp-${i + 1}`,
      statement: hypotheses[i],
      sourceName: "RADAR Opportunity Inference Engine",
      sourceUrl: pageUrl,
      sourceStatus: "connected",
      observedAt: now,
      type: "INFERRED",
      confidence: "medium",
    });
  }

  const reasons = scoreBreakdown.factors.map((f) => `${f.points >= 0 ? "+" : ""}${f.points} ${f.factor}: ${f.reason}`);

  return {
    fit: scoreBreakdown.fit,
    relevanceScore: scoreBreakdown.totalScore,
    scoreBreakdown,
    reasons,
    signals,
    evidence,
    opportunities: hypotheses,
  };
}
