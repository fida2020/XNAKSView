import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { app, registerUser, uploadSampleVideo, waitForVideoSettled } from '@/test/helpers';

describe('GET /api/v1/feed', () => {
  it('requires authentication', async () => {
    const response = await request(app).get('/api/v1/feed');
    expect(response.status).toBe(401);
  });

  describe('with a mix of video states', () => {
    let accessToken: string;
    let publicVideoIds: string[];

    beforeAll(async () => {
      const { response: registerResponse } = await registerUser();
      accessToken = registerResponse.body.accessToken;

      // Three PUBLIC videos that should appear in the feed.
      const publicUploads = await Promise.all([
        uploadSampleVideo(accessToken, { visibility: 'PUBLIC' }),
        uploadSampleVideo(accessToken, { visibility: 'PUBLIC' }),
        uploadSampleVideo(accessToken, { visibility: 'PUBLIC' }),
      ]);
      await Promise.all(publicUploads.map((upload) => waitForVideoSettled(upload.body.id, accessToken)));
      publicVideoIds = publicUploads.map((upload) => upload.body.id);

      // A PRIVATE video — must never appear in the feed, even though it's READY.
      const privateUpload = await uploadSampleVideo(accessToken, { visibility: 'PRIVATE' });
      await waitForVideoSettled(privateUpload.body.id, accessToken);

      // A video the owner deletes — must never appear in the feed.
      const deletedUpload = await uploadSampleVideo(accessToken, { visibility: 'PUBLIC' });
      await waitForVideoSettled(deletedUpload.body.id, accessToken);
      await request(app).delete(`/api/v1/videos/${deletedUpload.body.id}`).set('Authorization', `Bearer ${accessToken}`);
    });

    it('only returns READY, PUBLIC videos — never private/deleted/processing ones', async () => {
      const response = await request(app).get('/api/v1/feed?limit=50').set('Authorization', `Bearer ${accessToken}`);
      expect(response.status).toBe(200);

      const returnedIds: string[] = response.body.videos.map((video: { id: string }) => video.id);
      for (const id of publicVideoIds) {
        expect(returnedIds).toContain(id);
      }
      for (const video of response.body.videos) {
        expect(video.status).toBe('READY');
        expect(video.visibility).toBe('PUBLIC');
      }
    });

    it('paginates with a cursor, returning every video exactly once across pages', async () => {
      const seenIds = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;

      do {
        const response: request.Response = await request(app)
          .get(`/api/v1/feed?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
          .set('Authorization', `Bearer ${accessToken}`);
        expect(response.status).toBe(200);
        expect(response.body.videos.length).toBeLessThanOrEqual(2);

        for (const video of response.body.videos) {
          expect(seenIds.has(video.id)).toBe(false); // no duplicates across pages
          seenIds.add(video.id);
        }

        cursor = response.body.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(20); // guard against an infinite loop on a real bug
      } while (cursor);

      for (const id of publicVideoIds) {
        expect(seenIds.has(id)).toBe(true);
      }
    });

    it('rejects a malformed cursor', async () => {
      const response = await request(app)
        .get('/api/v1/feed?cursor=not-a-real-cursor!!!')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(response.status).toBe(400);
    });
  });

  describe('scope=following and scope=friends', () => {
    it('following shows a one-way followed creator; friends requires a real mutual follow', async () => {
      const { response: viewerReg } = await registerUser();
      const { response: oneWayCreatorReg } = await registerUser();
      const { response: mutualCreatorReg } = await registerUser();

      // Viewer follows both; only the mutual one follows back.
      await request(app).post(`/api/v1/users/${oneWayCreatorReg.body.user.id}/follow`).set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
      await request(app).post(`/api/v1/users/${mutualCreatorReg.body.user.id}/follow`).set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
      await request(app).post(`/api/v1/users/${viewerReg.body.user.id}/follow`).set('Authorization', `Bearer ${mutualCreatorReg.body.accessToken}`);

      const oneWayUpload = await uploadSampleVideo(oneWayCreatorReg.body.accessToken, { visibility: 'PUBLIC' });
      await waitForVideoSettled(oneWayUpload.body.id, oneWayCreatorReg.body.accessToken);
      const mutualUpload = await uploadSampleVideo(mutualCreatorReg.body.accessToken, { visibility: 'PUBLIC' });
      await waitForVideoSettled(mutualUpload.body.id, mutualCreatorReg.body.accessToken);

      const following = await request(app).get('/api/v1/feed?scope=following&limit=50').set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
      const followingIds = new Set(following.body.videos.map((v: { id: string }) => v.id));
      expect(followingIds.has(oneWayUpload.body.id)).toBe(true);
      expect(followingIds.has(mutualUpload.body.id)).toBe(true);

      const friends = await request(app).get('/api/v1/feed?scope=friends&limit=50').set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
      const friendIds = new Set(friends.body.videos.map((v: { id: string }) => v.id));
      // Only the REAL mutual follow counts as a friend — the one-way follow never does.
      expect(friendIds.has(mutualUpload.body.id)).toBe(true);
      expect(friendIds.has(oneWayUpload.body.id)).toBe(false);
    });
  });
});
