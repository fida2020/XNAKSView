import { spawn } from 'child_process';

import { env } from '@/config/env';

interface CommandResult {
  stdout: string;
  stderr: string;
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      // e.g. ENOENT — the binary isn't installed / not on PATH.
      reject(new Error(`Failed to launch "${command}": ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`"${command}" exited with code ${code}: ${stderr.slice(-1000)}`));
      }
    });
  });
}

export interface VideoProbeResult {
  durationMs: number;
  width: number;
  height: number;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

/** Extracts real metadata from the file and validates it actually contains a video stream. */
export async function probeVideo(filePath: string): Promise<VideoProbeResult> {
  const { stdout } = await runCommand(env.FFPROBE_PATH, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  let data: FfprobeOutput;
  try {
    data = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    throw new Error('ffprobe returned unparseable output — file is likely not a valid media file');
  }

  const videoStream = (data.streams ?? []).find((stream) => stream.codec_type === 'video');
  if (!videoStream || !videoStream.width || !videoStream.height) {
    throw new Error('No video stream found in uploaded file');
  }

  const durationSeconds = parseFloat(data.format?.duration ?? videoStream.duration ?? '0');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Could not determine video duration');
  }

  return {
    durationMs: Math.round(durationSeconds * 1000),
    width: videoStream.width,
    height: videoStream.height,
  };
}

export interface AudioProbeResult {
  durationMs: number;
}

/** Same real-decode validation `probeVideo` does, scoped to audio — confirms an actual audio stream exists and extracts its real duration (never the client's claimed value). */
export async function probeAudio(filePath: string): Promise<AudioProbeResult> {
  const { stdout } = await runCommand(env.FFPROBE_PATH, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  let data: FfprobeOutput;
  try {
    data = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    throw new Error('ffprobe returned unparseable output — file is likely not a valid media file');
  }

  const audioStream = (data.streams ?? []).find((stream) => stream.codec_type === 'audio');
  if (!audioStream) {
    throw new Error('No audio stream found in uploaded file');
  }

  const durationSeconds = parseFloat(data.format?.duration ?? audioStream.duration ?? '0');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Could not determine audio duration');
  }

  return { durationMs: Math.round(durationSeconds * 1000) };
}

/** Captures a single real frame from the video — never a placeholder image. */
export async function generateThumbnail(inputPath: string, outputPath: string, atSeconds: number): Promise<void> {
  await runCommand(env.FFMPEG_PATH, [
    '-y',
    '-ss',
    atSeconds.toFixed(3),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    outputPath,
  ]);
}

/**
 * Real H.264/AAC transcode to a web-playable, faststart MP4 — not a copy of
 * the original. `-profile:v high -level 4.1 -pix_fmt yuv420p` is mandatory,
 * not cosmetic: without an explicit pixel format, libx264 preserves
 * whatever chroma subsampling the source has, and for some sources
 * (screen recordings, certain camera exports, ffmpeg-generated test
 * fixtures) that yields High 4:4:4 Predictive profile output — a real H.264
 * profile almost no phone's HARDWARE decoder supports (confirmed via a real
 * physical-device MediaCodec failure: "Codec driver not support the file",
 * MediaCodecVideoDecoderException). Forcing yuv420p + a capped
 * baseline-compatible level guarantees standard 4:2:0 8-bit output every
 * hardware decoder in the field can play.
 */
export async function transcodeToPlaybackMp4(inputPath: string, outputPath: string): Promise<void> {
  await runCommand(env.FFMPEG_PATH, [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-vf',
    "scale='min(1080,iw)':-2",
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

// ---------------------------------------------------------------------------
// Video editor rebuild — real trim/speed/filter/text/rotate/added-audio
// render, replacing the old "upload the raw file as-is" pipeline for the
// normal Post flow. Duet/Stitch/Add Yours keep their own existing
// composite pipelines above, untouched.
// ---------------------------------------------------------------------------

export interface TextOverlaySpec {
  text: string;
  /** Center point of the text, as a fraction (0-1) of the frame's width/height. */
  xPct: number;
  yPct: number;
  fontSizePx: number;
  /** '#RRGGBB' — validated by videoEditSpecSchema before this is ever called. */
  color: string;
}

export interface VideoEditSpec {
  trimStartMs?: number;
  trimEndMs?: number;
  speed: number;
  filter: 'none' | 'mono' | 'warm' | 'cool' | 'vivid' | 'fade';
  rotateDegrees: 0 | 90 | 180 | 270;
  /** A real center-crop to the given aspect ratio — 'original' applies no crop. */
  cropAspect: 'original' | '1:1' | '9:16' | '16:9';
  textOverlays: TextOverlaySpec[];
  /** 0-1 — the original clip's own audio. */
  originalVolume: number;
  /** 0-1 — only meaningful when a Sound is attached; read by videoProcessing.ts to build the extra-audio mix, not by renderEditedVideo itself (volume is applied per ExtraAudioInput). */
  soundVolume?: number;
  /** 0-1 — only meaningful when a voice-over was recorded; same as soundVolume above. */
  voiceoverVolume?: number;
  coverAtMs?: number;
}

/** One extra real audio track (an attached Sound's source audio, or a recorded voice-over) mixed into the final render at its own volume. */
export interface ExtraAudioInput {
  path: string;
  volume: number;
}

const FILTER_PRESETS: Record<VideoEditSpec['filter'], string | null> = {
  none: null,
  // Desaturate completely — a real, visible grayscale grade, not a cosmetic label.
  mono: 'hue=s=0',
  warm: 'colorbalance=rs=0.18:gs=0.04:bs=-0.18:rm=0.10:bm=-0.10:hs=0.10:hm=0.05',
  cool: 'colorbalance=rs=-0.18:bs=0.18:rm=-0.10:bm=0.10:hs=-0.05:hm=-0.05',
  vivid: 'eq=saturation=1.6:contrast=1.12',
  fade: 'eq=saturation=0.55:brightness=0.06:contrast=0.88',
};

const CROP_ASPECT_RATIOS: Record<Exclude<VideoEditSpec['cropAspect'], 'original'>, number> = {
  '1:1': 1,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
};

/** A real center-crop to the target aspect ratio, computed against the source's actual decoded dimensions — never a client-claimed size. */
function buildCropFilter(cropAspect: VideoEditSpec['cropAspect'], sourceWidth: number, sourceHeight: number): string | null {
  if (cropAspect === 'original') return null;
  const targetRatio = CROP_ASPECT_RATIOS[cropAspect];
  const sourceRatio = sourceWidth / sourceHeight;

  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  if (sourceRatio > targetRatio) {
    // Source is wider than the target — crop the sides in.
    cropWidth = Math.round(sourceHeight * targetRatio);
  } else {
    // Source is taller than the target — crop the top/bottom in.
    cropHeight = Math.round(sourceWidth / targetRatio);
  }
  // ffmpeg's crop filter wants even dimensions for yuv420p output.
  cropWidth -= cropWidth % 2;
  cropHeight -= cropHeight % 2;
  return `crop=${cropWidth}:${cropHeight}:(iw-${cropWidth})/2:(ih-${cropHeight})/2`;
}

const ROTATE_FILTERS: Record<VideoEditSpec['rotateDegrees'], string | null> = {
  0: null,
  90: 'transpose=1',
  180: 'transpose=1,transpose=1',
  270: 'transpose=2',
};

/**
 * Escapes text for safe use inside an ffmpeg filtergraph `drawtext=text='...'`
 * value. `spawn` passes args to the OS directly (no shell), so this only has
 * to satisfy ffmpeg's OWN filtergraph parser, not shell quoting — but that
 * parser is still real and unforgiving: an unescaped `:` or `\` in
 * user-supplied caption text would otherwise break filter parsing (at best)
 * or reinterpret part of the caption as a different drawtext option (at
 * worst). Two characters are substituted rather than escaped, both
 * deliberate, disclosed simplifications verified against this ffmpeg build
 * (9.0.1): apostrophes become the visually-identical U+2019 (ffmpeg's own
 * rules for a literal `'` inside a `'`-quoted value are a genuine mess to
 * get right), and `%` becomes the visually-similar full-width U+FF05 —
 * drawtext runs its OWN strftime-style expansion over the text AFTER the
 * filtergraph layer unescapes it, so neither a bare `%` nor a filtergraph-
 * escaped `\%` nor drawtext's documented `%%` survives as a literal percent
 * (confirmed empirically: all three produce "Stray % near ..." and fail
 * the whole encode) — there is no working escape sequence for it in this
 * ffmpeg build, only a substitute character.
 */
export function escapeDrawtextValue(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/%/g, '％')
    .replace(/'/g, '’');
}

/** Same filtergraph escaping, for a plain (unquoted) option value like a font file path — Windows drive-letter colons are exactly as special to ffmpeg as any other `:`. */
function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function hexColorToFfmpeg(hex: string): string {
  return `0x${hex.replace('#', '')}`;
}

function buildDrawtextFilter(overlay: TextOverlaySpec, fontPath: string): string {
  const x = `(w*${overlay.xPct.toFixed(4)})-(text_w/2)`;
  const y = `(h*${overlay.yPct.toFixed(4)})-(text_h/2)`;
  return (
    `drawtext=fontfile='${escapeFilterPath(fontPath)}':text='${escapeDrawtextValue(overlay.text)}':` +
    `x=${x}:y=${y}:fontsize=${overlay.fontSizePx}:fontcolor=${hexColorToFfmpeg(overlay.color)}:` +
    'borderw=2:bordercolor=0x000000@0.6'
  );
}

/**
 * ffmpeg's `atempo` filter only accepts a single-instance range of
 * [0.5, 2.0]; reaching a speed outside that range means chaining multiple
 * instances whose product is the target factor — a standard, documented
 * ffmpeg technique (not specific to this codebase), used here so the audio
 * stays in sync with a `setpts`-sped-up video at any of the app's offered
 * speeds (0.3x-3x) without needing to know the source's sample rate.
 */
function buildAtempoChain(speed: number): string {
  const factors: number[] = [];
  let remaining = speed;
  while (remaining > 2) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(remaining);
  return factors.map((f) => `atempo=${f.toFixed(6)}`).join(',');
}

/**
 * Renders a video through the real editor pipeline: trim, speed (video +
 * pitch-preserving audio time-stretch, kept in sync), rotate, a named color
 * grade, burned-in text overlays, and a real audio mix of the original clip
 * plus any extra tracks (an attached Sound's source audio, a recorded
 * voice-over) at their own volumes. Every operation here actually alters
 * the encoded output — there is no "edit" that's UI-only.
 */
export async function renderEditedVideo(
  inputPath: string,
  spec: VideoEditSpec,
  extraAudio: ExtraAudioInput[],
  outputPath: string,
  fontPath: string,
): Promise<void> {
  const probe = await probeVideo(inputPath);
  const trimStartMs = spec.trimStartMs ?? 0;
  const trimEndMs = Math.min(spec.trimEndMs ?? probe.durationMs, probe.durationMs);
  const trimStartS = (trimStartMs / 1000).toFixed(3);
  const trimEndS = (trimEndMs / 1000).toFixed(3);
  const finalDurationS = Math.max(0.01, (trimEndMs - trimStartMs) / 1000 / spec.speed);

  const videoSteps: string[] = [`trim=start=${trimStartS}:end=${trimEndS}`, 'setpts=PTS-STARTPTS'];
  const cropFilter = buildCropFilter(spec.cropAspect, probe.width, probe.height);
  if (cropFilter) videoSteps.push(cropFilter);
  const rotateFilter = ROTATE_FILTERS[spec.rotateDegrees];
  if (rotateFilter) videoSteps.push(rotateFilter);
  const presetFilter = FILTER_PRESETS[spec.filter];
  if (presetFilter) videoSteps.push(presetFilter);
  for (const overlay of spec.textOverlays) {
    videoSteps.push(buildDrawtextFilter(overlay, fontPath));
  }
  videoSteps.push("scale='min(1080,iw)':-2");
  videoSteps.push(`setpts=PTS/${spec.speed.toFixed(6)}`);

  const filterParts: string[] = [`[0:v]${videoSteps.join(',')}[v]`];

  filterParts.push(
    `[0:a]atrim=start=${trimStartS}:end=${trimEndS},asetpts=PTS-STARTPTS,${buildAtempoChain(spec.speed)},volume=${spec.originalVolume.toFixed(3)}[a0]`,
  );

  const audioLabels = ['[a0]'];
  extraAudio.forEach((extra, index) => {
    const inputIndex = index + 1; // input 0 is the video
    const label = `[a${inputIndex}]`;
    filterParts.push(
      `[${inputIndex}:a]atrim=0:${finalDurationS.toFixed(3)},apad=whole_dur=${finalDurationS.toFixed(3)},volume=${extra.volume.toFixed(3)}${label}`,
    );
    audioLabels.push(label);
  });

  let finalAudioLabel = '[a0]';
  if (audioLabels.length > 1) {
    filterParts.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0[aout]`);
    finalAudioLabel = '[aout]';
  }

  const args = ['-y', '-i', inputPath, ...extraAudio.flatMap((extra) => ['-i', extra.path])];
  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[v]',
    '-map',
    finalAudioLabel,
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  );

  await runCommand(env.FFMPEG_PATH, args);
}

/**
 * Duet (brief E): current TikTok behavior composites the source video and
 * the new recording side by side into a single output video, not two
 * separately-playable tracks. Both sides are scaled to the same height
 * (source's, capped at 1080) before being stacked horizontally; both
 * audio tracks are mixed rather than dropping one, since current TikTok
 * duets carry sound from both sides unless a participant explicitly mutes
 * their side (no such per-side mute control exists yet — a reasonable,
 * disclosed simplification). This is a generic ffmpeg filter graph, not
 * anything copied from TikTok's own (proprietary, unavailable) compositor.
 */
export async function compositeDuetSideBySide(sourcePath: string, newPath: string, outputPath: string): Promise<void> {
  const filter =
    "[0:v]scale=-2:'min(1080,ih)',setsar=1[left];" +
    "[1:v]scale=-2:'min(1080,ih)',setsar=1[right];" +
    '[left][right]hstack=inputs=2[v];' +
    '[0:a][1:a]amix=inputs=2:duration=shortest:dropout_transition=0[a]';
  await runCommand(env.FFMPEG_PATH, [
    '-y',
    '-i',
    sourcePath,
    '-i',
    newPath,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    // See transcodeToPlaybackMp4's doc comment — same mandatory hardware-
    // decoder-compatibility fix applies to every libx264 encode in this file.
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

/**
 * Stitch (brief F): current TikTok behavior lets the creator trim/select
 * which up-to-5-second segment of the source plays, then cuts to the new
 * recording full-screen — a concatenation, not a side-by-side composite.
 * `startMs`/`endMs` are already server-validated (never trusted from the
 * client beyond that validation) by the time this runs.
 */
export async function compositeStitchConcat(
  sourcePath: string,
  startMs: number,
  endMs: number,
  newPath: string,
  outputPath: string,
): Promise<void> {
  const startSeconds = (startMs / 1000).toFixed(3);
  const endSeconds = (endMs / 1000).toFixed(3);
  const filter =
    `[0:v]trim=start=${startSeconds}:end=${endSeconds},setpts=PTS-STARTPTS,scale='min(1080,iw)':-2[v0];` +
    `[0:a]atrim=start=${startSeconds}:end=${endSeconds},asetpts=PTS-STARTPTS[a0];` +
    "[1:v]scale='min(1080,iw)':-2,setpts=PTS-STARTPTS[v1];" +
    '[1:a]asetpts=PTS-STARTPTS[a1];' +
    '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]';
  await runCommand(env.FFMPEG_PATH, [
    '-y',
    '-i',
    sourcePath,
    '-i',
    newPath,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    // See transcodeToPlaybackMp4's doc comment — same mandatory hardware-
    // decoder-compatibility fix applies to every libx264 encode in this file.
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}
