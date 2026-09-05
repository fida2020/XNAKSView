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
