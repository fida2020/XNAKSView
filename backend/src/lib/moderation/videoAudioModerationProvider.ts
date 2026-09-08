import { randomUUID } from 'crypto';

import { isTest } from '@/config/env';
import type { AudioModerationProvider, ContentAnalysisResult, ProviderResult, VideoModerationProvider } from '@/lib/moderation/types';

/**
 * Real video/audio AI moderation vendors (sampled-frame video analysis,
 * speech-to-text + text-classification for audio) are NOT wired up in this
 * codebase — no credentials for one exist in this environment, and this
 * codebase never fabricates a moderation result for an unconfigured
 * provider (brief §12: "Never return fake 'safe' just because a provider
 * is missing"). The interfaces below are real and already used by
 * `moderationPipeline.ts`'s `moderateVideo`/`moderateAudio` entry points —
 * wiring a real vendor here (e.g. sampled frames through the same
 * `imageModerationProvider.ts` OpenAI adapter, or a transcription vendor
 * feeding `textModerationProvider.ts`) is a drop-in addition once one is
 * configured, not an architecture change. See the Step 10 completion
 * report's "what requires production credentials" section.
 */
class UnconfiguredVideoModerationProvider implements VideoModerationProvider {
  readonly name = 'NONE';

  isConfigured(): boolean {
    return false;
  }

  async analyzeVideo(): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>> {
    return { configured: false, reason: 'Video moderation is not configured on this server — no video AI vendor is set up' };
  }
}

class UnconfiguredAudioModerationProvider implements AudioModerationProvider {
  readonly name = 'NONE';

  isConfigured(): boolean {
    return false;
  }

  async analyzeAudio(): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>> {
    return { configured: false, reason: 'Audio moderation is not configured on this server — no audio AI vendor is set up' };
  }
}

/** Deterministic test double. Trigger via a marker in `videoStorageKey`: "SIMULATE_GRAPHIC" -> GRAPHIC_CONTENT 0.9; anything else -> ALLOW. */
class MockVideoModerationProvider implements VideoModerationProvider {
  readonly name = 'MOCK';
  isConfigured(): boolean {
    return true;
  }
  async analyzeVideo(input: { videoStorageKey: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>> {
    const providerRequestId = `mock-mod-${randomUUID()}`;
    if (input.videoStorageKey.includes('SIMULATE_GRAPHIC')) {
      return { configured: true, providerRequestId, result: { categoryScores: [{ category: 'GRAPHIC_CONTENT', confidence: 0.9 }] } };
    }
    return { configured: true, providerRequestId, result: { categoryScores: [] } };
  }
}

/** Deterministic test double. Trigger via a marker in `audioStorageKey`: "SIMULATE_SEVERE_ABUSE" -> HATE_HARASSMENT+THREATS 0.97 (mirrors the text mock); anything else -> ALLOW. */
class MockAudioModerationProvider implements AudioModerationProvider {
  readonly name = 'MOCK';
  isConfigured(): boolean {
    return true;
  }
  async analyzeAudio(input: { audioStorageKey: string }): Promise<ProviderResult<{ result: ContentAnalysisResult; providerRequestId?: string }>> {
    const providerRequestId = `mock-mod-${randomUUID()}`;
    if (input.audioStorageKey.includes('SIMULATE_SEVERE_ABUSE')) {
      return {
        configured: true,
        providerRequestId,
        result: { categoryScores: [{ category: 'HATE_HARASSMENT', confidence: 0.97 }, { category: 'THREATS', confidence: 0.96 }] },
      };
    }
    return { configured: true, providerRequestId, result: { categoryScores: [] } };
  }
}

const unconfiguredVideoProvider = new UnconfiguredVideoModerationProvider();
const unconfiguredAudioProvider = new UnconfiguredAudioModerationProvider();
const mockVideoProvider = new MockVideoModerationProvider();
const mockAudioProvider = new MockAudioModerationProvider();

export function getVideoModerationProvider(): VideoModerationProvider {
  return isTest ? mockVideoProvider : unconfiguredVideoProvider;
}

export function getAudioModerationProvider(): AudioModerationProvider {
  return isTest ? mockAudioProvider : unconfiguredAudioProvider;
}
