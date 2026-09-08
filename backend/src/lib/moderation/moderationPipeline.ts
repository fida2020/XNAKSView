import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';

import { applyEnforcement } from '@/lib/moderation/enforcementService';
import { getAudioModerationProvider, getVideoModerationProvider } from '@/lib/moderation/videoAudioModerationProvider';
import { getImageModerationProviders } from '@/lib/moderation/imageModerationProvider';
import { getTextModerationProviders } from '@/lib/moderation/textModerationProvider';
import type { CategoryScore, ContentAnalysisResult, ModerationCategoryName } from '@/lib/moderation/types';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

/**
 * The ONE unified moderation pipeline (brief §1): content/event ->
 * automated detection -> policy classification -> confidence/severity
 * assessment -> enforcement decision -> action -> audit record -> (user
 * notification/appeal path are served by `EnforcementAction`/`Appeal`
 * themselves — see `routes/v1/accountStatus.ts`/`appeals.ts`). Every
 * content-creation route calls `moderateText`/`moderateImage`/
 * `moderateVideo`/`moderateAudio` here — none should ever implement its own
 * moderation logic inline.
 */

export type ModerationDecisionName =
  | 'ALLOW'
  | 'LIMIT'
  | 'NOT_RECOMMENDED'
  | 'AGE_RESTRICT'
  | 'REMOVE'
  | 'FEATURE_RESTRICT'
  | 'TEMPORARY_ACCOUNT_RESTRICT'
  | 'PERMANENT_BAN';

export type ModerationSeverityName = 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE';

export type ModerationContentTypeName =
  | 'VIDEO'
  | 'VIDEO_COMMENT'
  | 'PHOTO_POST'
  | 'PHOTO_POST_COMMENT'
  | 'TEXT_POST'
  | 'TEXT_POST_COMMENT'
  | 'STORY'
  | 'MESSAGE'
  | 'LIVE_CHAT_MESSAGE'
  | 'LIVE_SESSION'
  | 'USER_PROFILE'
  | 'USERNAME'
  | 'BIO'
  | 'AVATAR';

export interface ModerationOutcome {
  moderationEventId: string;
  decision: ModerationDecisionName;
  severity: ModerationSeverityName | null;
  topCategory: ModerationCategoryName | null;
  confidence: number;
  enforcementActionId: string | null;
  /** True only when at least one real provider (in-house or a configured vendor) actually analyzed the content — false means the ALLOW decision reflects "not analyzed", never a fabricated "safe" result. */
  analyzed: boolean;
}

function severityFromConfidence(confidence: number): ModerationSeverityName {
  if (confidence >= 0.9) return 'SEVERE';
  if (confidence >= 0.7) return 'HIGH';
  if (confidence >= 0.4) return 'MEDIUM';
  return 'LOW';
}

// Comments, DMs, LIVE chat, and LIVE sessions (LIVE speech/audio) — exactly
// the surfaces named in the brief's §3 "XNAKView Strict Abuse Rule".
const STRICT_ABUSE_CONTENT_TYPES: ModerationContentTypeName[] = ['VIDEO_COMMENT', 'TEXT_POST_COMMENT', 'PHOTO_POST_COMMENT', 'MESSAGE', 'LIVE_CHAT_MESSAGE', 'LIVE_SESSION'];
const STRICT_ABUSE_CATEGORIES: ModerationCategoryName[] = ['THREATS', 'HATE_HARASSMENT', 'BULLYING', 'ABUSIVE_PROFANE_LANGUAGE'];

/**
 * Not every violation is treated identically (brief §2). The XNAKView
 * Strict Abuse Rule (brief §3) is the ONE deliberate exception to the
 * general ladder below: a SEVERE (>=0.9 confidence) abusive/threatening/
 * hateful match on a comment/DM/LIVE-chat/LIVE-session can go straight to
 * PERMANENT_BAN — but only because `textHeuristics.ts` already discounted
 * quoted/negated/non-targeted/ambiguous matches well below that confidence
 * floor before this function ever sees them (brief: "do NOT blindly ban
 * based on a keyword match... minor/ambiguous cases must use proportionate
 * enforcement instead").
 */
export function resolveModerationDecision(top: CategoryScore, contentType: ModerationContentTypeName): { severity: ModerationSeverityName; decision: ModerationDecisionName } {
  const severity = severityFromConfidence(top.confidence);

  if (STRICT_ABUSE_CONTENT_TYPES.includes(contentType) && STRICT_ABUSE_CATEGORIES.includes(top.category) && severity === 'SEVERE') {
    return { severity, decision: 'PERMANENT_BAN' };
  }

  switch (top.category) {
    case 'EXPLOITATION':
      // Zero-tolerance category — always treated as SEVERE regardless of the confidence tier boundaries used elsewhere.
      return { severity: 'SEVERE', decision: top.confidence >= 0.5 ? 'PERMANENT_BAN' : 'REMOVE' };
    case 'SEXUAL_NUDITY':
      if (severity === 'SEVERE' || severity === 'HIGH') return { severity, decision: 'REMOVE' };
      if (severity === 'MEDIUM') return { severity, decision: 'AGE_RESTRICT' };
      return { severity, decision: 'LIMIT' };
    case 'VIOLENCE':
    case 'GRAPHIC_CONTENT':
      if (severity === 'SEVERE') return { severity, decision: 'REMOVE' };
      if (severity === 'HIGH') return { severity, decision: 'AGE_RESTRICT' };
      if (severity === 'MEDIUM') return { severity, decision: 'NOT_RECOMMENDED' };
      return { severity, decision: 'LIMIT' };
    case 'THREATS':
    case 'HATE_HARASSMENT':
    case 'BULLYING':
      // Content types OUTSIDE the strict-abuse surface (e.g. a video caption) never auto-ban — feature/account restriction instead.
      if (severity === 'SEVERE') return { severity, decision: 'TEMPORARY_ACCOUNT_RESTRICT' };
      if (severity === 'HIGH') return { severity, decision: 'REMOVE' };
      if (severity === 'MEDIUM') return { severity, decision: 'LIMIT' };
      return { severity, decision: 'ALLOW' };
    case 'ABUSIVE_PROFANE_LANGUAGE':
      if (severity === 'SEVERE' || severity === 'HIGH') return { severity, decision: 'REMOVE' };
      if (severity === 'MEDIUM') return { severity, decision: 'LIMIT' };
      return { severity, decision: 'ALLOW' };
    case 'DANGEROUS_BEHAVIOR':
      if (severity === 'SEVERE' || severity === 'HIGH') return { severity, decision: 'REMOVE' };
      return { severity, decision: 'NOT_RECOMMENDED' };
    case 'SCAM_FRAUD':
    case 'SPAM':
      if (severity === 'SEVERE' || severity === 'HIGH') return { severity, decision: 'REMOVE' };
      return { severity, decision: 'LIMIT' };
    case 'IMPERSONATION':
    case 'ILLEGAL_REGULATED':
    case 'COPYRIGHT':
    case 'HARMFUL_CONTENT':
    case 'OTHER_POLICY_VIOLATION':
    default:
      if (severity === 'SEVERE' || severity === 'HIGH') return { severity, decision: 'REMOVE' };
      if (severity === 'MEDIUM') return { severity, decision: 'LIMIT' };
      return { severity, decision: 'ALLOW' };
  }
}

function topCategoryOf(scores: CategoryScore[]): CategoryScore | null {
  return scores.reduce<CategoryScore | null>((max, c) => (c.confidence > (max?.confidence ?? -1) ? c : max), null);
}

/** SHA-256 of the analyzed text — evidence that survives content edits/deletion without ever storing the raw text itself (brief §15). */
export function hashTextEvidence(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function finalizeModerationEvent(params: {
  contentType: ModerationContentTypeName;
  contentId: string;
  authorId: string | null;
  provider: string;
  providerRequestId?: string;
  analyzed: boolean;
  result: ContentAnalysisResult;
  evidenceKind: string;
  evidenceReference: string;
}): Promise<ModerationOutcome> {
  const top = topCategoryOf(params.result.categoryScores);
  const resolved = params.analyzed && top ? resolveModerationDecision(top, params.contentType) : null;
  const decision: ModerationDecisionName = resolved?.decision ?? 'ALLOW';
  const severity: ModerationSeverityName = resolved?.severity ?? 'LOW';

  const moderationEvent = await prisma.moderationEvent.create({
    data: {
      contentType: params.contentType,
      contentId: params.contentId,
      authorId: params.authorId,
      provider: params.provider,
      providerRequestId: params.providerRequestId,
      categories: params.result.categoryScores as unknown as Prisma.InputJsonValue,
      severity,
      confidence: top?.confidence ?? 0,
      decision,
      evidence: {
        create: [
          {
            kind: params.evidenceKind,
            reference: params.evidenceReference,
            metadata: params.result.contextNotes ? ({ contextNotes: params.result.contextNotes } as Prisma.InputJsonValue) : undefined,
          },
        ],
      },
    },
  });

  let enforcementActionId: string | null = null;
  if (decision !== 'ALLOW' && params.authorId && top) {
    const action = await applyEnforcement({
      userId: params.authorId,
      decision,
      category: top.category,
      severity,
      sourceType: 'MODERATION_EVENT',
      moderationEventId: moderationEvent.id,
      contentType: params.contentType,
      contentId: params.contentId,
      reason: `Automated moderation: ${top.category} (confidence ${top.confidence.toFixed(2)}) on ${params.contentType}`,
    });
    enforcementActionId = action.id;
  }

  return { moderationEventId: moderationEvent.id, decision, severity: top ? severity : null, topCategory: top?.category ?? null, confidence: top?.confidence ?? 0, enforcementActionId, analyzed: params.analyzed };
}

export async function moderateText(input: { contentType: ModerationContentTypeName; contentId: string; authorId: string | null; text: string }): Promise<ModerationOutcome> {
  const providers = getTextModerationProviders().filter((p) => p.isConfigured());
  const merged = new Map<ModerationCategoryName, number>();
  const contextNotes: string[] = [];
  const usedProviderNames: string[] = [];
  let providerRequestId: string | undefined;

  for (const provider of providers) {
    const result = await provider.analyzeText({ text: input.text });
    if (!result.configured) continue;
    usedProviderNames.push(provider.name);
    providerRequestId = result.providerRequestId ?? providerRequestId;
    for (const score of result.result.categoryScores) {
      const existing = merged.get(score.category) ?? 0;
      if (score.confidence > existing) merged.set(score.category, score.confidence);
    }
    if (result.result.contextNotes) contextNotes.push(...result.result.contextNotes);
  }

  const categoryScores: CategoryScore[] = Array.from(merged.entries()).map(([category, confidence]) => ({ category, confidence }));
  return finalizeModerationEvent({
    contentType: input.contentType,
    contentId: input.contentId,
    authorId: input.authorId,
    provider: usedProviderNames.length ? usedProviderNames.join('+') : 'UNCONFIGURED',
    providerRequestId,
    analyzed: usedProviderNames.length > 0,
    result: { categoryScores, contextNotes: contextNotes.length ? contextNotes : undefined },
    evidenceKind: 'TEXT_SNIPPET_HASH',
    evidenceReference: hashTextEvidence(input.text),
  });
}

export async function moderateImage(input: { contentType: ModerationContentTypeName; contentId: string; authorId: string | null; imageUrl: string }): Promise<ModerationOutcome> {
  const providers = getImageModerationProviders().filter((p) => p.isConfigured());
  const merged = new Map<ModerationCategoryName, number>();
  const usedProviderNames: string[] = [];
  let providerRequestId: string | undefined;

  for (const provider of providers) {
    const result = await provider.analyzeImage({ imageUrl: input.imageUrl });
    if (!result.configured) continue;
    usedProviderNames.push(provider.name);
    providerRequestId = result.providerRequestId ?? providerRequestId;
    for (const score of result.result.categoryScores) {
      const existing = merged.get(score.category) ?? 0;
      if (score.confidence > existing) merged.set(score.category, score.confidence);
    }
  }

  const categoryScores: CategoryScore[] = Array.from(merged.entries()).map(([category, confidence]) => ({ category, confidence }));
  return finalizeModerationEvent({
    contentType: input.contentType,
    contentId: input.contentId,
    authorId: input.authorId,
    provider: usedProviderNames.length ? usedProviderNames.join('+') : 'UNCONFIGURED',
    providerRequestId,
    analyzed: usedProviderNames.length > 0,
    result: { categoryScores },
    evidenceKind: 'IMAGE_REF',
    evidenceReference: input.imageUrl,
  });
}

export async function moderateVideo(input: { contentType: ModerationContentTypeName; contentId: string; authorId: string | null; videoStorageKey: string }): Promise<ModerationOutcome> {
  const provider = getVideoModerationProvider();
  const configured = provider.isConfigured();
  const result = configured ? await provider.analyzeVideo({ videoStorageKey: input.videoStorageKey }) : null;
  const categoryScores = result?.configured ? result.result.categoryScores : [];
  return finalizeModerationEvent({
    contentType: input.contentType,
    contentId: input.contentId,
    authorId: input.authorId,
    provider: result?.configured ? provider.name : 'UNCONFIGURED',
    providerRequestId: result?.configured ? result.providerRequestId : undefined,
    analyzed: Boolean(result?.configured),
    result: { categoryScores },
    evidenceKind: 'VIDEO_FRAME_REF',
    evidenceReference: input.videoStorageKey,
  });
}

export async function moderateAudio(input: { contentType: ModerationContentTypeName; contentId: string; authorId: string | null; audioStorageKey: string }): Promise<ModerationOutcome> {
  const provider = getAudioModerationProvider();
  const configured = provider.isConfigured();
  const result = configured ? await provider.analyzeAudio({ audioStorageKey: input.audioStorageKey }) : null;
  const categoryScores = result?.configured ? result.result.categoryScores : [];
  return finalizeModerationEvent({
    contentType: input.contentType,
    contentId: input.contentId,
    authorId: input.authorId,
    provider: result?.configured ? provider.name : 'UNCONFIGURED',
    providerRequestId: result?.configured ? result.providerRequestId : undefined,
    analyzed: Boolean(result?.configured),
    result: { categoryScores },
    evidenceKind: 'AUDIO_REF',
    evidenceReference: input.audioStorageKey,
  });
}

/**
 * Shared route-level guard: given a pipeline outcome for content that
 * hasn't been persisted yet, throws a clean, user-facing error if the
 * content must not be created at all (REMOVE/TEMPORARY_ACCOUNT_RESTRICT/
 * PERMANENT_BAN) — the enforcement (including deleting the row, if the
 * caller created it before checking) has ALREADY happened inside
 * `moderateText`/`moderateImage`/etc; this only decides what the HTTP
 * response says. LIMIT/NOT_RECOMMENDED/AGE_RESTRICT/ALLOW never throw —
 * that content is created, just flagged/restricted in distribution.
 */
export function assertModerationAllowsCreation(outcome: ModerationOutcome, contentLabel: string): void {
  if (outcome.decision === 'REMOVE' || outcome.decision === 'TEMPORARY_ACCOUNT_RESTRICT' || outcome.decision === 'PERMANENT_BAN') {
    throw new AppError('FORBIDDEN', `Your ${contentLabel} was removed for violating XNAKView's Community Guidelines`);
  }
}
