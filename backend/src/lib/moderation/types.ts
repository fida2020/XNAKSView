/**
 * Shared types for every moderation provider (Step 10). Mirrors
 * `lib/payout/payoutProvider.ts`'s `ProviderResult<T>` convention exactly:
 * `{ configured: false, reason }` is a REFUSAL, never a fabricated "safe"
 * result — every caller of `analyze*` must branch on `configured` before
 * trusting a result.
 */
export type ProviderResult<T> = ({ configured: true } & T) | { configured: false; reason: string };

export type ModerationCategoryName =
  | 'SEXUAL_NUDITY'
  | 'EXPLOITATION'
  | 'VIOLENCE'
  | 'GRAPHIC_CONTENT'
  | 'THREATS'
  | 'HATE_HARASSMENT'
  | 'BULLYING'
  | 'ABUSIVE_PROFANE_LANGUAGE'
  | 'DANGEROUS_BEHAVIOR'
  | 'SCAM_FRAUD'
  | 'SPAM'
  | 'IMPERSONATION'
  | 'ILLEGAL_REGULATED'
  | 'HARMFUL_CONTENT'
  | 'COPYRIGHT'
  | 'OTHER_POLICY_VIOLATION';

export interface CategoryScore {
  category: ModerationCategoryName;
  confidence: number; // 0.0-1.0
}

export interface ContentAnalysisResult {
  categoryScores: CategoryScore[];
  /** Free-form audit notes, e.g. "quoted/reporting context detected" — never the raw analyzed content itself. */
  contextNotes?: string[];
}

export interface TextModerationProvider {
  readonly name: string;
  isConfigured(): boolean;
  analyzeText(input: { text: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>>;
}

export interface ImageModerationProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** `imageUrl` must be a URL the provider can fetch (a signed/public storage URL) — never a raw file upload proxied through this call. */
  analyzeImage(input: { imageUrl: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>>;
}

export interface VideoModerationProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Architecture for sampled-frame analysis over an already-uploaded video — see this file's provider doc comment for today's real-vendor status. */
  analyzeVideo(input: { videoStorageKey: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>>;
}

export interface AudioModerationProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Architecture for transcribe-then-classify over an already-uploaded audio clip (a voice message, a LIVE audio sample). */
  analyzeAudio(input: { audioStorageKey: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>>;
}

export interface LivenessCheckOutcome {
  status: 'PASSED' | 'FAILED' | 'PENDING';
  providerReferenceId: string;
}

export interface LivenessProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** A selfie liveness check, kept separate from `IdentityVerificationProvider` (Step 9) — a real integration may run liveness before/alongside document KYC via a different vendor product. */
  checkLiveness(input: { userId: string; selfieImageUrl: string }): Promise<ProviderResult<{ outcome: LivenessCheckOutcome }>>;
}
