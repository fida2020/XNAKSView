import type { CategoryScore, ContentAnalysisResult, ModerationCategoryName } from '@/lib/moderation/types';

/**
 * XNAKView's own in-house, deterministic text classifier — no external
 * vendor required (same "no external vendor needed for this part"
 * rationale as `fraudRiskEngine.ts`), so the categories it covers
 * (abusive/profane language, threats, hate/harassment structure, bullying,
 * scam/fraud, spam) are ALWAYS assessable in production, never dependent on
 * an unconfigured third-party key. `openAiModerationClient.ts`'s real
 * vendor adapter complements this for categories a keyword/pattern engine
 * does badly (sexual content, graphic violence, nuanced hate speech).
 *
 * This is a genuine, disclosed limitation: a keyword/pattern engine is not
 * equivalent to a trained ML classifier — it is deliberately conservative
 * about context (quotation/reporting, negation, targeted-vs-generic use)
 * so it degrades toward UNDER-flagging ambiguous cases rather than
 * blindly banning on a bare keyword hit (brief §3: "Do NOT blindly ban
 * based on a keyword match").
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[@]/g, 'a')
    .replace(/[$]/g, 's')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/7/g, 't')
    .replace(/(.)\1{2,}/g, '$1$1'); // collapse 3+ repeated chars ("soooo" -> "soo")
}

const NEGATION_WORDS = ['not', 'never', "don't", 'dont', "wouldn't", 'wouldnt', "didn't", 'didnt', 'no one would', 'would never'];
const REPORTING_VERBS = ['said', 'told', 'wrote', 'posted', 'screenshot', 'quote', 'quoting', 'reported', 'texted', 'messaged'];

/** True if a quoted span near `index` is preceded (within ~40 chars) by a reporting verb — "she said 'i will kill you'" reads very differently from a direct threat. */
function hasQuotedReportingContext(normalized: string, index: number): boolean {
  const windowStart = Math.max(0, index - 60);
  const before = normalized.slice(windowStart, index);
  const hasQuoteMark = /['"]/.test(before.slice(-15));
  if (!hasQuoteMark) return false;
  return REPORTING_VERBS.some((verb) => before.includes(verb));
}

/** True if a negation word appears shortly before the match — "i would never hurt you" should not score as a threat. */
function isNegated(normalized: string, index: number): boolean {
  const windowStart = Math.max(0, index - 25);
  const before = normalized.slice(windowStart, index);
  return NEGATION_WORDS.some((word) => before.includes(word));
}

/** True if the match is aimed at a specific person ("you"/@mention nearby) rather than generic/self-referential ("i'm such an idiot"). */
function isTargeted(normalized: string, index: number, matchLength: number): boolean {
  const windowStart = Math.max(0, index - 20);
  const windowEnd = Math.min(normalized.length, index + matchLength + 20);
  const around = normalized.slice(windowStart, windowEnd);
  return /\byou\b|\byour\b|@\w+/.test(around);
}

interface PatternRule {
  category: ModerationCategoryName;
  pattern: RegExp;
  baseConfidence: number;
}

// Deliberately generic patterns/common profanity rather than a slur
// dictionary — see this file's doc comment on why hate-speech nuance is
// left to a real ML/vendor classifier (`openAiModerationClient.ts`) rather
// than hardcoded here.
const RULES: PatternRule[] = [
  // Direct threats — phrase-structure based, not a bare word list, so
  // "kill it at the show" or "this show is fire" never match.
  { category: 'THREATS', pattern: /\b(i(?:'|’)?ll|i will|gonna|going to) (kill|hurt|beat up|stab|shoot|hunt down|find and hurt) (you|u|him|her|them)\b/, baseConfidence: 0.95 },
  { category: 'THREATS', pattern: /\bkill (yourself|urself|ur ?self)\b/, baseConfidence: 0.93 },
  { category: 'THREATS', pattern: /\bi know where you live\b/, baseConfidence: 0.85 },

  // Hate/harassment structure (dehumanizing generalizations), not a slur list.
  { category: 'HATE_HARASSMENT', pattern: /\ball (\w+ )?(people|men|women) are (subhuman|animals|vermin|disgusting|worthless)\b/, baseConfidence: 0.9 },
  { category: 'HATE_HARASSMENT', pattern: /\bgo back to (your|ur) (own )?country\b/, baseConfidence: 0.75 },
  { category: 'HATE_HARASSMENT', pattern: /\byou (people|(\w+ ){0,2}(people|folks)) (don'?t|do not) belong here\b/, baseConfidence: 0.8 },

  // Bullying — targeted insults (targeting boosts confidence, see isTargeted()).
  { category: 'BULLYING', pattern: /\b(nobody|no one) likes you\b/, baseConfidence: 0.7 },
  { category: 'BULLYING', pattern: /\byou'?re (so |such a )?(ugly|worthless|pathetic|a loser|stupid|disgusting)\b/, baseConfidence: 0.6 },

  // Abusive/profane language — common profanity, MEDIUM baseline (context can raise/lower it).
  { category: 'ABUSIVE_PROFANE_LANGUAGE', pattern: /\b(fuck|fucking|fucker|motherfucker)\b/, baseConfidence: 0.5 },
  { category: 'ABUSIVE_PROFANE_LANGUAGE', pattern: /\b(bitch|asshole|bastard|dumbass|piece of shit)\b/, baseConfidence: 0.55 },
  { category: 'ABUSIVE_PROFANE_LANGUAGE', pattern: /\b(shit|crap|damn)\b/, baseConfidence: 0.25 },

  // Scam/fraud — common social-engineering phrasing.
  { category: 'SCAM_FRAUD', pattern: /\b(wire transfer|send (me |us )?(money|\$|gift cards?)|double your money|guaranteed profit|claim your prize|verify your account (by |now,? )?click)\b/, baseConfidence: 0.7 },
  { category: 'SCAM_FRAUD', pattern: /\binvest (with|through) me\b|\bcrypto (giveaway|doubling)\b/, baseConfidence: 0.65 },

  // Spam — engagement-bait / mass-DM patterns.
  { category: 'SPAM', pattern: /\b(follow for follow|f4f|sub4sub|check my bio|dm me for|make \$+\d+ (fast|a day)|click the link in my bio)\b/, baseConfidence: 0.55 },

  // Dangerous behavior — self-harm/dangerous-act phrasing.
  { category: 'DANGEROUS_BEHAVIOR', pattern: /\b(how to make a bomb|how to (build|make) a weapon|self[- ]harm challenge)\b/, baseConfidence: 0.85 },
];

/**
 * The XNAKView-specific in-house classifier. Never throws, never returns
 * "unconfigured" — this is always available (no external credentials
 * needed), matching `fraudRiskEngine.ts`'s own precedent.
 */
export function classifyTextInHouse(text: string): ContentAnalysisResult {
  const normalized = normalize(text);
  const scores = new Map<ModerationCategoryName, number>();
  const contextNotes: string[] = [];

  for (const rule of RULES) {
    const match = rule.pattern.exec(normalized);
    if (!match) continue;

    const index = match.index;
    let confidence = rule.baseConfidence;

    if (isNegated(normalized, index)) {
      confidence *= 0.25;
      contextNotes.push(`negation_detected:${rule.category}`);
    }
    if (hasQuotedReportingContext(normalized, index)) {
      confidence *= 0.5;
      contextNotes.push(`quoted_reporting_context:${rule.category}`);
    }
    if (rule.category === 'BULLYING' || rule.category === 'ABUSIVE_PROFANE_LANGUAGE' || rule.category === 'THREATS') {
      const targeted = isTargeted(normalized, index, match[0].length);
      confidence *= targeted ? 1.1 : 0.7;
      if (targeted) contextNotes.push(`targeted_at_person:${rule.category}`);
    }

    confidence = Math.min(1, Math.max(0, confidence));
    const existing = scores.get(rule.category) ?? 0;
    if (confidence > existing) scores.set(rule.category, confidence);
  }

  const categoryScores: CategoryScore[] = Array.from(scores.entries()).map(([category, confidence]) => ({ category, confidence }));
  return { categoryScores, contextNotes: contextNotes.length ? contextNotes : undefined };
}
