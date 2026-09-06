import { randomUUID } from 'crypto';
import path from 'path';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, registerUser } from '@/test/helpers';

const SAMPLE_VOICE_PATH = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'sample-voice.wav');
const TOO_LONG_VOICE_PATH = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'sample-voice-too-long.wav');
const NOT_AUDIO_PATH = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'not-a-video.txt');

/**
 * Real integration tests: every upload here is decoded for real by ffprobe
 * (lib/voiceValidation.ts) — nothing about "is this really audio" or "how
 * long is it" is mocked or trusted from client-supplied fields.
 */
async function acceptedConversation() {
  const { response: aReg } = await registerUser();
  const { response: bReg } = await registerUser();
  const created = await request(app)
    .post('/api/v1/conversations')
    .set('Authorization', `Bearer ${aReg.body.accessToken}`)
    .send({ userId: bReg.body.user.id });
  return { aReg, bReg, conversationId: created.body.id as string };
}

describe('Voice messages', () => {
  it('uploads a real voice message, extracting real duration via ffprobe', async () => {
    const { aReg, conversationId } = await acceptedConversation();

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/voice`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .field('clientMessageId', randomUUID())
      .attach('audio', SAMPLE_VOICE_PATH);

    expect(response.status).toBe(201);
    expect(response.body.type).toBe('VOICE');
    expect(response.body.voiceDurationMs).toBeGreaterThan(1500);
    expect(response.body.voiceDurationMs).toBeLessThan(2500);
    expect(response.body.voiceUrl).toContain(`/messages/${response.body.id}/voice`);
  });

  it('rejects a file that is not actually audio, regardless of extension', async () => {
    const { aReg, conversationId } = await acceptedConversation();

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/voice`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .field('clientMessageId', randomUUID())
      .attach('audio', NOT_AUDIO_PATH);

    expect(response.status).toBe(400);
  });

  it('rejects a voice message exceeding the maximum duration', async () => {
    const { aReg, conversationId } = await acceptedConversation();

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/voice`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .field('clientMessageId', randomUUID())
      .attach('audio', TOO_LONG_VOICE_PATH);

    expect(response.status).toBe(400);
  });

  it('lets a participant play back the voice message, but not a stranger', async () => {
    const { aReg, bReg, conversationId } = await acceptedConversation();
    const sent = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/voice`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .field('clientMessageId', randomUUID())
      .attach('audio', SAMPLE_VOICE_PATH);

    const asRecipient = await request(app).get(`/api/v1/messages/${sent.body.id}/voice`).set('Authorization', `Bearer ${bReg.body.accessToken}`);
    expect(asRecipient.status).toBe(200);
    expect(asRecipient.headers['content-type']).toMatch(/audio/);

    const { response: strangerReg } = await registerUser();
    const asStranger = await request(app).get(`/api/v1/messages/${sent.body.id}/voice`).set('Authorization', `Bearer ${strangerReg.body.accessToken}`);
    expect(asStranger.status).toBe(404);
  });

  it('rejects a voice message when the conversation is blocked', async () => {
    const { aReg, bReg, conversationId } = await acceptedConversation();
    await request(app).post(`/api/v1/users/${bReg.body.user.id}/block`).set('Authorization', `Bearer ${aReg.body.accessToken}`);

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/voice`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .field('clientMessageId', randomUUID())
      .attach('audio', SAMPLE_VOICE_PATH);
    expect(response.status).toBe(403);
  });

  it('is idempotent on retry with the same clientMessageId', async () => {
    const { aReg, conversationId } = await acceptedConversation();
    const clientMessageId = randomUUID();

    const first = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/voice`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .field('clientMessageId', clientMessageId)
      .attach('audio', SAMPLE_VOICE_PATH);
    const retry = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/voice`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .field('clientMessageId', clientMessageId)
      .attach('audio', SAMPLE_VOICE_PATH);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
  });

  it('lets the sender unsend a voice message', async () => {
    const { aReg, bReg, conversationId } = await acceptedConversation();
    const sent = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/voice`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .field('clientMessageId', randomUUID())
      .attach('audio', SAMPLE_VOICE_PATH);

    const deleted = await request(app).delete(`/api/v1/messages/${sent.body.id}`).set('Authorization', `Bearer ${aReg.body.accessToken}`);
    expect(deleted.status).toBe(204);

    const voice = await request(app).get(`/api/v1/messages/${sent.body.id}/voice`).set('Authorization', `Bearer ${bReg.body.accessToken}`);
    expect(voice.status).toBe(404);
  });

  it('can be reported', async () => {
    const { aReg, bReg, conversationId } = await acceptedConversation();
    const sent = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/voice`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .field('clientMessageId', randomUUID())
      .attach('audio', SAMPLE_VOICE_PATH);

    const response = await request(app)
      .post(`/api/v1/messages/${sent.body.id}/report`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ reason: 'OTHER' });
    expect(response.status).toBe(201);
  });
});
