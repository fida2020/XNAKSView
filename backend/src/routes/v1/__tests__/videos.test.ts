import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  app,
  NOT_A_VIDEO_PATH,
  registerUser,
  SAMPLE_VIDEO_PATH,
  uploadSampleVideo,
  waitForVideoSettled,
} from '@/test/helpers';

describe('POST /api/v1/videos (upload)', () => {
  it('requires authentication', async () => {
    // Deliberately no file attached: requireAuth runs before multer even
    // starts reading the body, so this only needs to prove auth is
    // enforced — attaching a real upload body here would conflate this
    // with the (separate, real) race of rejecting a request while a large
    // multipart body is still streaming in.
    const response = await request(app).post('/api/v1/videos');
    expect(response.status).toBe(401);
  });

  it('rejects a request with no file', async () => {
    const { response: registerResponse } = await registerUser();
    const response = await request(app)
      .post('/api/v1/videos')
      .set('Authorization', `Bearer ${registerResponse.body.accessToken}`);
    expect(response.status).toBe(400);
  });

  it('rejects an invalid (non-video) file', async () => {
    const { response: registerResponse } = await registerUser();
    const response = await request(app)
      .post('/api/v1/videos')
      .set('Authorization', `Bearer ${registerResponse.body.accessToken}`)
      .attach('video', NOT_A_VIDEO_PATH);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });

  it('accepts a valid video, processes it for real, and reaches READY with real metadata', async () => {
    const { response: registerResponse } = await registerUser();
    const accessToken = registerResponse.body.accessToken;

    const uploadResponse = await uploadSampleVideo(accessToken, { caption: 'My first video' });
    expect(uploadResponse.status).toBe(202);
    expect(uploadResponse.body.status).toBe('PROCESSING');
    expect(uploadResponse.body.playbackUrl).toBeNull();

    const settled = await waitForVideoSettled(uploadResponse.body.id, accessToken);
    expect(settled.body.status).toBe('READY');
    expect(settled.body.durationMs).toBe(3000);
    expect(settled.body.width).toBe(640);
    expect(settled.body.height).toBe(360);
    expect(settled.body.playbackUrl).toBe(`/api/v1/videos/${uploadResponse.body.id}/file`);
    expect(settled.body.thumbnailUrl).toBe(`/api/v1/videos/${uploadResponse.body.id}/thumbnail`);

    // The playback file and thumbnail are real, fetchable, non-empty assets.
    const fileResponse = await request(app)
      .get(settled.body.playbackUrl)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers['content-type']).toBe('video/mp4');
    expect(Number(fileResponse.headers['content-length'])).toBeGreaterThan(0);

    const thumbResponse = await request(app)
      .get(settled.body.thumbnailUrl)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(thumbResponse.status).toBe(200);
    expect(thumbResponse.headers['content-type']).toBe('image/jpeg');

    // Range requests (needed for real video scrubbing/seeking) work.
    const rangeResponse = await request(app)
      .get(settled.body.playbackUrl)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Range', 'bytes=0-999');
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers['content-range']).toMatch(/^bytes 0-999\//);
  });

  it('never trusts a client-supplied owner id', async () => {
    const { response: registerResponse } = await registerUser();
    const { response: otherRegisterResponse } = await registerUser();

    const uploadResponse = await request(app)
      .post('/api/v1/videos')
      .set('Authorization', `Bearer ${registerResponse.body.accessToken}`)
      .field('userId', otherRegisterResponse.body.user.id)
      .attach('video', SAMPLE_VIDEO_PATH);

    expect(uploadResponse.status).toBe(202);
    expect(uploadResponse.body.userId).toBe(registerResponse.body.user.id);
    expect(uploadResponse.body.userId).not.toBe(otherRegisterResponse.body.user.id);
  });
});

describe('GET/DELETE /api/v1/videos/:id (ownership & visibility)', () => {
  it('returns a video to its owner even before it is public/ready', async () => {
    const { response: registerResponse } = await registerUser();
    const accessToken = registerResponse.body.accessToken;
    const uploadResponse = await uploadSampleVideo(accessToken, { visibility: 'PRIVATE' });

    const response = await request(app)
      .get(`/api/v1/videos/${uploadResponse.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(200);
  });

  it('hides a private video from other users (404, not 403 — no existence leak)', async () => {
    const { response: registerResponse } = await registerUser();
    const accessToken = registerResponse.body.accessToken;
    const uploadResponse = await uploadSampleVideo(accessToken, { visibility: 'PRIVATE' });
    await waitForVideoSettled(uploadResponse.body.id, accessToken);

    const { response: otherRegisterResponse } = await registerUser();
    const response = await request(app)
      .get(`/api/v1/videos/${uploadResponse.body.id}`)
      .set('Authorization', `Bearer ${otherRegisterResponse.body.accessToken}`);
    expect(response.status).toBe(404);
  });

  it('shows a public, ready video to any authenticated user', async () => {
    const { response: registerResponse } = await registerUser();
    const accessToken = registerResponse.body.accessToken;
    const uploadResponse = await uploadSampleVideo(accessToken, { visibility: 'PUBLIC' });
    await waitForVideoSettled(uploadResponse.body.id, accessToken);

    const { response: otherRegisterResponse } = await registerUser();
    const response = await request(app)
      .get(`/api/v1/videos/${uploadResponse.body.id}`)
      .set('Authorization', `Bearer ${otherRegisterResponse.body.accessToken}`);
    expect(response.status).toBe(200);
  });

  it('rejects deleting another user\'s video', async () => {
    const { response: registerResponse } = await registerUser();
    const uploadResponse = await uploadSampleVideo(registerResponse.body.accessToken);

    const { response: otherRegisterResponse } = await registerUser();
    const response = await request(app)
      .delete(`/api/v1/videos/${uploadResponse.body.id}`)
      .set('Authorization', `Bearer ${otherRegisterResponse.body.accessToken}`);
    expect(response.status).toBe(403);
  });

  it('lets the owner delete their own video, after which it is gone (404)', async () => {
    const { response: registerResponse } = await registerUser();
    const accessToken = registerResponse.body.accessToken;
    const uploadResponse = await uploadSampleVideo(accessToken);

    const deleteResponse = await request(app)
      .delete(`/api/v1/videos/${uploadResponse.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(deleteResponse.status).toBe(204);

    const getResponse = await request(app)
      .get(`/api/v1/videos/${uploadResponse.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(getResponse.status).toBe(404);
  });
});

describe('Likes', () => {
  let accessToken: string;
  let videoId: string;

  beforeAll(async () => {
    const { response: registerResponse } = await registerUser();
    accessToken = registerResponse.body.accessToken;
    const uploadResponse = await uploadSampleVideo(accessToken);
    await waitForVideoSettled(uploadResponse.body.id, accessToken);
    videoId = uploadResponse.body.id;
  });

  it('likes a video and increments likeCount', async () => {
    const response = await request(app)
      .post(`/api/v1/videos/${videoId}/like`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(201);

    const video = await request(app).get(`/api/v1/videos/${videoId}`).set('Authorization', `Bearer ${accessToken}`);
    expect(video.body.likeCount).toBe(1);
  });

  it('rejects a duplicate like (one like per user/video)', async () => {
    const response = await request(app)
      .post(`/api/v1/videos/${videoId}/like`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(409);
  });

  it('unlikes a video and decrements likeCount', async () => {
    const response = await request(app)
      .delete(`/api/v1/videos/${videoId}/like`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(200);

    const video = await request(app).get(`/api/v1/videos/${videoId}`).set('Authorization', `Bearer ${accessToken}`);
    expect(video.body.likeCount).toBe(0);
  });

  it('404s unliking a video that was never liked', async () => {
    const response = await request(app)
      .delete(`/api/v1/videos/${videoId}/like`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(404);
  });
});

describe('Comments', () => {
  let ownerToken: string;
  let otherToken: string;
  let videoId: string;

  beforeAll(async () => {
    const { response: registerResponse } = await registerUser();
    ownerToken = registerResponse.body.accessToken;
    const { response: otherRegisterResponse } = await registerUser();
    otherToken = otherRegisterResponse.body.accessToken;

    const uploadResponse = await uploadSampleVideo(ownerToken);
    await waitForVideoSettled(uploadResponse.body.id, ownerToken);
    videoId = uploadResponse.body.id;
  });

  it('creates and lists a comment', async () => {
    const createResponse = await request(app)
      .post(`/api/v1/videos/${videoId}/comments`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ text: 'Great video!' });
    expect(createResponse.status).toBe(201);

    const listResponse = await request(app)
      .get(`/api/v1/videos/${videoId}/comments`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.comments).toHaveLength(1);
    expect(listResponse.body.comments[0].text).toBe('Great video!');

    const video = await request(app).get(`/api/v1/videos/${videoId}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(video.body.commentCount).toBe(1);
  });

  it('rejects an empty comment', async () => {
    const response = await request(app)
      .post(`/api/v1/videos/${videoId}/comments`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ text: '' });
    expect(response.status).toBe(422);
  });

  it('rejects a comment over the length limit', async () => {
    const response = await request(app)
      .post(`/api/v1/videos/${videoId}/comments`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ text: 'x'.repeat(501) });
    expect(response.status).toBe(422);
  });

  it('rejects deleting another user\'s comment', async () => {
    const createResponse = await request(app)
      .post(`/api/v1/videos/${videoId}/comments`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ text: 'Owned by other user' });

    const deleteResponse = await request(app)
      .delete(`/api/v1/comments/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(deleteResponse.status).toBe(403);
  });

  it('lets a user delete their own comment', async () => {
    const createResponse = await request(app)
      .post(`/api/v1/videos/${videoId}/comments`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ text: 'Deleting this one' });

    const deleteResponse = await request(app)
      .delete(`/api/v1/comments/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(deleteResponse.status).toBe(204);
  });
});

describe('Shares', () => {
  it('records a share event and increments shareCount', async () => {
    const { response: registerResponse } = await registerUser();
    const accessToken = registerResponse.body.accessToken;
    const uploadResponse = await uploadSampleVideo(accessToken);
    await waitForVideoSettled(uploadResponse.body.id, accessToken);

    const response = await request(app)
      .post(`/api/v1/videos/${uploadResponse.body.id}/share`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(201);
    expect(response.body.shareCount).toBe(1);
  });

  it('does not double-count a rapid duplicate share request', async () => {
    const { response: registerResponse } = await registerUser();
    const accessToken = registerResponse.body.accessToken;
    const uploadResponse = await uploadSampleVideo(accessToken);
    await waitForVideoSettled(uploadResponse.body.id, accessToken);

    await request(app).post(`/api/v1/videos/${uploadResponse.body.id}/share`).set('Authorization', `Bearer ${accessToken}`);
    const second = await request(app)
      .post(`/api/v1/videos/${uploadResponse.body.id}/share`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(second.status).toBe(200);
    expect(second.body.shareCount).toBe(1);
  });
});

describe('Views', () => {
  it('records a view and increments viewCount', async () => {
    const { response: registerResponse } = await registerUser();
    const accessToken = registerResponse.body.accessToken;
    const uploadResponse = await uploadSampleVideo(accessToken);
    await waitForVideoSettled(uploadResponse.body.id, accessToken);

    const response = await request(app)
      .post(`/api/v1/videos/${uploadResponse.body.id}/view`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(201);
    expect(response.body.counted).toBe(true);
    expect(response.body.viewCount).toBe(1);
  });

  it('does not double-count a duplicate view within the dedupe window', async () => {
    const { response: registerResponse } = await registerUser();
    const accessToken = registerResponse.body.accessToken;
    const uploadResponse = await uploadSampleVideo(accessToken);
    await waitForVideoSettled(uploadResponse.body.id, accessToken);

    await request(app).post(`/api/v1/videos/${uploadResponse.body.id}/view`).set('Authorization', `Bearer ${accessToken}`);
    const second = await request(app)
      .post(`/api/v1/videos/${uploadResponse.body.id}/view`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(second.status).toBe(200);
    expect(second.body.counted).toBe(false);
    expect(second.body.viewCount).toBe(1);
  });
});

describe('Reports', () => {
  it('creates a report', async () => {
    const { response: registerResponse } = await registerUser();
    const uploadResponse = await uploadSampleVideo(registerResponse.body.accessToken);

    const { response: reporterRegisterResponse } = await registerUser();
    const response = await request(app)
      .post(`/api/v1/videos/${uploadResponse.body.id}/report`)
      .set('Authorization', `Bearer ${reporterRegisterResponse.body.accessToken}`)
      .send({ reason: 'SPAM', description: 'Looks like spam' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('PENDING');
  });

  it('rejects a duplicate report from the same user (prevents report spam)', async () => {
    const { response: registerResponse } = await registerUser();
    const uploadResponse = await uploadSampleVideo(registerResponse.body.accessToken);

    const { response: reporterRegisterResponse } = await registerUser();
    const reporterToken = reporterRegisterResponse.body.accessToken;

    await request(app)
      .post(`/api/v1/videos/${uploadResponse.body.id}/report`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({ reason: 'SPAM' });

    const second = await request(app)
      .post(`/api/v1/videos/${uploadResponse.body.id}/report`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({ reason: 'OTHER', description: 'trying again' });

    expect(second.status).toBe(409);
  });
});
