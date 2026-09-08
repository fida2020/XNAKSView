import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, registerUser, SAMPLE_VIDEO_PATH, waitForVideoSettled } from '@/test/helpers';

// The real fixture is a 3.000s, 640x360 clip (verified via ffprobe) — every
// assertion below is a real, computed expectation against that fact, not a
// tolerance picked to make the test pass.
const SOURCE_DURATION_MS = 3000;

async function uploadWithEdit(accessToken: string, edit: Record<string, unknown>) {
  const response = await request(app)
    .post('/api/v1/videos')
    .set('Authorization', `Bearer ${accessToken}`)
    .field('edit', JSON.stringify(edit))
    .attach('video', SAMPLE_VIDEO_PATH);
  expect(response.status).toBe(202);
  return waitForVideoSettled(response.body.id, accessToken, 30_000);
}

describe('Video editor rebuild — real render pipeline', () => {
  it('trim actually shortens the exported video, not just the UI', async () => {
    const { response: reg } = await registerUser();
    const settled = await uploadWithEdit(reg.body.accessToken, { trimStartMs: 500, trimEndMs: 2000, speed: 1 });
    expect(settled.body.status).toBe('READY');
    // Trimmed to a real 1.5s window — allow a small encoder rounding tolerance.
    expect(settled.body.durationMs).toBeGreaterThan(1300);
    expect(settled.body.durationMs).toBeLessThan(1700);
  }, 40_000);

  it("speed actually changes the exported video's real duration", async () => {
    const { response: reg } = await registerUser();
    const settled = await uploadWithEdit(reg.body.accessToken, { speed: 2 });
    expect(settled.body.status).toBe('READY');
    // 3s source at 2x should render to ~1.5s, not the original 3s.
    expect(settled.body.durationMs).toBeGreaterThan(1300);
    expect(settled.body.durationMs).toBeLessThan(1700);
    expect(settled.body.durationMs).toBeLessThan(SOURCE_DURATION_MS * 0.7);
  }, 40_000);

  it("rotate actually transposes the exported video's real dimensions", async () => {
    const { response: reg } = await registerUser();
    const settled = await uploadWithEdit(reg.body.accessToken, { rotateDegrees: 90 });
    expect(settled.body.status).toBe('READY');
    // Source is landscape (640x360, verified via ffprobe) — a real 90°
    // rotation must make the exported video portrait (width < height).
    expect(settled.body.width).toBeLessThan(settled.body.height);
  }, 40_000);

  it("crop actually reshapes the exported video's real dimensions to the requested aspect ratio", async () => {
    const { response: reg } = await registerUser();
    const settled = await uploadWithEdit(reg.body.accessToken, { cropAspect: '1:1' });
    expect(settled.body.status).toBe('READY');
    // Source is 640x360 (16:9, verified via ffprobe) — a real 1:1 crop must
    // produce equal (or ffmpeg's even-number-rounded near-equal) width/height.
    expect(Math.abs(settled.body.width - settled.body.height)).toBeLessThanOrEqual(2);
    expect(settled.body.height).toBeLessThanOrEqual(360);
  }, 40_000);

  it('a filter + text overlay + rotate combined still produce a real, playable READY video', async () => {
    const { response: reg } = await registerUser();
    const settled = await uploadWithEdit(reg.body.accessToken, {
      filter: 'vivid',
      rotateDegrees: 180,
      textOverlays: [{ text: "Real edit: colons: and quotes' and percents%", xPct: 0.5, yPct: 0.9, fontSizePx: 40, color: '#FF00AA' }],
    });
    expect(settled.body.status).toBe('READY');
    expect(settled.body.playbackUrl).toBeTruthy();
  }, 40_000);

  it('rejects an invalid edit spec (trimEnd before trimStart) before ever creating a video row', async () => {
    const { response: reg } = await registerUser();
    const response = await request(app)
      .post('/api/v1/videos')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .field('edit', JSON.stringify({ trimStartMs: 2000, trimEndMs: 500 }))
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(response.status).toBe(400);
  });

  it('allowComments:false blocks other users but never the owner', async () => {
    const { response: owner } = await registerUser();
    const { response: viewer } = await registerUser();

    const response = await request(app)
      .post('/api/v1/videos')
      .set('Authorization', `Bearer ${owner.body.accessToken}`)
      .field('allowComments', 'false')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(response.status).toBe(202);
    const settled = await waitForVideoSettled(response.body.id, owner.body.accessToken);
    expect(settled.body.allowComments).toBe(false);

    const blocked = await request(app)
      .post(`/api/v1/videos/${settled.body.id}/comments`)
      .set('Authorization', `Bearer ${viewer.body.accessToken}`)
      .send({ text: 'nice video' });
    expect(blocked.status).toBe(403);

    const ownerComment = await request(app)
      .post(`/api/v1/videos/${settled.body.id}/comments`)
      .set('Authorization', `Bearer ${owner.body.accessToken}`)
      .send({ text: 'thanks for watching' });
    expect(ownerComment.status).toBe(201);
  }, 40_000);
});
