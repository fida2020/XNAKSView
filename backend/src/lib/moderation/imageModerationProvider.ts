import { randomUUID } from 'crypto';

import { isTest } from '@/config/env';
import { mapOpenAiCategoryScores } from '@/lib/moderation/textModerationProvider';
import { callOpenAiModeration, isOpenAiModerationConfigured } from '@/lib/moderation/openAiModerationClient';
import type { ContentAnalysisResult, ImageModerationProvider, ProviderResult } from '@/lib/moderation/types';

/** Real vendor adapter — same OpenAI Moderation API as text (`omni-moderation-latest` accepts `image_url` content parts in the same call shape). `isConfigured()` is false until `OPENAI_MODERATION_API_KEY` is set — never a fabricated "safe" image result. */
class OpenAiImageModerationProvider implements ImageModerationProvider {
  readonly name = 'OPENAI';

  isConfigured(): boolean {
    return isOpenAiModerationConfigured();
  }

  async analyzeImage(input: { imageUrl: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>> {
    if (!this.isConfigured()) {
      return { configured: false, reason: 'Image moderation vendor is not configured on this server (set OPENAI_MODERATION_API_KEY)' };
    }
    const response = await callOpenAiModeration([{ type: 'image_url', image_url: { url: input.imageUrl } }]);
    const first = response.results[0];
    const categoryScores = first ? mapOpenAiCategoryScores(first.category_scores) : [];
    return { configured: true, result: { categoryScores }, providerRequestId: response.id };
  }
}

/**
 * Deterministic test double, `NODE_ENV=test` only. Trigger a specific
 * outcome via a marker anywhere in `imageUrl`:
 *   - "SIMULATE_NUDITY"     -> SEXUAL_NUDITY, confidence 0.95
 *   - "SIMULATE_GRAPHIC"    -> GRAPHIC_CONTENT, confidence 0.9
 *   - anything else         -> no categories (ALLOW)
 */
class MockImageModerationProvider implements ImageModerationProvider {
  readonly name = 'MOCK';

  isConfigured(): boolean {
    return true;
  }

  async analyzeImage(input: { imageUrl: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>> {
    const providerRequestId = `mock-mod-${randomUUID()}`;
    if (input.imageUrl.includes('SIMULATE_NUDITY')) {
      return { configured: true, providerRequestId, result: { categoryScores: [{ category: 'SEXUAL_NUDITY', confidence: 0.95 }] } };
    }
    if (input.imageUrl.includes('SIMULATE_GRAPHIC')) {
      return { configured: true, providerRequestId, result: { categoryScores: [{ category: 'GRAPHIC_CONTENT', confidence: 0.9 }] } };
    }
    return { configured: true, providerRequestId, result: { categoryScores: [] } };
  }
}

const openAiProvider = new OpenAiImageModerationProvider();
const mockProvider = new MockImageModerationProvider();

export function getImageModerationProviders(): ImageModerationProvider[] {
  return isTest ? [mockProvider] : [openAiProvider];
}
