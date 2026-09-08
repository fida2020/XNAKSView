import { env } from '@/config/env';
import { logger } from '@/lib/logger';

/**
 * Real HTTP client for OpenAI's documented Moderation API
 * (POST https://api.openai.com/v1/moderations, model `omni-moderation-latest`
 * — https://platform.openai.com/docs/guides/moderation). One endpoint
 * classifies BOTH text and image inputs, which is why
 * `textModerationProvider.ts` and `imageModerationProvider.ts` both call
 * this same client rather than each hand-rolling their own HTTP call.
 *
 * `isOpenAiModerationConfigured()` is the single source of truth for
 * "is a real provider actually configured" — every caller must check it
 * and refuse honestly (never fabricate a "safe" result) when it's false.
 * No request is ever sent without `OPENAI_MODERATION_API_KEY` set.
 */

const BASE_URL = 'https://api.openai.com/v1/moderations';

export function isOpenAiModerationConfigured(): boolean {
  return Boolean(env.OPENAI_MODERATION_API_KEY);
}

export type OpenAiModerationInput = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface OpenAiModerationResult {
  id: string;
  model: string;
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
}

export async function callOpenAiModeration(input: OpenAiModerationInput[]): Promise<OpenAiModerationResult> {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_MODERATION_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'omni-moderation-latest', input }),
  });
  const body = (await response.json().catch(() => ({}))) as OpenAiModerationResult & { error?: { message?: string } };
  if (!response.ok) {
    logger.error({ status: response.status, error: body.error }, 'OpenAI moderation request failed');
    throw new Error(body.error?.message ?? `OpenAI moderation request failed (HTTP ${response.status})`);
  }
  return body;
}
