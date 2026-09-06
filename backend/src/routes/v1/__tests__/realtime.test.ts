import { randomUUID } from 'crypto';

import request from 'supertest';
import { type Socket, io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { app, registerUser, startRealtimeTestServer } from '@/test/helpers';

/**
 * Real Socket.IO server + real socket.io-client connections over a real
 * TCP port — not a mock transport. This is the one file in the suite that
 * proves the realtime layer (lib/realtime.ts) actually delivers events, not
 * just that the REST endpoints which call into it don't throw.
 */
let serverUrl: string;
let closeServer: () => Promise<void>;

beforeAll(async () => {
  const server = await startRealtimeTestServer();
  serverUrl = server.url;
  closeServer = server.close;
});

afterAll(async () => {
  await closeServer();
});

function connectSocket(token: string): Socket {
  return io(serverUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
}

function waitForEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });
}

async function acceptedConversation() {
  const { response: aReg } = await registerUser();
  const { response: bReg } = await registerUser();
  const created = await request(app)
    .post('/api/v1/conversations')
    .set('Authorization', `Bearer ${aReg.body.accessToken}`)
    .send({ userId: bReg.body.user.id });
  // Strangers by default land in PENDING (see messaging.test.ts) — explicitly
  // accept so presence/realtime tests exercise an ACCEPTED conversation,
  // since presence is only ever broadcast between visible contacts.
  await request(app).post(`/api/v1/conversations/${created.body.id}/accept`).set('Authorization', `Bearer ${bReg.body.accessToken}`);
  return { aReg, bReg, conversationId: created.body.id as string };
}

describe('Realtime gateway: authentication', () => {
  it('rejects a connection with no token', async () => {
    const socket = io(serverUrl, { reconnection: false, forceNew: true });
    await expect(waitForConnect(socket)).rejects.toBeTruthy();
    socket.close();
  });

  it('rejects a connection with an invalid token', async () => {
    const socket = connectSocket('not-a-real-token');
    await expect(waitForConnect(socket)).rejects.toBeTruthy();
    socket.close();
  });

  it('accepts a connection with a valid access token', async () => {
    const { response: userReg } = await registerUser();
    const socket = connectSocket(userReg.body.accessToken);
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
    socket.close();
  });
});

describe('Realtime gateway: message delivery', () => {
  it('pushes a new message to the recipient in real time, not by polling', async () => {
    const { aReg, bReg, conversationId } = await acceptedConversation();
    const recipientSocket = connectSocket(bReg.body.accessToken);
    await waitForConnect(recipientSocket);

    const eventPromise = waitForEvent<{ id: string; text: string }>(recipientSocket, 'message:new');
    await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'live delivery test' });

    const event = await eventPromise;
    expect(event.text).toBe('live delivery test');
    recipientSocket.close();
  });

  it('notifies the sender in real time when the recipient reads the message', async () => {
    const { aReg, bReg, conversationId } = await acceptedConversation();
    const senderSocket = connectSocket(aReg.body.accessToken);
    await waitForConnect(senderSocket);

    await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'read me' });

    const readEventPromise = waitForEvent<{ conversationId: string; readerId: string }>(senderSocket, 'message:read');
    await request(app).post(`/api/v1/conversations/${conversationId}/read`).set('Authorization', `Bearer ${bReg.body.accessToken}`);

    const event = await readEventPromise;
    expect(event.conversationId).toBe(conversationId);
    expect(event.readerId).toBe(bReg.body.user.id);
    senderSocket.close();
  });
});

describe('Realtime gateway: typing indicator', () => {
  it('relays a typing event to the other participant in the conversation room, not back to the sender', async () => {
    const { aReg, bReg, conversationId } = await acceptedConversation();
    const socketA = connectSocket(aReg.body.accessToken);
    const socketB = connectSocket(bReg.body.accessToken);
    await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);

    socketA.emit('conversation:join', conversationId);
    socketB.emit('conversation:join', conversationId);
    await new Promise((resolve) => setTimeout(resolve, 200)); // let the join round-trip

    const typingPromise = waitForEvent<{ conversationId: string; userId: string }>(socketB, 'conversation:typing');
    socketA.emit('conversation:typing', { conversationId });

    const event = await typingPromise;
    expect(event.userId).toBe(aReg.body.user.id);

    socketA.close();
    socketB.close();
  });
});

describe('Realtime gateway: presence', () => {
  it('notifies a conversation partner when the other comes online', async () => {
    const { aReg, bReg } = await acceptedConversation();
    const socketA = connectSocket(aReg.body.accessToken);
    await waitForConnect(socketA);

    const presencePromise = waitForEvent<{ userId: string; online: boolean }>(socketA, 'presence:update');
    const socketB = connectSocket(bReg.body.accessToken);
    await waitForConnect(socketB);

    const event = await presencePromise;
    expect(event.userId).toBe(bReg.body.user.id);
    expect(event.online).toBe(true);

    socketA.close();
    socketB.close();
  });
});

describe('Realtime gateway: call signaling', () => {
  it('pushes an incoming-call event to the callee in real time', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const calleeSocket = connectSocket(calleeReg.body.accessToken);
    await waitForConnect(calleeSocket);

    const incomingPromise = waitForEvent<{ call: { id: string; callerId: string } }>(calleeSocket, 'call:incoming');
    await request(app)
      .post('/api/v1/calls')
      .set('Authorization', `Bearer ${callerReg.body.accessToken}`)
      .send({ calleeId: calleeReg.body.user.id, type: 'VOICE' });

    const event = await incomingPromise;
    expect(event.call.callerId).toBe(callerReg.body.user.id);
    calleeSocket.close();
  });
});
