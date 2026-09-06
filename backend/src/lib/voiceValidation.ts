import { open } from 'fs/promises';

import { probeAudio } from '@/lib/ffmpeg';

const SIGNATURES: { mimeType: string; check: (buf: Buffer) => boolean }[] = [
  // WAV: "RIFF"...."WAVE"
  { mimeType: 'audio/wav', check: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE' },
  // OGG (Opus/Vorbis container)
  { mimeType: 'audio/ogg', check: (b) => b.subarray(0, 4).toString('ascii') === 'OggS' },
  // MP3 with an ID3 tag
  { mimeType: 'audio/mpeg', check: (b) => b.subarray(0, 3).toString('ascii') === 'ID3' },
  // MP3 raw frame sync (11 set bits, then a valid MPEG version/layer nibble)
  { mimeType: 'audio/mpeg', check: (b) => b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0 },
  // M4A/AAC (ISO base media / MPEG-4 container): bytes 4-7 == "ftyp"
  { mimeType: 'audio/mp4', check: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' },
  // WebM/Matroska (EBML header) — what some Flutter recorders produce on web
  { mimeType: 'audio/webm', check: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
];

/**
 * Real validation, not a mimetype/extension check: reads the file's actual
 * magic bytes to confirm it's one of a known-good audio container. Mirrors
 * `probeImage`'s approach for LIVE thumbnails — never trust the client's
 * claimed content type for what gets written to disk and later served back.
 */
export async function probeAudioContainer(filePath: string): Promise<{ mimeType: string }> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    await handle.read(buffer, 0, 16, 0);
    const match = SIGNATURES.find(({ check }) => check(buffer));
    if (!match) {
      throw new Error('File is not a recognized audio format');
    }
    return { mimeType: match.mimeType };
  } finally {
    await handle.close();
  }
}

export interface VoiceValidationResult {
  mimeType: string;
  durationMs: number;
}

/**
 * Full voice-message validation: magic bytes AND a real decode (ffprobe)
 * that confirms an audio stream actually exists and extracts its real
 * duration. Either check alone is spoofable/incomplete; together they're
 * the same "don't trust the client" posture `probeVideo` applies to videos.
 */
export async function validateVoiceMessage(filePath: string, maxDurationMs: number): Promise<VoiceValidationResult> {
  const { mimeType } = await probeAudioContainer(filePath);
  const { durationMs } = await probeAudio(filePath);
  if (durationMs > maxDurationMs) {
    throw new Error(`Voice message exceeds the maximum duration of ${Math.round(maxDurationMs / 1000)} seconds`);
  }
  return { mimeType, durationMs };
}
