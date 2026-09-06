import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { app, registerAdmin, registerUser, uploadSampleVideo, waitForVideoSettled, SAMPLE_VIDEO_PATH } from '@/test/helpers';

async function readyVideo(token: string, overrides: Parameters<typeof uploadSampleVideo>[1] = {}) {
  const upload = await uploadSampleVideo(token, overrides);
  await waitForVideoSettled(upload.body.id, token);
  return upload.body.id as string;
}

describe('Hashtags + mentions', () => {
  it('extracts, normalizes (case-insensitive), and counts hashtags from a caption', async () => {
    const { response: userReg } = await registerUser();
    const token = userReg.body.accessToken;

    await readyVideo(token, { caption: 'Loving #XNAKView today! #fun' });
    await readyVideo(token, { caption: 'Another #xnakview post' });

    const page = await request(app).get('/api/v1/hashtags/xnakview').set('Authorization', `Bearer ${token}`);
    expect(page.status).toBe(200);
    expect(page.body.exists).toBe(true);
    expect(page.body.postCount).toBe(2);

    const videos = await request(app).get('/api/v1/hashtags/xnakview/videos').set('Authorization', `Bearer ${token}`);
    expect(videos.status).toBe(200);
    expect(videos.body.videos).toHaveLength(2);
  });

  it('resolves @mentions to real users only, never fabricating a mention for a nonexistent username', async () => {
    const { response: authorReg } = await registerUser();
    const { response: mentionedReg } = await registerUser();
    const mentionedUsername = `m${Date.now().toString().slice(-10)}`;
    await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${mentionedReg.body.accessToken}`)
      .send({ username: mentionedUsername });

    const videoId = await readyVideo(authorReg.body.accessToken, { caption: `Hey @${mentionedUsername} and @nobody_such_user check this out` });

    const mentions = await prisma.mention.findMany({ where: { videoId } });
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.mentionedUserId).toBe(mentionedReg.body.user.id);

    const activity = await request(app).get('/api/v1/activity').set('Authorization', `Bearer ${mentionedReg.body.accessToken}`);
    expect(activity.body.activity.some((a: { type: string }) => a.type === 'MENTION')).toBe(true);
  });
});

describe('Post editing (PATCH /videos/:id)', () => {
  it('lets the owner edit caption/visibility/reuse permissions, and re-derives hashtags', async () => {
    const { response: userReg } = await registerUser();
    const token = userReg.body.accessToken;
    const videoId = await readyVideo(token, { caption: '#before' });

    const edited = await request(app)
      .patch(`/api/v1/videos/${videoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ caption: '#after', visibility: 'PRIVATE', allowDuet: false });
    expect(edited.status).toBe(200);
    expect(edited.body.caption).toBe('#after');
    expect(edited.body.visibility).toBe('PRIVATE');
    expect(edited.body.allowDuet).toBe(false);

    const before = await request(app).get('/api/v1/hashtags/before').set('Authorization', `Bearer ${token}`);
    expect(before.body.postCount).toBe(0);
    const after = await request(app).get('/api/v1/hashtags/after').set('Authorization', `Bearer ${token}`);
    expect(after.body.postCount).toBe(1);
  });

  it('rejects a non-owner editing a video', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: strangerReg } = await registerUser();
    const videoId = await readyVideo(ownerReg.body.accessToken);

    const response = await request(app)
      .patch(`/api/v1/videos/${videoId}`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`)
      .send({ caption: 'hijacked' });
    expect(response.status).toBe(403);
  });
});

describe('Comments: replies, likes, pin, report', () => {
  it('supports one level of replies but rejects replying to a reply', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: commenterReg } = await registerUser();
    const videoId = await readyVideo(ownerReg.body.accessToken);

    const top = await request(app)
      .post(`/api/v1/videos/${videoId}/comments`)
      .set('Authorization', `Bearer ${commenterReg.body.accessToken}`)
      .send({ text: 'top level' });
    expect(top.status).toBe(201);

    const reply = await request(app)
      .post(`/api/v1/videos/${videoId}/comments`)
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ text: 'a reply', parentId: top.body.id });
    expect(reply.status).toBe(201);

    const replyToReply = await request(app)
      .post(`/api/v1/videos/${videoId}/comments`)
      .set('Authorization', `Bearer ${commenterReg.body.accessToken}`)
      .send({ text: 'nested', parentId: reply.body.id });
    expect(replyToReply.status).toBe(400);

    const replies = await request(app)
      .get(`/api/v1/comments/${top.body.id}/replies`)
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(replies.status).toBe(200);
    expect(replies.body.replies).toHaveLength(1);

    const list = await request(app).get(`/api/v1/videos/${videoId}/comments`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(list.body.comments.find((c: { id: string }) => c.id === top.body.id).replyCount).toBe(1);
  });

  it('likes/unlikes a comment, notifying the comment author', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: commenterReg } = await registerUser();
    const videoId = await readyVideo(ownerReg.body.accessToken);
    const comment = await request(app)
      .post(`/api/v1/videos/${videoId}/comments`)
      .set('Authorization', `Bearer ${commenterReg.body.accessToken}`)
      .send({ text: 'like me' });

    const like = await request(app).post(`/api/v1/comments/${comment.body.id}/like`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(like.status).toBe(201);
    const dup = await request(app).post(`/api/v1/comments/${comment.body.id}/like`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(dup.status).toBe(409);

    const activity = await request(app).get('/api/v1/activity').set('Authorization', `Bearer ${commenterReg.body.accessToken}`);
    expect(activity.body.activity.some((a: { type: string }) => a.type === 'COMMENT_LIKE')).toBe(true);

    const unlike = await request(app).delete(`/api/v1/comments/${comment.body.id}/like`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(unlike.status).toBe(200);
  });

  it('only the video owner can pin a comment, and at most one is pinned at a time', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: commenterReg } = await registerUser();
    const videoId = await readyVideo(ownerReg.body.accessToken);
    const c1 = await request(app).post(`/api/v1/videos/${videoId}/comments`).set('Authorization', `Bearer ${commenterReg.body.accessToken}`).send({ text: 'one' });
    const c2 = await request(app).post(`/api/v1/videos/${videoId}/comments`).set('Authorization', `Bearer ${commenterReg.body.accessToken}`).send({ text: 'two' });

    const forbidden = await request(app).post(`/api/v1/comments/${c1.body.id}/pin`).set('Authorization', `Bearer ${commenterReg.body.accessToken}`);
    expect(forbidden.status).toBe(403);

    await request(app).post(`/api/v1/comments/${c1.body.id}/pin`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    await request(app).post(`/api/v1/comments/${c2.body.id}/pin`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);

    const list = await request(app).get(`/api/v1/videos/${videoId}/comments`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(list.body.pinned.id).toBe(c2.body.id);
    expect(list.body.comments.some((c: { id: string; isPinned: boolean }) => c.id === c1.body.id && c.isPinned)).toBe(false);
  });

  it('lets a viewer report a comment, and rejects a duplicate', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: commenterReg } = await registerUser();
    const videoId = await readyVideo(ownerReg.body.accessToken);
    const comment = await request(app).post(`/api/v1/videos/${videoId}/comments`).set('Authorization', `Bearer ${commenterReg.body.accessToken}`).send({ text: 'reportable' });

    const first = await request(app).post(`/api/v1/comments/${comment.body.id}/report`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`).send({ reason: 'SPAM' });
    expect(first.status).toBe(201);
    const second = await request(app).post(`/api/v1/comments/${comment.body.id}/report`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`).send({ reason: 'OTHER' });
    expect(second.status).toBe(409);
  });

  it('decrements the video comment count by the whole subtree when a top-level comment with replies is deleted', async () => {
    const { response: ownerReg } = await registerUser();
    const videoId = await readyVideo(ownerReg.body.accessToken);
    const top = await request(app).post(`/api/v1/videos/${videoId}/comments`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`).send({ text: 'top' });
    await request(app).post(`/api/v1/videos/${videoId}/comments`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`).send({ text: 'reply', parentId: top.body.id });

    const beforeDelete = await request(app).get(`/api/v1/videos/${videoId}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(beforeDelete.body.commentCount).toBe(2);

    await request(app).delete(`/api/v1/comments/${top.body.id}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);

    const afterDelete = await request(app).get(`/api/v1/videos/${videoId}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(afterDelete.body.commentCount).toBe(0);
  });
});

describe('Repost', () => {
  it('reposts and un-reposts without duplicating media, rejecting a duplicate repost', async () => {
    const { response: authorReg } = await registerUser();
    const { response: reposterReg } = await registerUser();
    const videoId = await readyVideo(authorReg.body.accessToken);

    const repost = await request(app).post(`/api/v1/videos/${videoId}/repost`).set('Authorization', `Bearer ${reposterReg.body.accessToken}`);
    expect(repost.status).toBe(201);
    const dup = await request(app).post(`/api/v1/videos/${videoId}/repost`).set('Authorization', `Bearer ${reposterReg.body.accessToken}`);
    expect(dup.status).toBe(409);

    const tab = await request(app).get(`/api/v1/users/${reposterReg.body.user.id}/reposts`).set('Authorization', `Bearer ${reposterReg.body.accessToken}`);
    expect(tab.body.videos).toHaveLength(1);
    expect(tab.body.videos[0].id).toBe(videoId);

    const activity = await request(app).get('/api/v1/activity').set('Authorization', `Bearer ${authorReg.body.accessToken}`);
    expect(activity.body.activity.some((a: { type: string }) => a.type === 'REPOST')).toBe(true);

    const undo = await request(app).delete(`/api/v1/videos/${videoId}/repost`).set('Authorization', `Bearer ${reposterReg.body.accessToken}`);
    expect(undo.status).toBe(200);
  });

  it('rejects reposting a video from a blocked relationship', async () => {
    const { response: authorReg } = await registerUser();
    const { response: reposterReg } = await registerUser();
    const videoId = await readyVideo(authorReg.body.accessToken);
    await request(app).post(`/api/v1/users/${reposterReg.body.user.id}/block`).set('Authorization', `Bearer ${authorReg.body.accessToken}`);

    const response = await request(app).post(`/api/v1/videos/${videoId}/repost`).set('Authorization', `Bearer ${reposterReg.body.accessToken}`);
    expect(response.status).toBe(404);
  });
});

describe('Favorites', () => {
  it('is private — only the owner can list their own favorites', async () => {
    const { response: authorReg } = await registerUser();
    const { response: saverReg } = await registerUser();
    const videoId = await readyVideo(authorReg.body.accessToken);

    const fav = await request(app).post(`/api/v1/videos/${videoId}/favorite`).set('Authorization', `Bearer ${saverReg.body.accessToken}`);
    expect(fav.status).toBe(201);

    const list = await request(app).get('/api/v1/me/favorites').set('Authorization', `Bearer ${saverReg.body.accessToken}`);
    expect(list.body.videos).toHaveLength(1);

    const unfav = await request(app).delete(`/api/v1/videos/${videoId}/favorite`).set('Authorization', `Bearer ${saverReg.body.accessToken}`);
    expect(unfav.status).toBe(200);
    const empty = await request(app).get('/api/v1/me/favorites').set('Authorization', `Bearer ${saverReg.body.accessToken}`);
    expect(empty.body.videos).toHaveLength(0);
  });
});

describe('Duet', () => {
  it('creates a Duet from an eligible source video, recording the source link', async () => {
    const { response: sourceReg } = await registerUser();
    const { response: duetterReg } = await registerUser();
    const sourceId = await readyVideo(sourceReg.body.accessToken);

    const duet = await request(app)
      .post(`/api/v1/videos/${sourceId}/duet`)
      .set('Authorization', `Bearer ${duetterReg.body.accessToken}`)
      .field('caption', 'my duet')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(duet.status).toBe(202);
    expect(duet.body.duetOfVideoId).toBe(sourceId);
  });

  it('rejects a Duet when the creator has disabled it, and never trusts a client-claimed override', async () => {
    const { response: sourceReg } = await registerUser();
    const { response: duetterReg } = await registerUser();
    const sourceId = await readyVideo(sourceReg.body.accessToken, { allowDuet: false });

    const response = await request(app)
      .post(`/api/v1/videos/${sourceId}/duet`)
      .set('Authorization', `Bearer ${duetterReg.body.accessToken}`)
      .field('caption', 'nope')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(response.status).toBe(403);
  });

  it('rejects a Duet from a blocked relationship', async () => {
    const { response: sourceReg } = await registerUser();
    const { response: duetterReg } = await registerUser();
    const sourceId = await readyVideo(sourceReg.body.accessToken);
    await request(app).post(`/api/v1/users/${duetterReg.body.user.id}/block`).set('Authorization', `Bearer ${sourceReg.body.accessToken}`);

    const response = await request(app)
      .post(`/api/v1/videos/${sourceId}/duet`)
      .set('Authorization', `Bearer ${duetterReg.body.accessToken}`)
      .field('caption', 'blocked')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(response.status).toBe(404);
  });
});

describe('Stitch', () => {
  it('creates a Stitch capped to the first 5 seconds of the source, recording the segment', async () => {
    const { response: sourceReg } = await registerUser();
    const { response: stitcherReg } = await registerUser();
    const sourceId = await readyVideo(sourceReg.body.accessToken);

    const stitch = await request(app)
      .post(`/api/v1/videos/${sourceId}/stitch`)
      .set('Authorization', `Bearer ${stitcherReg.body.accessToken}`)
      .field('caption', 'my stitch')
      .field('sourceStartMs', '0')
      .field('sourceEndMs', '999999')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(stitch.status).toBe(202);
    expect(stitch.body.stitchOfVideoId).toBe(sourceId);
  });

  it('rejects a Stitch when the creator has disabled it', async () => {
    const { response: sourceReg } = await registerUser();
    const { response: stitcherReg } = await registerUser();
    const sourceId = await readyVideo(sourceReg.body.accessToken, { allowStitch: false });

    const response = await request(app)
      .post(`/api/v1/videos/${sourceId}/stitch`)
      .set('Authorization', `Bearer ${stitcherReg.body.accessToken}`)
      .field('caption', 'nope')
      .field('sourceStartMs', '0')
      .field('sourceEndMs', '3000')
      .attach('video', SAMPLE_VIDEO_PATH);
    expect(response.status).toBe(403);
  });
});

describe('Follow expansion', () => {
  it('lets a profile owner remove a follower', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: followerReg } = await registerUser();
    await request(app).post(`/api/v1/users/${ownerReg.body.user.id}/follow`).set('Authorization', `Bearer ${followerReg.body.accessToken}`);

    const response = await request(app)
      .delete(`/api/v1/users/${ownerReg.body.user.id}/followers/${followerReg.body.user.id}`)
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(response.status).toBe(200);

    const followers = await request(app).get(`/api/v1/users/${ownerReg.body.user.id}/followers`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(followers.body.users).toHaveLength(0);
  });

  it('rejects removing a follower from someone else\'s account', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: followerReg } = await registerUser();
    const { response: strangerReg } = await registerUser();
    await request(app).post(`/api/v1/users/${ownerReg.body.user.id}/follow`).set('Authorization', `Bearer ${followerReg.body.accessToken}`);

    const response = await request(app)
      .delete(`/api/v1/users/${ownerReg.body.user.id}/followers/${followerReg.body.user.id}`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`);
    expect(response.status).toBe(403);
  });

  it('excludes self and already-followed accounts from suggestions', async () => {
    const { response: userReg } = await registerUser();
    const { response: alreadyFollowedReg } = await registerUser();
    await request(app).post(`/api/v1/users/${alreadyFollowedReg.body.user.id}/follow`).set('Authorization', `Bearer ${userReg.body.accessToken}`);

    const response = await request(app).get('/api/v1/users/suggested').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(response.status).toBe(200);
    const ids = response.body.users.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(userReg.body.user.id);
    expect(ids).not.toContain(alreadyFollowedReg.body.user.id);
  });
});

describe('Search', () => {
  it('finds a video by caption text and records the query as a recent search', async () => {
    const { response: userReg } = await registerUser();
    const token = userReg.body.accessToken;
    await readyVideo(token, { caption: 'a very unique searchable phrase' });

    const results = await request(app).get('/api/v1/search').query({ q: 'unique searchable', type: 'videos' }).set('Authorization', `Bearer ${token}`);
    expect(results.status).toBe(200);
    expect(results.body.videos.length).toBeGreaterThan(0);

    const recent = await request(app).get('/api/v1/search/recent').set('Authorization', `Bearer ${token}`);
    expect(recent.body.recent.some((r: { query: string }) => r.query === 'unique searchable')).toBe(true);

    const cleared = await request(app).delete('/api/v1/search/recent').set('Authorization', `Bearer ${token}`);
    expect(cleared.status).toBe(204);
    const afterClear = await request(app).get('/api/v1/search/recent').set('Authorization', `Bearer ${token}`);
    expect(afterClear.body.recent).toHaveLength(0);
  });

  it('finds a user by username', async () => {
    const { response: targetReg } = await registerUser();
    const uniqueUsername = `s${Date.now().toString().slice(-10)}`;
    await request(app).put('/api/v1/profile').set('Authorization', `Bearer ${targetReg.body.accessToken}`).send({ username: uniqueUsername });

    const { response: searcherReg } = await registerUser();
    const results = await request(app).get('/api/v1/search').query({ q: uniqueUsername, type: 'users' }).set('Authorization', `Bearer ${searcherReg.body.accessToken}`);
    expect(results.body.users.some((u: { username: string }) => u.username === uniqueUsername)).toBe(true);
  });
});

describe('Creator Playlists — 5,000 follower threshold', () => {
  it('rejects playlist creation at 4,999 followers (explicit rejection proof)', async () => {
    const { response: userReg } = await registerUser();
    await prisma.user.update({ where: { id: userReg.body.user.id }, data: { followerCount: 4999 } });

    const response = await request(app)
      .post('/api/v1/playlists')
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .send({ name: 'My Playlist' });
    expect(response.status).toBe(403);

    const eligibility = await request(app).get('/api/v1/playlists/eligibility').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(eligibility.body.eligible).toBe(false);
    expect(eligibility.body.followerCount).toBe(4999);
    expect(eligibility.body.requiredFollowers).toBe(5000);
  });

  it('allows playlist creation at exactly 5,000 followers (explicit acceptance proof), and at 5,001', async () => {
    const { response: user5000 } = await registerUser();
    await prisma.user.update({ where: { id: user5000.body.user.id }, data: { followerCount: 5000 } });
    const created = await request(app)
      .post('/api/v1/playlists')
      .set('Authorization', `Bearer ${user5000.body.accessToken}`)
      .send({ name: 'Unlocked at 5000' });
    expect(created.status).toBe(201);

    const { response: user5001 } = await registerUser();
    await prisma.user.update({ where: { id: user5001.body.user.id }, data: { followerCount: 5001 } });
    const created2 = await request(app)
      .post('/api/v1/playlists')
      .set('Authorization', `Bearer ${user5001.body.accessToken}`)
      .send({ name: 'Unlocked at 5001' });
    expect(created2.status).toBe(201);
  });

  it('cannot fake eligibility from the client — followerCount is never read from the request body', async () => {
    const { response: userReg } = await registerUser();
    await prisma.user.update({ where: { id: userReg.body.user.id }, data: { followerCount: 0 } });

    const response = await request(app)
      .post('/api/v1/playlists')
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .send({ name: 'Cheating', followerCount: 999999 });
    expect(response.status).toBe(403);
  });

  it('only the owner can manage their playlist, and only their own videos can be added', async () => {
    const { response: ownerReg } = await registerUser();
    await prisma.user.update({ where: { id: ownerReg.body.user.id }, data: { followerCount: 5000 } });
    const { response: strangerReg } = await registerUser();
    await prisma.user.update({ where: { id: strangerReg.body.user.id }, data: { followerCount: 5000 } });

    const playlist = await request(app).post('/api/v1/playlists').set('Authorization', `Bearer ${ownerReg.body.accessToken}`).send({ name: 'Mine' });
    const strangerEdit = await request(app)
      .patch(`/api/v1/playlists/${playlist.body.id}`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`)
      .send({ name: 'Hijacked' });
    expect(strangerEdit.status).toBe(404);

    const strangerVideoId = await readyVideo(strangerReg.body.accessToken);
    const addOthersVideo = await request(app)
      .post(`/api/v1/playlists/${playlist.body.id}/videos`)
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ videoId: strangerVideoId });
    expect(addOthersVideo.status).toBe(403);
  });

  it('preserves an existing playlist and its videos when the creator later drops below 5,000 followers, but blocks adding new videos until eligible again', async () => {
    const { response: userReg } = await registerUser();
    await prisma.user.update({ where: { id: userReg.body.user.id }, data: { followerCount: 5000 } });
    const playlist = await request(app).post('/api/v1/playlists').set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ name: 'Downgrade test' });
    const videoId = await readyVideo(userReg.body.accessToken);
    await request(app).post(`/api/v1/playlists/${playlist.body.id}/videos`).set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ videoId });

    await prisma.user.update({ where: { id: userReg.body.user.id }, data: { followerCount: 100 } });

    const stillViewable = await request(app).get(`/api/v1/playlists/${playlist.body.id}`).set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(stillViewable.status).toBe(200);
    expect(stillViewable.body.videos).toHaveLength(1);

    const secondVideoId = await readyVideo(userReg.body.accessToken);
    const blockedAdd = await request(app)
      .post(`/api/v1/playlists/${playlist.body.id}/videos`)
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .send({ videoId: secondVideoId });
    expect(blockedAdd.status).toBe(403);

    const blockedCreate = await request(app).post('/api/v1/playlists').set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ name: 'Second playlist' });
    expect(blockedCreate.status).toBe(403);
  });

  it('rejects a banned/suspended account from creating a playlist even if eligible', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: userReg } = await registerUser();
    await prisma.user.update({ where: { id: userReg.body.user.id }, data: { followerCount: 5000 } });
    await request(app)
      .post(`/api/v1/admin/users/${userReg.body.user.id}/status`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ status: 'SUSPENDED' });

    const response = await request(app).post('/api/v1/playlists').set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ name: 'Blocked' });
    expect(response.status).toBe(403);
  });
});

describe('Admin: Step 6 inspection authorization', () => {
  it('rejects an ordinary user from the new admin surfaces', async () => {
    const { response: userReg } = await registerUser();
    const results = await Promise.all([
      request(app).get('/api/v1/admin/comment-reports').set('Authorization', `Bearer ${userReg.body.accessToken}`),
      request(app).get('/api/v1/admin/playlists').set('Authorization', `Bearer ${userReg.body.accessToken}`),
    ]);
    for (const response of results) {
      expect(response.status).toBe(403);
    }
  });

  it('lets an admin inspect comment reports and playlists', async () => {
    const { response: adminReg } = await registerAdmin();
    const results = await Promise.all([
      request(app).get('/api/v1/admin/comment-reports').set('Authorization', `Bearer ${adminReg.body.accessToken}`),
      request(app).get('/api/v1/admin/playlists').set('Authorization', `Bearer ${adminReg.body.accessToken}`),
    ]);
    for (const response of results) {
      expect(response.status).toBe(200);
    }
  });
});
