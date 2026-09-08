import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { isEpidemicSoundConfigured } from '@/lib/epidemicSound';
import { app, registerUser, SAMPLE_VIDEO_PATH, waitForVideoSettled } from '@/test/helpers';

/**
 * Real licensed music catalog (Epidemic Sound Partner Content API) — every
 * test here hits the REAL partner API with the real configured key (no
 * mocks, matching this codebase's whole testing philosophy), so this suite
 * is skipped rather than faked when no real key is configured (e.g. a CI
 * environment without the partner credential) — see isEpidemicSoundConfigured.
 */
describe.runIf(isEpidemicSoundConfigured())('Epidemic Sound — real licensed catalog', () => {
  it('browses the real catalog and returns real track metadata', async () => {
    const { response: reg } = await registerUser();
    const response = await request(app).get('/api/v1/epidemic-sounds/browse?limit=3').set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.tracks.length).toBeGreaterThan(0);
    const track = response.body.tracks[0];
    expect(typeof track.id).toBe('string');
    expect(typeof track.title).toBe('string');
    expect(typeof track.artist).toBe('string');
    expect(typeof track.lengthSeconds).toBe('number');
    expect(track.lengthSeconds).toBeGreaterThan(0);
  });

  it('searches the real catalog by term', async () => {
    const { response: reg } = await registerUser();
    const response = await request(app)
      .get('/api/v1/epidemic-sounds/search?term=summer&limit=3')
      .set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.tracks.length).toBeGreaterThan(0);
  });

  it('returns a real, playable signed preview URL for a real track', async () => {
    const { response: reg } = await registerUser();
    const browse = await request(app).get('/api/v1/epidemic-sounds/browse?limit=1').set('Authorization', `Bearer ${reg.body.accessToken}`);
    const trackId = browse.body.tracks[0].id;
    const preview = await request(app).get(`/api/v1/epidemic-sounds/${trackId}/preview`).set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.url).toMatch(/^https:\/\//);
  });

  it('favorite / unfavorite round-trips through the real database', async () => {
    const { response: reg } = await registerUser();
    const browse = await request(app).get('/api/v1/epidemic-sounds/browse?limit=1').set('Authorization', `Bearer ${reg.body.accessToken}`);
    const track = browse.body.tracks[0];

    const favorited = await request(app)
      .post(`/api/v1/epidemic-sounds/${track.id}/favorite`)
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ trackTitle: track.title, trackArtist: track.artist });
    expect(favorited.status).toBe(201);

    const list = await request(app).get('/api/v1/epidemic-sounds/favorites').set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(list.body.tracks.some((t: { id: string }) => t.id === track.id)).toBe(true);

    const unfavorited = await request(app).delete(`/api/v1/epidemic-sounds/${track.id}/favorite`).set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(unfavorited.status).toBe(200);

    const listAfter = await request(app).get('/api/v1/epidemic-sounds/favorites').set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(listAfter.body.tracks.some((t: { id: string }) => t.id === track.id)).toBe(false);
  });

  it('rejects a post that tries to attach both a reused Sound and an Epidemic track', async () => {
    const { response: reg } = await registerUser();
    const response = await request(app)
      .post('/api/v1/videos')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .field('soundId', '00000000-0000-0000-0000-000000000000')
      .field('epidemicTrackId', '00000000-0000-0000-0000-000000000001')
      .attach('video', SAMPLE_VIDEO_PATH);
    // Zod validation failures (the createVideoSchema refine) surface as 422
    // via the validate middleware, not 400 — matching every other schema
    // validation failure in this codebase.
    expect(response.status).toBe(422);
  });

  it('a real Epidemic track attached to a post is really downloaded and mixed in, and recorded as a real Recent', async () => {
    const { response: reg } = await registerUser();
    const browse = await request(app).get('/api/v1/epidemic-sounds/browse?limit=1').set('Authorization', `Bearer ${reg.body.accessToken}`);
    const track = browse.body.tracks[0];

    const upload = await request(app)
      .post('/api/v1/videos')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .field('epidemicTrackId', track.id)
      .field('epidemicTrackTitle', track.title)
      .field('epidemicTrackArtist', track.artist)
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(upload.status).toBe(202);

    const settled = await waitForVideoSettled(upload.body.id, reg.body.accessToken, 40_000);
    expect(settled.body.status).toBe('READY');
    // Real audio mixing must never change the video's own real duration
    // (the source fixture is 3.000s, verified via ffprobe).
    expect(settled.body.durationMs).toBeGreaterThan(2700);
    expect(settled.body.durationMs).toBeLessThan(3300);

    const recent = await request(app).get('/api/v1/epidemic-sounds/recent').set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(recent.body.tracks.some((t: { id: string }) => t.id === track.id)).toBe(true);
  }, 60_000);
});
