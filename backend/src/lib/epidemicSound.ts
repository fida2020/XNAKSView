import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { env } from '@/config/env';

/**
 * Real licensed music catalog — Epidemic Sound's Partner Content API
 * (https://partner-content-api.epidemicsound.com). A track's audio is
 * always fetched fresh per real use (a signed URL, minutes-long expiry);
 * nothing here caches or re-serves Epidemic's own audio bytes outside of
 * one real render/preview request, matching how a signed-URL partner API
 * is meant to be used.
 *
 * `EPIDEMIC_SOUND_API_KEY` is a genuine partner secret — read directly from
 * `env` at each call site, never accepted as a function parameter (so it
 * can never end up interpolated into a log line by a caller), and never
 * sent to the mobile client.
 */

const BASE_URL = 'https://partner-content-api.epidemicsound.com';

export function isEpidemicSoundConfigured(): boolean {
  return Boolean(env.EPIDEMIC_SOUND_API_KEY);
}

export interface EpidemicTrack {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  lengthSeconds: number;
  genres: string[];
  moods: string[];
  coverImageUrl: string | null;
  isExplicit: boolean;
  hasVocals: boolean;
}

export interface EpidemicTrackPage {
  tracks: EpidemicTrack[];
  nextOffset: number | null;
}

interface RawEpidemicTrack {
  id: string;
  title: string;
  mainArtists: string[];
  bpm: number;
  length: number;
  genres: { id: string; name: string }[];
  moods: { id: string; name: string }[];
  images: { M?: string; default?: string } | null;
  isExplicit: boolean;
  hasVocals: boolean;
}

interface RawEpidemicListResponse {
  tracks: RawEpidemicTrack[];
  links: { next: string | null; prev: string | null };
}

function mapTrack(raw: RawEpidemicTrack): EpidemicTrack {
  return {
    id: raw.id,
    title: raw.title,
    artist: raw.mainArtists.join(', ') || 'Unknown artist',
    bpm: raw.bpm,
    lengthSeconds: raw.length,
    genres: raw.genres.map((genre) => genre.name),
    moods: raw.moods.map((mood) => mood.name),
    coverImageUrl: raw.images?.M ?? raw.images?.default ?? null,
    isExplicit: raw.isExplicit,
    hasVocals: raw.hasVocals,
  };
}

async function epidemicFetch<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  if (!env.EPIDEMIC_SOUND_API_KEY) {
    throw new Error('Epidemic Sound is not configured (EPIDEMIC_SOUND_API_KEY is unset)');
  }
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${env.EPIDEMIC_SOUND_API_KEY}`,
      // A stable, anonymized per-deployment identifier for Epidemic's own
      // attribution/analytics — never a real user's id/name/email, per
      // their own documented guidance.
      'x-partner-user-id': 'xnakview-backend',
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Epidemic Sound API request failed: ${response.status} ${body.slice(0, 500)}`);
  }
  return (await response.json()) as T;
}

function toPage(data: RawEpidemicListResponse, offset: number, limit: number): EpidemicTrackPage {
  return { tracks: data.tracks.map(mapTrack), nextOffset: data.links.next ? offset + limit : null };
}

/** The Sound picker's "Search" tab. */
export async function searchEpidemicTracks(term: string, limit: number, offset: number): Promise<EpidemicTrackPage> {
  const data = await epidemicFetch<RawEpidemicListResponse>('/v0/tracks/search', { term, limit, offset });
  return toPage(data, offset, limit);
}

/**
 * The Sound picker's "Browse" tab — the catalog's default listing order.
 * Disclosed honestly as "Browse", not "Trending": the Partner API's
 * `/v0/tracks` list endpoint has no verified, documented popularity sort
 * parameter, so this is the catalog in its default order, not a real
 * trending/popularity ranking.
 */
export async function browseEpidemicTracks(limit: number, offset: number): Promise<EpidemicTrackPage> {
  const data = await epidemicFetch<RawEpidemicListResponse>('/v0/tracks', { limit, offset });
  return toPage(data, offset, limit);
}

/** A real, time-limited signed preview stream URL (HLS) — for playback preview inside the picker, never persisted. */
export async function getEpidemicPreviewUrl(trackId: string): Promise<{ url: string; expires: string }> {
  return epidemicFetch(`/v0/tracks/${trackId}/stream`);
}

/**
 * Downloads the real, licensed audio file for server-side mixing into a
 * video (see lib/videoProcessing.ts) — a fresh signed download URL is
 * requested per call and the bytes are written straight to `destinationPath`;
 * nothing here retains Epidemic's own signed URL or re-serves it.
 */
export async function downloadEpidemicTrack(trackId: string, destinationPath: string): Promise<void> {
  const { url } = await epidemicFetch<{ url: string; expires: string }>(`/v0/tracks/${trackId}/download`, {
    format: 'mp3',
    quality: 'normal',
  });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Epidemic Sound track ${trackId}: ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destinationPath));
}
