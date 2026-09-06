import { randomUUID } from 'crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, registerAdmin, registerUser } from '@/test/helpers';

/**
 * Step 5 admin inspection surfaces reuse the same `requireAdmin` gate wired
 * router-wide in Step 4 (routes/v1/admin.ts). These tests exist because that
 * gate is easy to forget on a newly-added route — confirmed here per-route,
 * not just asserted from the shared `adminRouter.use(...)` line.
 */
async function acceptedConversation() {
  const { response: aReg } = await registerUser();
  const { response: bReg } = await registerUser();
  const created = await request(app)
    .post('/api/v1/conversations')
    .set('Authorization', `Bearer ${aReg.body.accessToken}`)
    .send({ userId: bReg.body.user.id });
  await request(app).post(`/api/v1/conversations/${created.body.id}/accept`).set('Authorization', `Bearer ${bReg.body.accessToken}`);
  return { aReg, bReg, conversationId: created.body.id as string };
}

describe('Admin: Step 5 messaging/call inspection authorization', () => {
  it('rejects an ordinary user from every Step 5 admin surface', async () => {
    const { response: userReg } = await registerUser();
    const auth = { Authorization: `Bearer ${userReg.body.accessToken}` };

    const responses = await Promise.all([
      request(app).get('/api/v1/admin/conversations').set(auth),
      request(app).get('/api/v1/admin/message-reports').set(auth),
      request(app).get('/api/v1/admin/conversation-reports').set(auth),
      request(app).get('/api/v1/admin/call-reports').set(auth),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(403);
    }
  });

  it('lets an admin inspect conversations, message reports, conversation reports, and call reports', async () => {
    const { response: adminReg } = await registerAdmin();
    const { aReg, bReg, conversationId } = await acceptedConversation();

    const sent = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'reportable content' });
    await request(app)
      .post(`/api/v1/messages/${sent.body.id}/report`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ reason: 'HARASSMENT_OR_BULLYING' });
    await request(app)
      .post(`/api/v1/conversations/${conversationId}/report`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ reason: 'SPAM' });

    const initiated = await request(app)
      .post('/api/v1/calls')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ calleeId: bReg.body.user.id, type: 'VOICE' });
    await request(app).post(`/api/v1/calls/${initiated.body.call.id}/cancel`).set('Authorization', `Bearer ${aReg.body.accessToken}`);
    await request(app)
      .post(`/api/v1/calls/${initiated.body.call.id}/report`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ reason: 'OTHER' });

    const adminAuth = { Authorization: `Bearer ${adminReg.body.accessToken}` };

    const conversations = await request(app).get('/api/v1/admin/conversations').set(adminAuth);
    expect(conversations.status).toBe(200);
    expect(conversations.body.conversations.some((c: { id: string }) => c.id === conversationId)).toBe(true);

    const conversationDetail = await request(app).get(`/api/v1/admin/conversations/${conversationId}`).set(adminAuth);
    expect(conversationDetail.status).toBe(200);
    expect(conversationDetail.body.reports.length).toBeGreaterThan(0);

    const messageReports = await request(app).get('/api/v1/admin/message-reports').set(adminAuth);
    expect(messageReports.status).toBe(200);
    expect(messageReports.body.reports.some((r: { messageId: string }) => r.messageId === sent.body.id)).toBe(true);

    const conversationReports = await request(app).get('/api/v1/admin/conversation-reports').set(adminAuth);
    expect(conversationReports.status).toBe(200);
    expect(conversationReports.body.reports.length).toBeGreaterThan(0);

    const callReports = await request(app).get('/api/v1/admin/call-reports').set(adminAuth);
    expect(callReports.status).toBe(200);
    expect(callReports.body.reports.some((r: { callId: string }) => r.callId === initiated.body.call.id)).toBe(true);
  });

  it('404s admin conversation detail for a nonexistent conversation', async () => {
    const { response: adminReg } = await registerAdmin();
    const response = await request(app)
      .get('/api/v1/admin/conversations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`);
    expect(response.status).toBe(404);
  });
});
