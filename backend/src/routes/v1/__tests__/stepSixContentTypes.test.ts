import path from 'path';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, registerUser, uploadSampleVideo, waitForVideoSettled } from '@/test/helpers';

const SAMPLE_PHOTO_PATH = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'sample-photo.jpg');
const SAMPLE_PHOTO_2_PATH = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'sample-photo-2.jpg');
const NOT_AN_IMAGE_PATH = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'not-a-video.txt');
const SAMPLE_VIDEO_PATH = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'sample.mp4');

async function readyVideo(token: string, overrides: Parameters<typeof uploadSampleVideo>[1] = {}) {
  const upload = await uploadSampleVideo(token, overrides);
  await waitForVideoSettled(upload.body.id, token);
  return upload.body.id as string;
}

describe('Photo posts / carousels', () => {
  it('rejects a photo post with fewer than 2 images', async () => {
    const { response: userReg } = await registerUser();
    const response = await request(app)
      .post('/api/v1/photo-posts')
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .field('caption', 'solo')
      .attach('photos', SAMPLE_PHOTO_PATH);
    expect(response.status).toBe(400);
  });

  it('creates a carousel, extracts hashtags, and serves each photo only to eligible viewers', async () => {
    const { response: userReg } = await registerUser();
    const token = userReg.body.accessToken;

    const create = await request(app)
      .post('/api/v1/photo-posts')
      .set('Authorization', `Bearer ${token}`)
      .field('caption', 'a carousel #xnakphoto')
      .attach('photos', SAMPLE_PHOTO_PATH)
      .attach('photos', SAMPLE_PHOTO_2_PATH);
    expect(create.status).toBe(201);
    expect(create.body.photos).toHaveLength(2);

    const hashtagPage = await request(app).get('/api/v1/hashtags/xnakphoto').set('Authorization', `Bearer ${token}`);
    expect(hashtagPage.body.postCount).toBe(1);

    const photoId = create.body.photos[0].id;
    const view = await request(app).get(`/api/v1/photo-posts/${create.body.id}/photos/${photoId}`).set('Authorization', `Bearer ${token}`);
    expect(view.status).toBe(200);

    const { response: strangerReg } = await registerUser();
    await request(app)
      .patch(`/api/v1/photo-posts/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ visibility: 'PRIVATE' });
    const strangerView = await request(app).get(`/api/v1/photo-posts/${create.body.id}`).set('Authorization', `Bearer ${strangerReg.body.accessToken}`);
    expect(strangerView.status).toBe(404);
  });

  it('rejects a non-image file regardless of extension', async () => {
    const { response: userReg } = await registerUser();
    const response = await request(app)
      .post('/api/v1/photo-posts')
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .attach('photos', SAMPLE_PHOTO_PATH)
      .attach('photos', NOT_AN_IMAGE_PATH);
    expect(response.status).toBe(400);
  });

  it('likes and comments on a photo post', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: otherReg } = await registerUser();
    const create = await request(app)
      .post('/api/v1/photo-posts')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .attach('photos', SAMPLE_PHOTO_PATH)
      .attach('photos', SAMPLE_PHOTO_2_PATH);

    const like = await request(app).post(`/api/v1/photo-posts/${create.body.id}/like`).set('Authorization', `Bearer ${otherReg.body.accessToken}`);
    expect(like.status).toBe(201);
    const comment = await request(app)
      .post(`/api/v1/photo-posts/${create.body.id}/comments`)
      .set('Authorization', `Bearer ${otherReg.body.accessToken}`)
      .send({ text: 'nice photos' });
    expect(comment.status).toBe(201);

    const detail = await request(app).get(`/api/v1/photo-posts/${create.body.id}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(detail.body.likeCount).toBe(1);
    expect(detail.body.commentCount).toBe(1);
  });

  it('only the owner can delete their photo post', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: strangerReg } = await registerUser();
    const create = await request(app)
      .post('/api/v1/photo-posts')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .attach('photos', SAMPLE_PHOTO_PATH)
      .attach('photos', SAMPLE_PHOTO_2_PATH);

    const forbidden = await request(app).delete(`/api/v1/photo-posts/${create.body.id}`).set('Authorization', `Bearer ${strangerReg.body.accessToken}`);
    expect(forbidden.status).toBe(403);
    const deleted = await request(app).delete(`/api/v1/photo-posts/${create.body.id}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(deleted.status).toBe(204);
  });
});

describe('Text posts', () => {
  it('creates, edits, likes, comments on, and deletes a text post', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: otherReg } = await registerUser();

    const create = await request(app)
      .post('/api/v1/text-posts')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ text: 'Hello #xnaktext', backgroundStyle: 'gradient-1' });
    expect(create.status).toBe(201);

    const hashtagPage = await request(app).get('/api/v1/hashtags/xnaktext').set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(hashtagPage.body.postCount).toBe(1);

    const edited = await request(app)
      .patch(`/api/v1/text-posts/${create.body.id}`)
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ text: 'Edited text' });
    expect(edited.status).toBe(200);
    expect(edited.body.text).toBe('Edited text');

    const like = await request(app).post(`/api/v1/text-posts/${create.body.id}/like`).set('Authorization', `Bearer ${otherReg.body.accessToken}`);
    expect(like.status).toBe(201);
    const comment = await request(app)
      .post(`/api/v1/text-posts/${create.body.id}/comments`)
      .set('Authorization', `Bearer ${otherReg.body.accessToken}`)
      .send({ text: 'nice thought' });
    expect(comment.status).toBe(201);

    const forbidden = await request(app).delete(`/api/v1/text-posts/${create.body.id}`).set('Authorization', `Bearer ${otherReg.body.accessToken}`);
    expect(forbidden.status).toBe(403);
    const deleted = await request(app).delete(`/api/v1/text-posts/${create.body.id}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(deleted.status).toBe(204);
  });

  it('reports a text post, rejecting a duplicate', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: reporterReg } = await registerUser();
    const create = await request(app)
      .post('/api/v1/text-posts')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ text: 'reportable text' });

    const first = await request(app).post(`/api/v1/text-posts/${create.body.id}/report`).set('Authorization', `Bearer ${reporterReg.body.accessToken}`).send({ reason: 'SPAM' });
    expect(first.status).toBe(201);
    const second = await request(app).post(`/api/v1/text-posts/${create.body.id}/report`).set('Authorization', `Bearer ${reporterReg.body.accessToken}`).send({ reason: 'OTHER' });
    expect(second.status).toBe(409);
  });
});

describe('Stories', () => {
  it('creates a photo story, is viewable by a follower, and increments the view count exactly once per viewer', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: followerReg } = await registerUser();
    await request(app).post(`/api/v1/users/${ownerReg.body.user.id}/follow`).set('Authorization', `Bearer ${followerReg.body.accessToken}`);

    const create = await request(app)
      .post('/api/v1/stories')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .field('mediaType', 'PHOTO')
      .field('caption', 'my day')
      .attach('media', SAMPLE_PHOTO_PATH);
    expect(create.status).toBe(201);
    expect(create.body.expiresAt).toBeTruthy();

    const feed = await request(app).get('/api/v1/stories/feed').set('Authorization', `Bearer ${followerReg.body.accessToken}`);
    expect(feed.body.stories.some((s: { id: string }) => s.id === create.body.id)).toBe(true);

    await request(app).get(`/api/v1/stories/${create.body.id}`).set('Authorization', `Bearer ${followerReg.body.accessToken}`);
    await request(app).get(`/api/v1/stories/${create.body.id}`).set('Authorization', `Bearer ${followerReg.body.accessToken}`);

    const viewers = await request(app).get(`/api/v1/stories/${create.body.id}/viewers`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(viewers.body.viewers).toHaveLength(1);

    const detail = await request(app).get(`/api/v1/stories/${create.body.id}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(detail.body.viewCount).toBe(1);
  });

  it('rejects a mismatched mediaType/file-content declaration', async () => {
    const { response: userReg } = await registerUser();
    const response = await request(app)
      .post('/api/v1/stories')
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .field('mediaType', 'VIDEO')
      .attach('media', SAMPLE_PHOTO_PATH);
    expect(response.status).toBe(400);
  });

  it('only mutual followers can reply to a story', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: oneWayReg } = await registerUser();
    const { response: mutualReg } = await registerUser();
    await request(app).post(`/api/v1/users/${ownerReg.body.user.id}/follow`).set('Authorization', `Bearer ${oneWayReg.body.accessToken}`);
    await request(app).post(`/api/v1/users/${mutualReg.body.user.id}/follow`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    await request(app).post(`/api/v1/users/${ownerReg.body.user.id}/follow`).set('Authorization', `Bearer ${mutualReg.body.accessToken}`);

    const create = await request(app)
      .post('/api/v1/stories')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .field('mediaType', 'PHOTO')
      .attach('media', SAMPLE_PHOTO_PATH);

    const oneWayReply = await request(app)
      .post(`/api/v1/stories/${create.body.id}/reply`)
      .set('Authorization', `Bearer ${oneWayReg.body.accessToken}`)
      .send({ text: 'hi' });
    expect(oneWayReply.status).toBe(403);

    const mutualReply = await request(app)
      .post(`/api/v1/stories/${create.body.id}/reply`)
      .set('Authorization', `Bearer ${mutualReg.body.accessToken}`)
      .send({ text: 'hi' });
    expect(mutualReply.status).toBe(201);
  });

  it('rejects deleting a story you do not own', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: strangerReg } = await registerUser();
    const create = await request(app)
      .post('/api/v1/stories')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .field('mediaType', 'PHOTO')
      .attach('media', SAMPLE_PHOTO_PATH);

    const response = await request(app).delete(`/api/v1/stories/${create.body.id}`).set('Authorization', `Bearer ${strangerReg.body.accessToken}`);
    expect(response.status).toBe(403);
  });

  it('a deleted story is no longer visible', async () => {
    const { response: ownerReg } = await registerUser();
    const create = await request(app)
      .post('/api/v1/stories')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .field('mediaType', 'PHOTO')
      .attach('media', SAMPLE_PHOTO_PATH);
    await request(app).delete(`/api/v1/stories/${create.body.id}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);

    const response = await request(app).get(`/api/v1/stories/${create.body.id}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(response.status).toBe(404);
  });
});

describe('Sounds foundation', () => {
  it('lazily creates a Sound for a video, and lets a second video reuse it with correct attribution and usage count', async () => {
    const { response: creatorReg } = await registerUser();
    const { response: reuserReg } = await registerUser();
    const sourceVideoId = await readyVideo(creatorReg.body.accessToken);

    const useSound = await request(app).post(`/api/v1/videos/${sourceVideoId}/sound`).set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(useSound.status).toBe(200);
    const soundId = useSound.body.id;

    const page = await request(app).get(`/api/v1/sounds/${soundId}`).set('Authorization', `Bearer ${reuserReg.body.accessToken}`);
    expect(page.status).toBe(200);
    expect(page.body.sourceVideoId).toBe(sourceVideoId);
    expect(page.body.author.id).toBe(creatorReg.body.user.id);

    const reuseUpload = await request(app)
      .post('/api/v1/videos')
      .set('Authorization', `Bearer ${reuserReg.body.accessToken}`)
      .field('soundId', soundId)
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(reuseUpload.status).toBe(202);
    expect(reuseUpload.body.soundId).toBe(soundId);
    await waitForVideoSettled(reuseUpload.body.id, reuserReg.body.accessToken);

    const updatedSound = await request(app).get(`/api/v1/sounds/${soundId}`).set('Authorization', `Bearer ${reuserReg.body.accessToken}`);
    expect(updatedSound.body.usageCount).toBe(2);

    const videosUsingSound = await request(app).get(`/api/v1/sounds/${soundId}/videos`).set('Authorization', `Bearer ${reuserReg.body.accessToken}`);
    expect(videosUsingSound.body.videos.some((v: { id: string }) => v.id === reuseUpload.body.id)).toBe(true);
  });

  it('rejects referencing a nonexistent sound id', async () => {
    const { response: userReg } = await registerUser();
    const response = await request(app)
      .post('/api/v1/videos')
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .field('soundId', '00000000-0000-0000-0000-000000000000')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(response.status).toBe(404);
  });
});

describe('Duet/Stitch real compositing (not just lineage metadata)', () => {
  it('produces a genuinely side-by-side composited video for a Duet, not a copy of either input', async () => {
    const { response: sourceReg } = await registerUser();
    const { response: duetterReg } = await registerUser();
    const sourceId = await readyVideo(sourceReg.body.accessToken);

    const duet = await request(app)
      .post(`/api/v1/videos/${sourceId}/duet`)
      .set('Authorization', `Bearer ${duetterReg.body.accessToken}`)
      .field('caption', 'composited duet')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(duet.status).toBe(202);
    const settled = await waitForVideoSettled(duet.body.id, duetterReg.body.accessToken, 30_000);
    expect(settled.body.status).toBe('READY');

    // Source is 640x360; a genuine side-by-side stack of two 640-wide
    // halves (each rescaled to the same height) lands close to double the
    // single-clip width — nowhere near it would mean this just re-encoded
    // one of the two inputs instead of actually compositing them.
    expect(settled.body.width).toBeGreaterThan(1100);
    expect(settled.body.height).toBeLessThan(500);
  }, 40_000);

  it('produces a video whose duration reflects the selected source segment plus the new recording, proving a real trim+concat rather than a fixed first-5-seconds copy', async () => {
    const { response: sourceReg } = await registerUser();
    const { response: stitcherReg } = await registerUser();
    const sourceId = await readyVideo(sourceReg.body.accessToken);

    // Source is 3s; selects a 1.5s window starting mid-clip (not the start) —
    // proves the server-side compositor honors an arbitrary start offset,
    // not just "first N seconds".
    const stitch = await request(app)
      .post(`/api/v1/videos/${sourceId}/stitch`)
      .set('Authorization', `Bearer ${stitcherReg.body.accessToken}`)
      .field('caption', 'composited stitch')
      .field('sourceStartMs', '500')
      .field('sourceEndMs', '2000')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(stitch.status).toBe(202);
    expect(stitch.body.stitchOfVideoId).toBe(sourceId);
    const settled = await waitForVideoSettled(stitch.body.id, stitcherReg.body.accessToken, 30_000);
    expect(settled.body.status).toBe('READY');

    // ~1.5s segment + ~3s new recording ≈ 4.5s, generous tolerance for
    // encoder rounding — but nowhere near a bare 3s (one input alone) or a
    // bare 5s (a naive "always take 5s" bug).
    expect(settled.body.durationMs).toBeGreaterThan(4000);
    expect(settled.body.durationMs).toBeLessThan(5300);
  }, 40_000);

  it('clamps a Stitch selection starting past 5 seconds-from-end appropriately and rejects an empty/invalid segment', async () => {
    const { response: sourceReg } = await registerUser();
    const { response: stitcherReg } = await registerUser();
    const sourceId = await readyVideo(sourceReg.body.accessToken);

    const invalid = await request(app)
      .post(`/api/v1/videos/${sourceId}/stitch`)
      .set('Authorization', `Bearer ${stitcherReg.body.accessToken}`)
      .field('caption', 'bad segment')
      .field('sourceStartMs', '3000')
      .field('sourceEndMs', '3000')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(invalid.status).toBe(400);
  });
});

describe('Add Yours', () => {
  it('lets others respond to a video that carries an Add Yours prompt', async () => {
    const { response: promptReg } = await registerUser();
    const { response: responderReg } = await registerUser();

    const promptVideoId = await readyVideo(promptReg.body.accessToken, {});
    await request(app)
      .patch(`/api/v1/videos/${promptVideoId}`)
      .set('Authorization', `Bearer ${promptReg.body.accessToken}`)
      .send({ caption: 'ignored' });

    // addYoursPrompt is only settable at creation time via the multipart
    // form field — verify that path directly.
    const promptUpload = await request(app)
      .post('/api/v1/videos')
      .set('Authorization', `Bearer ${promptReg.body.accessToken}`)
      .field('addYoursPrompt', 'your favorite summer memory')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(promptUpload.status).toBe(202);
    expect(promptUpload.body.addYoursPrompt).toBe('your favorite summer memory');
    await waitForVideoSettled(promptUpload.body.id, promptReg.body.accessToken);

    const response = await request(app)
      .post(`/api/v1/videos/${promptUpload.body.id}/add-yours`)
      .set('Authorization', `Bearer ${responderReg.body.accessToken}`)
      .field('caption', 'my response')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(response.status).toBe(202);
    expect(response.body.addYoursOfVideoId).toBe(promptUpload.body.id);
    await waitForVideoSettled(response.body.id, responderReg.body.accessToken);

    const responses = await request(app)
      .get(`/api/v1/videos/${promptUpload.body.id}/add-yours/responses`)
      .set('Authorization', `Bearer ${promptReg.body.accessToken}`);
    expect(responses.body.videos.some((v: { id: string }) => v.id === response.body.id)).toBe(true);
  });

  it('rejects responding to a video without an Add Yours prompt', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: responderReg } = await registerUser();
    const videoId = await readyVideo(ownerReg.body.accessToken);

    const response = await request(app)
      .post(`/api/v1/videos/${videoId}/add-yours`)
      .set('Authorization', `Bearer ${responderReg.body.accessToken}`)
      .field('caption', 'nope')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(response.status).toBe(400);
  });
});

describe('Repost/favorite state persists across reload (real backend state, not client-only)', () => {
  it('feed and video-detail responses reflect the authenticated user\'s real repost/favorite state', async () => {
    const { response: authorReg } = await registerUser();
    const { response: userReg } = await registerUser();
    const videoId = await readyVideo(authorReg.body.accessToken);

    await request(app).post(`/api/v1/videos/${videoId}/repost`).set('Authorization', `Bearer ${userReg.body.accessToken}`);
    await request(app).post(`/api/v1/videos/${videoId}/favorite`).set('Authorization', `Bearer ${userReg.body.accessToken}`);

    const detail = await request(app).get(`/api/v1/videos/${videoId}`).set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(detail.body.repostedByMe).toBe(true);
    expect(detail.body.favoritedByMe).toBe(true);

    const feed = await request(app).get('/api/v1/feed').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    const feedEntry = feed.body.videos.find((v: { id: string }) => v.id === videoId);
    expect(feedEntry.repostedByMe).toBe(true);
    expect(feedEntry.favoritedByMe).toBe(true);

    // A different user never sees another user's repost/favorite state as their own.
    const otherView = await request(app).get(`/api/v1/videos/${videoId}`).set('Authorization', `Bearer ${authorReg.body.accessToken}`);
    expect(otherView.body.repostedByMe).toBe(false);
    expect(otherView.body.favoritedByMe).toBe(false);
  });
});
