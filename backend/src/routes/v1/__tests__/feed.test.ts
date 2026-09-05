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
});
