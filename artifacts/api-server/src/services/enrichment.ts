import {
  CandidateCompany,
  Contact,
  ContactPoint,
  ContactPointType,
  ContactPointVerificationStatus,
  ConfidenceLevel,
  EnrichmentProvider,
  EnrichmentResult,
  Person,
  PersonVerificationStatus,
  ResearchProvider,
  RoleCategory,
  ScrapedPage,
} from "./providers";
import { canonicalizeUrl, extractDomain } from "./discovery-pipeline";
import { logger } from "../lib/logger";

// Blacklist of false-positive strings that look like names or titles but are UI/navigation elements
const NAME_BLACKLIST = new Set([
  "about us",
  "contact us",
  "our team",
  "the team",
  "leadership",
  "board of directors",
  "advisory board",
  "meet the team",
  "who we are",
  "our story",
  "privacy policy",
  "terms of service",
  "terms of use",
  "cookie policy",
  "refund policy",
  "shipping policy",
  "free shipping",
  "all rights reserved",
  "customer service",
  "customer support",
  "help center",
  "frequently asked questions",
  "faq",
  "press release",
  "newsroom",
  "career opportunities",
  "join our team",
  "read more",
  "learn more",
  "shop all",
  "new arrivals",
  "best sellers",
  "view all",
  "add to cart",
  "buy now",
  "checkout",
  "subscribe",
  "sign in",
  "log in",
  "sign up",
  "menu",
  "close",
  "search",
  "cart",
  "filter",
  "united states",
  "united kingdom",
  "terms & conditions",
]);

const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "info",
  "hello",
  "contact",
  "support",
  "sales",
  "help",
  "press",
  "media",
  "team",
  "hi",
  "inquiries",
  "enquiries",
  "partnerships",
  "general",
  "customercare",
  "care",
  "service",
  "billing",
  "admin",
  "office",
  "feedback",
  "jobs",
  "careers",
  "operations",
  "privacy",
  "legal",
  "compliance",
  "security",
  "contactus",
  "order",
  "orders",
  "helpdesk",
  "marketing",
  "mail",
  "pr",
  "booking",
  "bookings",
]);

// Tokens that, if present in any word of a candidate name, disqualify it from being an authentic person's name
const DISALLOWED_NAME_TOKENS = new Set([
  // Products, collections, merchandise
  "collection",
  "collections",
  "brand",
  "brands",
  "shop",
  "store",
  "goods",
  "product",
  "products",
  "apparel",
  "wear",
  "clothing",
  "dress",
  "dresses",
  "shirt",
  "shirts",
  "shoes",
  "linen",
  "cotton",
  "wool",
  "silk",
  "edition",
  "series",
  "line",
  "item",
  "items",
  "catalog",
  "bundle",
  "pack",
  "kit",
  "merch",
  // Corporate, organizational, and entity types
  "studio",
  "studios",
  "company",
  "group",
  "agency",
  "agencies",
  "firm",
  "firms",
  "ltd",
  "inc",
  "corp",
  "corporation",
  "llc",
  "holdings",
  "enterprises",
  "ventures",
  "capital",
  "partners",
  "associates",
  "solutions",
  "services",
  "technologies",
  "labs",
  "department",
  "division",
  "organization",
  "network",
  // UI, navigation, business, and policy words
  "team",
  "support",
  "service",
  "management",
  "shipping",
  "delivery",
  "order",
  "orders",
  "customer",
  "help",
  "desk",
  "policy",
  "policies",
  "terms",
  "privacy",
  "security",
  "faq",
  "contact",
  "about",
  "press",
  "careers",
  "jobs",
  "hiring",
  "media",
  "community",
  "newsletter",
  "free",
  "returns",
  "refunds",
  // Promotional & commerce tokens
  "sale",
  "discount",
  "deal",
  "special",
  "gift",
  "featured",
  "seller",
  "sellers",
  "bestseller",
  "bestsellers",
  "weekly",
  "monthly",
  "daily",
  "annual",
]);

const EXCLUDED_EMAIL_DOMAINS = new Set([
  "example.com",
  "domain.com",
  "test.com",
  "yourcompany.com",
  "wixpress.com",
  "shopify.com",
  "sentry.io",
  "schema.org",
  "email.com",
  "github.com",
  "google.com",
  "facebook.com",
  "apple.com",
  "cloudflare.com",
  "gravatar.com",
  "wordpress.org",
]);

/**
 * Categorizes a business title into structured RoleCategory
 */
export function categorizeRole(role: string): RoleCategory {
  const normalized = role.toLowerCase();

  // 1. Creative / Marketing / Brand / Social / Growth / Video
  if (
    /\b(cmo|marketing|brand|creative|social media|content|growth|video|copywriter|pr director|communications|public relations)\b/i.test(
      normalized,
    )
  ) {
    return "creative_marketing";
  }

  // 2. Founder / Co-Founder / Creator / Owner
  if (
    /\b(founder|co-founder|co founder|creator|owner|co-owner|founding partner)\b/i.test(
      normalized,
    )
  ) {
    return "founder";
  }

  // 3. Operations / Supply Chain / Logistics / Fulfillment
  if (
    /\b(operations|supply chain|logistics|fulfillment|procurement|inventory|warehouse)\b/i.test(
      normalized,
    )
  ) {
    return "operations";
  }

  // 4. Executive / C-Suite / Leadership
  if (
    /\b(ceo|chief executive|coo|chief operating|cfo|chief financial|cto|chief technology|cio|president|managing director|general manager|partner|vp|vice president|principal|head of)\b/i.test(
      normalized,
    )
  ) {
    return "executive";
  }

  return "unspecified";
}

/**
 * Validates whether a candidate name string looks like an authentic person's name
 */
export function isValidPersonName(name: string): boolean {
  if (!name || typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 40) return false;

  const lower = trimmed.toLowerCase();
  if (NAME_BLACKLIST.has(lower)) return false;

  // Must not contain URLs, email indicators, numbers, symbols
  if (/[0-9@_#\/\\{}\[\]|~=<>+*$%^&]/.test(trimmed)) return false;

  // Names should consist of 2 to 4 words
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;

  // Words should start with uppercase or common prefix (e.g. Mc, Mac, O', von, van, de)
  for (const word of words) {
    if (word.length < 2) return false;
    const cleanWord = word.toLowerCase().replace(/[^a-z]/g, "");
    if (DISALLOWED_NAME_TOKENS.has(cleanWord)) {
      return false;
    }
    if (
      !/^[A-Z][a-zA-Z'\-.]*$/.test(word) &&
      !/^(von|van|de|da|di|la|le|du)\b/i.test(word)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Validates whether an email is plausible and not a synthetic or excluded domain
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim().toLowerCase();

  // Basic RFC-compliant email regex
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  if (!emailRegex.test(trimmed)) return false;

  // Exclude image or file extensions mistakenly matched
  if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|woff|woff2)$/i.test(trimmed)) {
    return false;
  }

  const parts = trimmed.split("@");
  if (parts.length !== 2) return false;
  const domain = parts[1];

  if (EXCLUDED_EMAIL_DOMAINS.has(domain)) {
    return false;
  }

  return true;
}

/**
 * Extracts links from markdown to team, about, contact pages for targeted secondary scrape
 */
export function findSecondaryScrapeTargets(
  markdown: string,
  baseUrl: string,
): { teamUrl?: string; aboutUrl?: string; contactUrl?: string } {
  if (!markdown) return {};

  const baseDomain = extractDomain(baseUrl);
  const targets: { teamUrl?: string; aboutUrl?: string; contactUrl?: string } = {};

  // Find markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(markdown)) !== null) {
    const text = match[1].toLowerCase().trim();
    const href = match[2].trim();

    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;

    let fullUrl = href;
    try {
      fullUrl = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    const linkDomain = extractDomain(fullUrl);
    // Only follow internal subpages on the same domain
    if (linkDomain && linkDomain !== baseDomain) continue;

    const lowerUrl = fullUrl.toLowerCase();

    // 1. Team / Leadership target (highest priority)
    if (
      !targets.teamUrl &&
      (/\b(team|leadership|founders|about\/team|who-we-are\/team)\b/i.test(lowerUrl) ||
        /\b(our team|leadership|meet the team|founders)\b/i.test(text))
    ) {
      targets.teamUrl = fullUrl;
    }

    // 2. About / Story target (second priority)
    if (
      !targets.aboutUrl &&
      (/\b(about|our-story|story|about-us|company)\b/i.test(lowerUrl) ||
        /\b(about us|our story|about)\b/i.test(text))
    ) {
      targets.aboutUrl = fullUrl;
    }

    // 3. Contact target (third priority)
    if (
      !targets.contactUrl &&
      (/\b(contact|contact-us|reach-out|press)\b/i.test(lowerUrl) ||
        /\b(contact|contact us|get in touch|press)\b/i.test(text))
    ) {
      targets.contactUrl = fullUrl;
    }
  }

  return targets;
}

/**
 * Extracts public contact points (emails, social handles, phone numbers, contact forms)
 * from scraped page markdown and page metadata.
 */
function getContextLines(lines: string[], startIndex: number, maxLines: number = 4): string[] {
  const result: string[] = [];
  for (let j = startIndex; j < lines.length && result.length < maxLines; j++) {
    const l = lines[j].trim();
    if (j > startIndex && (l.startsWith("#") || l.startsWith("---") || l.startsWith("***"))) {
      break;
    }
    result.push(l);
  }
  return result;
}

/**
 * Extracts public contact points (emails, social handles, phone numbers, contact forms)
 * from scraped page markdown and page metadata.
 */
export function extractContactPoints(
  page: ScrapedPage,
  observedPeople: Person[] = [],
): ContactPoint[] {
  const markdown = page.markdown || "";
  const contactPoints: ContactPoint[] = [];
  const seenValues = new Set<string>();

  // Collect emails and LinkedIn handles already directly attached to observed people
  const directEmailValues = new Set(
    observedPeople.flatMap((p) =>
      p.contactPoints.filter((cp) => cp.type === "email").map((cp) => cp.value.toLowerCase()),
    ),
  );
  const directLinkedinValues = new Set(
    observedPeople.flatMap((p) =>
      p.contactPoints.filter((cp) => cp.type === "linkedin").map((cp) => cp.value.toLowerCase()),
    ),
  );

  const addPoint = (
    type: ContactPointType,
    value: string,
    scope: "individual" | "company",
    verificationStatus: ContactPointVerificationStatus,
    confidence: ConfidenceLevel,
    isDirect: boolean,
  ) => {
    const cleanVal = value.trim();
    const key = `${type}:${cleanVal.toLowerCase()}`;
    if (!cleanVal || seenValues.has(key)) return;
    seenValues.add(key);

    contactPoints.push({
      id: `cp-${page.domain}-${type}-${contactPoints.length + 1}`,
      type,
      value: cleanVal,
      scope,
      verificationStatus,
      confidence,
      sourceUrl: page.url,
      sourceName: page.title || `${page.domain} page`,
      observedAt: page.scrapedAt,
      isDirect,
    });
  };

  // 1. Extract emails from mailto: links
  const mailtoRegex = /mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
  let match: RegExpExecArray | null;
  while ((match = mailtoRegex.exec(markdown)) !== null) {
    const email = match[1].toLowerCase();
    if (isValidEmail(email)) {
      if (directEmailValues.has(email)) continue;
      const localPart = email.split("@")[0];
      const isGeneric = GENERIC_EMAIL_LOCAL_PARTS.has(localPart);

      // Explicit mailto links on the website are verified contact points for the company
      addPoint(
        "email",
        email,
        "company",
        "VERIFIED",
        "high",
        false,
      );
    }
  }

  // Raw email pattern in text
  const rawEmailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
  while ((match = rawEmailRegex.exec(markdown)) !== null) {
    const email = match[0].toLowerCase();
    if (isValidEmail(email)) {
      if (directEmailValues.has(email)) continue;
      const localPart = email.split("@")[0];
      const isGeneric = GENERIC_EMAIL_LOCAL_PARTS.has(localPart);

      // Raw standalone emails remain scope=company, isDirect=false
      addPoint(
        "email",
        email,
        "company",
        "SUPPORTED",
        "medium",
        false,
      );
    }
  }

  // 2. Extract LinkedIn URLs
  const linkedinRegex = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(in|company)\/([a-zA-Z0-9_-]+)/gi;
  while ((match = linkedinRegex.exec(markdown)) !== null) {
    const kind = match[1].toLowerCase();
    const handle = match[2];
    const fullUrl = `https://www.linkedin.com/${kind}/${handle}`;
    if (directLinkedinValues.has(fullUrl.toLowerCase())) continue;

    // Company LinkedIn or unattached individual LinkedIn remains company scope
    addPoint(
      "linkedin",
      fullUrl,
      "company",
      "VERIFIED",
      "high",
      false,
    );
  }

  // 3. Extract Instagram URLs
  const instagramRegex = /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)/gi;
  while ((match = instagramRegex.exec(markdown)) !== null) {
    const handle = match[1].toLowerCase();
    if (!["p", "reel", "reels", "stories", "explore", "accounts", "direct"].includes(handle)) {
      addPoint(
        "instagram",
        `https://www.instagram.com/${handle}`,
        "company",
        "VERIFIED",
        "high",
        false,
      );
    }
  }

  // 4. Extract Twitter/X URLs
  const twitterRegex = /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/gi;
  while ((match = twitterRegex.exec(markdown)) !== null) {
    const handle = match[1].toLowerCase();
    if (!["intent", "share", "home", "search", "explore", "privacy", "tos", "hashtag"].includes(handle)) {
      addPoint(
        "twitter",
        `https://x.com/${handle}`,
        "company",
        "SUPPORTED",
        "medium",
        false,
      );
    }
  }

  // 5. Extract Telephone numbers (tel: links or explicit business phone)
  // Public telephone numbers are ALWAYS scope=company, isDirect=false
  const telRegex = /tel:([+0-9\s().-]{7,20})/gi;
  while ((match = telRegex.exec(markdown)) !== null) {
    const phone = match[1].replace(/[^\d+]/g, "").trim();
    if (phone.length >= 7) {
      addPoint("phone", phone, "company", "VERIFIED", "high", false);
    }
  }

  // 6. Check for Contact Form existence
  if (
    /\b(contact-form|contact-us-form|submit your message|send us a message|get in touch)\b/i.test(
      markdown,
    ) ||
    page.url.includes("/contact")
  ) {
    addPoint("contact_form", page.url, "company", "SUPPORTED", "medium", false);
  }

  return contactPoints;
}

/**
 * Extracts public people and their roles from markdown content.
 * Uses deterministic heading, byline, and structural card patterns.
 */
export function extractPeopleFromPage(page: ScrapedPage): Person[] {
  const markdown = page.markdown || "";
  const lines = markdown.split("\n");
  const people: Person[] = [];
  const seenNames = new Set<string>();

  const addPerson = (
    name: string,
    role: string,
    status: PersonVerificationStatus,
    confidence: ConfidenceLevel,
    excerpt?: string,
    contextLines: string[] = [],
  ) => {
    const trimmedName = name.trim();
    const normalizedKey = trimmedName.toLowerCase().replace(/[^a-z]/g, "");

    if (!isValidPersonName(trimmedName) || seenNames.has(normalizedKey)) return;
    seenNames.add(normalizedKey);

    const roleCategory = categorizeRole(role);
    const personContactPoints: ContactPoint[] = [];
    const contextText = contextLines.join("\n");

    // 1. Look for mailto: in immediate context
    const mailtoRegex = /mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
    let emailMatch: RegExpExecArray | null;
    const seenEmails = new Set<string>();

    while ((emailMatch = mailtoRegex.exec(contextText)) !== null) {
      const email = emailMatch[1].toLowerCase();
      if (isValidEmail(email)) {
        const localPart = email.split("@")[0];
        // General company emails (hello@, info@, support@, etc.) must NEVER be attributed as direct person contact!
        if (!GENERIC_EMAIL_LOCAL_PARTS.has(localPart) && !seenEmails.has(email)) {
          seenEmails.add(email);
          personContactPoints.push({
            id: `cp-${page.domain}-email-${personContactPoints.length + 1}`,
            type: "email",
            value: email,
            scope: "individual",
            verificationStatus: "VERIFIED",
            confidence: "high",
            sourceUrl: page.url,
            sourceName: page.title || `${page.domain} page`,
            observedAt: page.scrapedAt,
            isDirect: true,
          });
        }
      }
    }

    // 2. Look for raw email pattern in immediate context if no mailto found
    if (personContactPoints.length === 0) {
      const rawEmailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
      while ((emailMatch = rawEmailRegex.exec(contextText)) !== null) {
        const email = emailMatch[0].toLowerCase();
        if (isValidEmail(email)) {
          const localPart = email.split("@")[0];
          if (!GENERIC_EMAIL_LOCAL_PARTS.has(localPart) && !seenEmails.has(email)) {
            seenEmails.add(email);
            personContactPoints.push({
              id: `cp-${page.domain}-email-${personContactPoints.length + 1}`,
              type: "email",
              value: email,
              scope: "individual",
              verificationStatus: "SUPPORTED",
              confidence: "medium",
              sourceUrl: page.url,
              sourceName: page.title || `${page.domain} page`,
              observedAt: page.scrapedAt,
              isDirect: true,
            });
          }
        }
      }
    }

    // 3. Look for individual LinkedIn URL in immediate context
    const linkedinRegex = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/gi;
    let liMatch: RegExpExecArray | null;
    while ((liMatch = linkedinRegex.exec(contextText)) !== null) {
      const handle = liMatch[1];
      personContactPoints.push({
        id: `cp-${page.domain}-li-${personContactPoints.length + 1}`,
        type: "linkedin",
        value: `https://www.linkedin.com/in/${handle}`,
        scope: "individual",
        verificationStatus: "VERIFIED",
        confidence: "high",
        sourceUrl: page.url,
        sourceName: page.title || `${page.domain} page`,
        observedAt: page.scrapedAt,
        isDirect: true,
      });
    }

    people.push({
      id: `person-${page.domain}-${people.length + 1}`,
      name: trimmedName,
      role: role.trim(),
      roleCategory,
      verificationStatus: status,
      confidence,
      sourceUrl: page.url,
      sourceName: page.title || `${page.domain} page`,
      observedAt: page.scrapedAt,
      excerpt: excerpt?.trim(),
      contactPoints: personContactPoints,
    });
  };

  // Pattern 1: Markdown Headings or Bold Lines like:
  // "### Jane Doe - Founder & CEO" or "**Jane Doe** - Head of Marketing" or "Jane Doe, CMO"
  const headingRoleRegex = /^(?:#{1,4}\s+|\*\*)?([A-Z][a-zA-Z'\-.]+(?:\s+[A-Z][a-zA-Z'\-.]+){1,3})(?:\*\*)?\s*[-–—|:,]\s*(?:(?:\*\*)?([A-Za-z0-9&/,\s-]+?)(?:\*\*)?)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check heading / bold pattern
    const match = headingRoleRegex.exec(line);
    if (match) {
      const candidateName = match[1].trim();
      const candidateRole = match[2].trim();

      // Ensure the role contains recognizable title keywords
      if (
        /\b(founder|co-founder|co founder|ceo|cmo|cto|coo|cfo|cio|chief|officer|president|director|head of|vp|vice president|lead|manager|owner|creator|partner)\b/i.test(
          candidateRole,
        )
      ) {
        if (isValidPersonName(candidateName)) {
          const contextLines = getContextLines(lines, i, 4);
          addPerson(candidateName, candidateRole, "VERIFIED", "high", line, contextLines);
          continue;
        }
      }
    }

    // Pattern 2: Multi-line team cards:
    // Line 1: "### Jane Doe"
    // Line 2: "Head of Marketing"
    const headingOnly = /^#{2,4}\s+([A-Z][a-zA-Z'\-.]+(?:\s+[A-Z][a-zA-Z'\-.]+){1,3})$/.exec(line);
    if (headingOnly && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (
        /\b(founder|co-founder|co founder|ceo|cmo|cto|coo|cfo|cio|chief|officer|president|director|head of|vp|vice president|lead|manager|owner|creator|partner)\b/i.test(
          nextLine,
        ) &&
        nextLine.length < 60
      ) {
        const candidateName = headingOnly[1].trim();
        if (isValidPersonName(candidateName)) {
          const contextLines = getContextLines(lines, i, 4);
          addPerson(candidateName, nextLine, "VERIFIED", "high", `${line} - ${nextLine}`, contextLines);
          continue;
        }
      }
    }

    // Pattern 3: In-text Founder/Executive Attribution:
    // e.g. "Founded by Jane Doe and John Smith in 2021..."
    // Note: Do not use /i flag here so that lowercase words like 'in', 'at' do not get swallowed into name capture
    const foundedByMatch = /\b(?:[Ff]ounded|[Ss]tarted|[Cc]reated|[Ll]aunched)\s+by\s+([A-Z][a-zA-Z'\-.]+(?:\s+[A-Z][a-zA-Z'\-.]+){1,2})(?:\s+and\s+([A-Z][a-zA-Z'\-.]+(?:\s+[A-Z][a-zA-Z'\-.]+){1,2}))?/.exec(
      line,
    );
    if (foundedByMatch) {
      const name1 = foundedByMatch[1];
      const name2 = foundedByMatch[2];

      if (name1 && isValidPersonName(name1)) {
        addPerson(name1, "Founder", "SUPPORTED", "medium", line, [line]);
      }
      if (name2 && isValidPersonName(name2)) {
        addPerson(name2, "Co-Founder", "SUPPORTED", "medium", line, [line]);
      }
    }

    // Pattern 4: "Jane Doe, CEO and Founder of ..."
    const inlineTitleMatch = /\b([A-Z][a-zA-Z'\-.]+(?:\s+[A-Z][a-zA-Z'\-.]+){1,2}),\s+([A-Za-z0-9&/,\s-]+?)(?:\.|$)/.exec(
      line,
    );
    if (inlineTitleMatch) {
      const candidateName = inlineTitleMatch[1];
      const candidateRole = inlineTitleMatch[2];
      if (
        /\b(founder|co-founder|co founder|ceo|cmo|cto|coo|cfo|cio|chief|officer|president|director|head of|vp|vice president|lead|owner|partner)\b/i.test(
          candidateRole,
        )
      ) {
        if (isValidPersonName(candidateName)) {
          addPerson(candidateName, candidateRole, "SUPPORTED", "medium", line, [line]);
        }
      }
    }
  }

  return people;
}

/**
 * Deterministically associates individual contact points with extracted people
 */
export function associateContactsWithPeople(
  people: Person[],
  contactPoints: ContactPoint[],
): { people: Person[]; companyContacts: ContactPoint[] } {
  const companyContacts: ContactPoint[] = [];

  for (const cp of contactPoints) {
    // All page-wide contact points without direct card attribution are company contacts
    if (cp.scope === "company" || !cp.isDirect) {
      companyContacts.push({
        ...cp,
        scope: "company",
        isDirect: false,
      });
      continue;
    }

    // If an individual contact point was passed in, verify if it is already attached to a person
    const alreadyOnPerson = people.some((p) =>
      p.contactPoints.some((pcp) => pcp.value.toLowerCase() === cp.value.toLowerCase()),
    );

    if (!alreadyOnPerson) {
      // No structural card evidence linking to an observed person -> treat as company contact
      companyContacts.push({
        ...cp,
        scope: "company",
        isDirect: false,
      });
    }
  }

  return { people, companyContacts };
}

/**
 * Deterministically selects the primary contact based on the user's offer.
 * Follows Correction #2:
 * "primaryContact must mean the most offer-relevant verified/supported person, NOT automatically the founder.
 * Implement deterministic role relevance based on:
 * - the user's offer
 * - available role/title
 * - company context"
 */
export function selectPrimaryContact(
  people: Person[],
  offer: string,
): { primaryContact: Person | null; selectionReason?: string } {
  if (!people || people.length === 0) {
    return { primaryContact: null };
  }

  // Filter only VERIFIED and SUPPORTED people. SUGGESTED people are never eligible!
  const eligiblePeople = people.filter(
    (p) => p.verificationStatus === "VERIFIED" || p.verificationStatus === "SUPPORTED",
  );

  if (eligiblePeople.length === 0) {
    return { primaryContact: null };
  }

  const normalizedOffer = offer.toLowerCase();

  // Detect offer domain
  const isCreativeOrMarketingOffer = /\b(ugc|video|content|creative|marketing|tiktok|reels|ads|brand|social media|growth)\b/i.test(
    normalizedOffer,
  );
  const isOperationsOffer = /\b(logistics|warehouse|fulfillment|supply chain|operations|shipping|freight)\b/i.test(
    normalizedOffer,
  );

  // Preference order for role categories based on the offer
  let preferredCategories: RoleCategory[];
  if (isCreativeOrMarketingOffer) {
    preferredCategories = [
      "creative_marketing",
      "founder",
      "executive",
      "operations",
      "unspecified",
    ];
  } else if (isOperationsOffer) {
    preferredCategories = [
      "operations",
      "executive",
      "founder",
      "creative_marketing",
      "unspecified",
    ];
  } else {
    // Default / general offer
    preferredCategories = [
      "founder",
      "executive",
      "creative_marketing",
      "operations",
      "unspecified",
    ];
  }

  // Weight for verification status: VERIFIED > SUPPORTED (SUGGESTED is excluded from eligiblePeople)
  const statusWeights: Record<PersonVerificationStatus, number> = {
    VERIFIED: 30,
    SUPPORTED: 20,
    SUGGESTED: 0,
  };

  // Weight for confidence: high > medium > low
  const confidenceWeights: Record<ConfidenceLevel, number> = {
    high: 5,
    medium: 3,
    low: 1,
  };

  // Score each eligible person deterministically
  const scoredPeople = eligiblePeople.map((person) => {
    const categoryIndex = preferredCategories.indexOf(person.roleCategory);
    const categoryRankScore = (preferredCategories.length - (categoryIndex >= 0 ? categoryIndex : 99)) * 100;
    const statusScore = statusWeights[person.verificationStatus] || 0;
    const confidenceScore = confidenceWeights[person.confidence] || 0;
    const directContactBonus = person.contactPoints.length > 0 ? 2 : 0;

    const totalScore = categoryRankScore + statusScore + confidenceScore + directContactBonus;

    return { person, totalScore };
  });

  // Sort by score descending, then tie-break alphabetically by name
  scoredPeople.sort((a, b) => {
    if (b.totalScore !== a.totalScore) {
      return b.totalScore - a.totalScore;
    }
    return a.person.name.localeCompare(b.person.name);
  });

  const best = scoredPeople[0].person;

  // Formulate an explainable selectionReason
  let reason: string;
  if (isCreativeOrMarketingOffer) {
    if (best.roleCategory === "creative_marketing") {
      reason = `Selected ${best.role} as primary contact because your offer focuses on creative/marketing services.`;
    } else if (best.roleCategory === "founder") {
      reason = `Selected Founder as primary contact because no dedicated marketing or creative leadership was observed in researched pages.`;
    } else {
      reason = `Selected ${best.role} as the most senior executive observed for this company.`;
    }
  } else if (isOperationsOffer) {
    if (best.roleCategory === "operations") {
      reason = `Selected ${best.role} as primary contact because your offer focuses on operational/logistics improvements.`;
    } else if (best.roleCategory === "founder") {
      reason = `Selected Founder as primary contact because no dedicated operations leadership was observed in researched pages.`;
    } else {
      reason = `Selected ${best.role} as the most senior executive observed for this company.`;
    }
  } else {
    reason = `Selected ${best.name} (${best.role}) as the primary contact based on verified leadership standing.`;
  }

  best.selectionReason = reason;

  return { primaryContact: best, selectionReason: reason };
}

/**
 * Builds the backward-compatible Contact projection for legacy API consumers
 */
export function projectLegacyContact(
  primaryContact: Person | null,
  companyContactPoints: ContactPoint[],
  candidate: CandidateCompany,
): Contact {
  const directEmail = primaryContact?.contactPoints.find((cp) => cp.type === "email")?.value;
  const companyEmail = companyContactPoints.find((cp) => cp.type === "email")?.value;
  const publicEmail = directEmail || companyEmail || null;

  const directLinkedin = primaryContact?.contactPoints.find((cp) => cp.type === "linkedin")?.value;
  const companyLinkedin = companyContactPoints.find((cp) => cp.type === "linkedin")?.value;
  const linkedin = directLinkedin || companyLinkedin || null;

  const instagram = companyContactPoints.find((cp) => cp.type === "instagram")?.value || null;

  const contactVerified = Boolean(
    publicEmail &&
      (primaryContact?.contactPoints.some((cp) => cp.type === "email" && cp.verificationStatus === "VERIFIED") ||
        companyContactPoints.some((cp) => cp.type === "email" && cp.verificationStatus === "VERIFIED")),
  );

  return {
    founder: primaryContact?.name || null,
    publicEmail,
    website: candidate.url,
    instagram,
    linkedin,
    contactVerified,
    source: "Firecrawl public web enrichment",
  };
}

/**
 * Deterministic enrichment engine that performs Phase 2.3 Contact Enrichment.
 * Follows the strict guardrails:
 * - Public information only
 * - At most 1 secondary scrape target (priority: team > about > contact)
 * - Deterministic role relevance without LLMs
 * - Explicit absence when not observed
 * - Strict verification states (ContactPoint has NO 'SUGGESTED')
 */
export async function enrichCandidate(
  candidate: CandidateCompany,
  primaryPage: ScrapedPage,
  radar: { offer: string; target: string },
  researchProvider?: ResearchProvider,
): Promise<EnrichmentResult> {
  // 1. Extract people and initial contact points from the primary researched page
  let people = extractPeopleFromPage(primaryPage);
  let rawContactPoints = extractContactPoints(primaryPage, people);

  // 2. Determine whether a secondary targeted scrape is needed.
  // Rule: At most 1 secondary scrape target, only if leadership or direct contacts are missing on primary page.
  if (researchProvider && people.length === 0) {
    const targets = findSecondaryScrapeTargets(primaryPage.markdown || "", primaryPage.url);
    const secondaryUrl = targets.teamUrl || targets.aboutUrl || targets.contactUrl;

    if (secondaryUrl && secondaryUrl !== primaryPage.url) {
      try {
        logger.info(
          { domain: candidate.domain, secondaryUrl },
          "Executing single targeted secondary scrape for contact enrichment",
        );
        const secondaryPage = await researchProvider.scrapePage(secondaryUrl, {
          timeoutMs: 12000,
        });

        // Extract from secondary page and merge
        const secondaryPeople = extractPeopleFromPage(secondaryPage);
        const secondaryContacts = extractContactPoints(secondaryPage, secondaryPeople);

        // Deduplicate people
        for (const sp of secondaryPeople) {
          if (!people.some((p) => p.name.toLowerCase() === sp.name.toLowerCase())) {
            people.push(sp);
          }
        }

        // Deduplicate contact points
        for (const sc of secondaryContacts) {
          if (!rawContactPoints.some((c) => c.type === sc.type && c.value.toLowerCase() === sc.value.toLowerCase())) {
            rawContactPoints.push(sc);
          }
        }
      } catch (err) {
        logger.warn(
          { secondaryUrl, err: err instanceof Error ? err.message : err },
          "Secondary contact enrichment scrape failed, continuing with primary findings",
        );
      }
    }
  }

  // 3. Associate individual contact points with people
  const { people: enrichedPeople, companyContacts } = associateContactsWithPeople(
    people,
    rawContactPoints,
  );

  // 4. Deterministically select primaryContact based on offer
  const { primaryContact } = selectPrimaryContact(enrichedPeople, radar.offer);

  // 5. Generate transparent, evidence-backed enrichment summary
  let summary = "";
  if (enrichedPeople.length > 0) {
    const names = enrichedPeople.map((p) => `${p.name} (${p.role})`).join(", ");
    summary = `Observed ${enrichedPeople.length} team member${enrichedPeople.length > 1 ? "s" : ""}: ${names}.`;
  } else {
    summary = "No team members or leadership profiles observed on researched public pages.";
  }

  const directEmail = primaryContact?.contactPoints.find((cp) => cp.type === "email");
  const companyEmail = companyContacts.find((cp) => cp.type === "email");

  if (directEmail) {
    summary += ` Direct contact email found: ${directEmail.value}.`;
  } else if (companyEmail) {
    summary += ` General business email observed: ${companyEmail.value}.`;
  } else {
    summary += ` Direct email address was not observed on researched public pages.`;
  }

  // 6. Project legacy Contact structure
  const legacyContact = projectLegacyContact(primaryContact, companyContacts, candidate);

  return {
    people: enrichedPeople,
    companyContactPoints: companyContacts,
    primaryContact,
    summary,
    legacyContact,
  };
}

export class PublicEnrichmentService implements EnrichmentProvider {
  async enrich(
    candidate: CandidateCompany,
    primaryPage: ScrapedPage,
    radar: { offer: string; target: string },
    researchProvider?: ResearchProvider,
  ): Promise<EnrichmentResult> {
    return enrichCandidate(candidate, primaryPage, radar, researchProvider);
  }
}

export const publicEnrichmentService = new PublicEnrichmentService();
