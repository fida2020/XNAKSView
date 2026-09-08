import { randomUUID } from 'crypto';

import { isTest } from '@/config/env';
import { callOpenAiModeration, isOpenAiModerationConfigured } from '@/lib/moderation/openAiModerationClient';
import { classifyTextInHouse } from '@/lib/moderation/textHeuristics';
import type { CategoryScore, ContentAnalysisResult, ModerationCategoryName, ProviderResult, TextModerationProvider } from '@/lib/moderation/types';

/** OpenAI's own category names -> XNAKView's `ModerationCategoryName` — see https://platform.openai.com/docs/guides/moderation for the source taxonomy. */
const OPENAI_CATEGORY_MAP: Record<string, ModerationCategoryName> = {
  sexual: 'SEXUAL_NUDITY',
  'sexual/minors': 'EXPLOITATION',
  harassment: 'HATE_HARASSMENT',
  'harassment/threatening': 'THREATS',
  hate: 'HATE_HARASSMENT',
  'hate/threatening': 'THREATS',
  illicit: 'ILLEGAL_REGULATED',
  'illicit/violent': 'DANGEROUS_BEHAVIOR',
  'self-harm': 'DANGEROUS_BEHAVIOR',
  'self-harm/intent': 'DANGEROUS_BEHAVIOR',
  'self-harm/instructions': 'DANGEROUS_BEHAVIOR',
  violence: 'VIOLENCE',
  'violence/graphic': 'GRAPHIC_CONTENT',
};

export function mapOpenAiCategoryScores(categoryScoresRaw: Record<string, number>): CategoryScore[] {
  const merged = new Map<ModerationCategoryName, number>();
  for (const [openAiCategory, score] of Object.entries(categoryScoresRaw)) {
    const mapped = OPENAI_CATEGORY_MAP[openAiCategory];
    if (!mapped) continue; // categories XNAKView doesn't track (e.g. finer sub-splits) are skipped, never silently invented
    const existing = merged.get(mapped) ?? 0;
    if (score > existing) merged.set(mapped, score);
  }
  return Array.from(merged.entries()).map(([category, confidence]) => ({ category, confidence }));
}

/** Always available — no external credentials required. See `textHeuristics.ts`'s doc comment for what it covers and its disclosed limitations. */
class InHouseTextHeuristicsProvider implements TextModerationProvider {
  readonly name = 'XNAKVIEW_IN_HOUSE';

  isConfigured(): boolean {
    return true;
  }

  async analyzeText(input: { text: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>> {
    return { configured: true, result: classifyTextInHouse(input.text) };
  }
}

/** Real vendor adapter — OpenAI's Moderation API. `isConfigured()` is false (and every call refuses honestly) until `OPENAI_MODERATION_API_KEY` is set; see the Step 10 completion report for current status. */
class OpenAiTextModerationProvider implements TextModerationProvider {
  readonly name = 'OPENAI';

  isConfigured(): boolean {
    return isOpenAiModerationConfigured();
  }

  async analyzeText(input: { text: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>> {
    if (!this.isConfigured()) {
      return { configured: false, reason: 'Text moderation vendor is not configured on this server (set OPENAI_MODERATION_API_KEY)' };
    }
    const response = await callOpenAiModeration([{ type: 'text', text: input.text }]);
    const first = response.results[0];
    const categoryScores = first ? mapOpenAiCategoryScores(first.category_scores) : [];
    return { configured: true, result: { categoryScores }, providerRequestId: response.id };
  }
}

/**
 * Deterministic test double, `NODE_ENV=test` only — mirrors
 * `lib/payout/payoutProvider.ts`'s `MockPayoutProvider` convention. Trigger
 * a specific outcome by including a marker anywhere in the text:
 *   - "SIMULATE_SEVERE_ABUSE"    -> HATE_HARASSMENT + THREATS, confidence 0.97 (severe, high-confidence)
 *   - "SIMULATE_AMBIGUOUS_ABUSE" -> ABUSIVE_PROFANE_LANGUAGE, confidence 0.4 (ambiguous — must NOT trigger a permanent ban)
 *   - "SIMULATE_QUOTED_ABUSE"    -> same categories as SEVERE but with a quoted-context note and confidence 0.45 (context downgraded it)
 *   - "SIMULATE_SCAM"            -> SCAM_FRAUD, confidence 0.9
 *   - "SIMULATE_SPAM"            -> SPAM, confidence 0.9
 *   - anything else              -> no categories (ALLOW)
 */
class MockTextModerationProvider implements TextModerationProvider {
  readonly name = 'MOCK';

  isConfigured(): boolean {
    return true;
  }

  async analyzeText(input: { text: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>> {
    const text = input.text;
    const providerRequestId = `mock-mod-${randomUUID()}`;
    if (text.includes('SIMULATE_SEVERE_ABUSE')) {
      return {
        configured: true,
        providerRequestId,
        result: {
          categoryScores: [
            { category: 'HATE_HARASSMENT', confidence: 0.97 },
            { category: 'THREATS', confidence: 0.96 },
          ],
        },
      };
    }
    if (text.includes('SIMULATE_AMBIGUOUS_ABUSE')) {
      return { configured: true, providerRequestId, result: { categoryScores: [{ category: 'ABUSIVE_PROFANE_LANGUAGE', confidence: 0.4 }] } };
    }
    if (text.includes('SIMULATE_QUOTED_ABUSE')) {
      return {
        configured: true,
        providerRequestId,
        result: { categoryScores: [{ category: 'HATE_HARASSMENT', confidence: 0.45 }], contextNotes: ['quoted_reporting_context:HATE_HARASSMENT'] },
      };
    }
    if (text.includes('SIMULATE_SCAM')) {
      return { configured: true, providerRequestId, result: { categoryScores: [{ category: 'SCAM_FRAUD', confidence: 0.9 }] } };
    }
    if (text.includes('SIMULATE_SPAM')) {
      return { configured: true, providerRequestId, result: { categoryScores: [{ category: 'SPAM', confidence: 0.9 }] } };
    }
    return { configured: true, providerRequestId, result: { categoryScores: [] } };
  }
}

const inHouseProvider = new InHouseTextHeuristicsProvider();
const openAiProvider = new OpenAiTextModerationProvider();
const mockProvider = new MockTextModerationProvider();

/** Every provider the text pipeline consults — the in-house one is ALWAYS included (never dependent on a vendor key); the OpenAI adapter adds coverage when configured. In tests, only the deterministic mock runs. */
export function getTextModerationProviders(): TextModerationProvider[] {
  return isTest ? [mockProvider] : [inHouseProvider, openAiProvider];
}
