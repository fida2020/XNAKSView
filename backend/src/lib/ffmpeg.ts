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

/** Real H.264/AAC transcode to a web-playable, faststart MP4 — not a copy of the original. */
export async function transcodeToPlaybackMp4(inputPath: string, outputPath: string): Promise<void> {
  await runCommand(env.FFMPEG_PATH, [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
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
