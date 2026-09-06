import type { Conversation, MessagePermission } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { fetchAuthorSummaries, type AuthorSummary } from '@/lib/videoAccess';
import { isOnline } from '@/lib/realtime';
import { AppError } from '@/utils/AppError';

/** Always [smaller, larger] by string comparison — the normalization that makes the 1:1 conversation unique constraint work regardless of who initiated. */
export function normalizePair(userIdA: string, userIdB: string): [string, string] {
  return userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
}

export async function isBlockedEitherDirection(userIdA: string, userIdB: string): Promise<boolean> {
  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userIdA, blockedId: userIdB },
        { blockerId: userIdB, blockedId: userIdA },
      ],
    },
    select: { id: true },
  });
  return Boolean(block);
}

async function isMutualFollow(userIdA: string, userIdB: string): Promise<boolean> {
  const [aFollowsB, bFollowsA] = await Promise.all([
    prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userIdA, followingId: userIdB } } }),
    prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userIdB, followingId: userIdA } } }),
  ]);
  return Boolean(aFollowsB) && Boolean(bFollowsA);
}

export interface MessageEligibility {
  allowed: boolean;
  /** true when the message should land as a request the recipient must accept, rather than an immediately-visible conversation. */
  isRequest: boolean;
}

/**
 * Whether `senderId` may start (or continue) contact with `recipientId`,
 * per the recipient's own `whoCanMessage` setting — checked when a NEW
 * conversation is created, not on every message (see the model's own
 * comment in schema.prisma for why). Blocking is checked first and
 * overrides everything: a block always means "not allowed," never "request."
 */
export async function checkMessageEligibility(senderId: string, recipientId: string): Promise<MessageEligibility> {
  if (await isBlockedEitherDirection(senderId, recipientId)) {
    return { allowed: false, isRequest: false };
  }

  const settings = await prisma.messagingPrivacySettings.findUnique({ where: { userId: recipientId } });
  const permission: MessagePermission = settings?.whoCanMessage ?? 'MUTUAL_FOLLOWERS';

  if (permission === 'NO_ONE') {
    return { allowed: false, isRequest: false };
  }
  if (permission === 'EVERYONE') {
    return { allowed: true, isRequest: false };
  }

  // MUTUAL_FOLLOWERS: immediate if mutual, otherwise a message request.
  const mutual = await isMutualFollow(senderId, recipientId);
  return { allowed: true, isRequest: !mutual };
}

/**
 * Finds the existing 1:1 conversation between two users, or creates one —
 * this is "conversation creation/reuse." Never creates a second conversation
 * for the same pair (enforced by the normalized-pair unique constraint, not
 * just an application-level check).
 */
export async function findOrCreateConversation(initiatorId: string, otherUserId: string): Promise<Conversation> {
  if (initiatorId === otherUserId) {
    throw new AppError('BAD_REQUEST', 'You cannot start a conversation with yourself');
  }

  const otherUser = await prisma.user.findUnique({ where: { id: otherUserId }, select: { id: true, status: true } });
  if (!otherUser || otherUser.status !== 'ACTIVE') {
    // Deliberately the same NOT_FOUND a genuinely-missing id gets — an
    // inactive/deleted account shouldn't be distinguishable from one that
    // never existed to an arbitrary caller.
    throw new AppError('NOT_FOUND', 'User not found');
  }

  const [participantOneId, participantTwoId] = normalizePair(initiatorId, otherUserId);
  const existing = await prisma.conversation.findUnique({
    where: { participantOneId_participantTwoId: { participantOneId, participantTwoId } },
  });
  if (existing) return existing;

  const eligibility = await checkMessageEligibility(initiatorId, otherUserId);
  if (!eligibility.allowed) {
    throw new AppError('FORBIDDEN', 'You cannot message this user right now');
  }

  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: {
        participantOneId,
        participantTwoId,
        initiatedById: initiatorId,
        status: eligibility.isRequest ? 'PENDING' : 'ACCEPTED',
      },
    });
    await tx.conversationParticipant.createMany({
      data: [
        { conversationId: conversation.id, userId: initiatorId },
        { conversationId: conversation.id, userId: otherUserId },
      ],
    });
    return conversation;
  });
}

/** IDOR guard: returns NOT_FOUND (never FORBIDDEN) for a conversation that exists but isn't this user's — a non-participant shouldn't be able to distinguish "not mine" from "doesn't exist." */
export async function loadConversationForParticipant(conversationId: string, userId: string): Promise<Conversation> {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || (conversation.participantOneId !== userId && conversation.participantTwoId !== userId)) {
    throw new AppError('NOT_FOUND', 'Conversation not found');
  }
  return conversation;
}

export function otherParticipantId(conversation: Conversation, userId: string): string {
  return conversation.participantOneId === userId ? conversation.participantTwoId : conversation.participantOneId;
}

export interface ConversationSummary {
  id: string;
  status: string;
  otherUser?: AuthorSummary;
  unreadCount: number;
  muted: boolean;
  pinned: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdAt: string;
}

/** Batch-serializes conversations for a list view — one query per relation, not N. */
export async function serializeConversations(
  conversations: (Conversation & { lastMessage: { text: string | null; type: string; deletedAt: Date | null } | null })[],
  viewerId: string,
): Promise<ConversationSummary[]> {
  const otherIds = conversations.map((c) => otherParticipantId(c, viewerId));
  const [authors, myParticipantRows] = await Promise.all([
    fetchAuthorSummaries(otherIds),
    prisma.conversationParticipant.findMany({
      where: { conversationId: { in: conversations.map((c) => c.id) }, userId: viewerId },
    }),
  ]);
  const myRowByConversation = new Map(myParticipantRows.map((row) => [row.conversationId, row]));

  return conversations.map((conversation) => {
    const myRow = myRowByConversation.get(conversation.id);
    const preview = conversation.lastMessage
      ? conversation.lastMessage.deletedAt
        ? 'Message deleted'
        : conversation.lastMessage.type === 'VOICE'
          ? 'Voice message'
          : (conversation.lastMessage.text ?? '')
      : null;
    return {
      id: conversation.id,
      status: conversation.status,
      otherUser: authors.get(otherParticipantId(conversation, viewerId)),
      unreadCount: myRow?.unreadCount ?? 0,
      muted: myRow?.muted ?? false,
      pinned: myRow?.pinned ?? false,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: preview,
      createdAt: conversation.createdAt.toISOString(),
    };
  });
}

export async function serializeConversationDetail(conversation: Conversation, viewerId: string) {
  const otherId = otherParticipantId(conversation, viewerId);
  const [authors, myRow, online] = await Promise.all([
    fetchAuthorSummaries([otherId]),
    prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId: viewerId } },
    }),
    isOnline(otherId),
  ]);
  const otherSettings = await prisma.messagingPrivacySettings.findUnique({ where: { userId: otherId } });
  const showActivity = otherSettings?.showActivityStatus ?? true;
  const otherUserRecord = showActivity ? await prisma.user.findUnique({ where: { id: otherId }, select: { lastActiveAt: true } }) : null;

  return {
    id: conversation.id,
    status: conversation.status,
    otherUser: authors.get(otherId),
    unreadCount: myRow?.unreadCount ?? 0,
    muted: myRow?.muted ?? false,
    pinned: myRow?.pinned ?? false,
    createdAt: conversation.createdAt.toISOString(),
    presence: showActivity ? { online, lastActiveAt: otherUserRecord?.lastActiveAt?.toISOString() ?? null } : null,
  };
}

export function serializeMessage(message: {
  id: string;
  conversationId: string;
  senderId: string;
  type: string;
  text: string | null;
  voiceKey: string | null;
  voiceDurationMs: number | null;
  clientMessageId: string;
  deletedAt: Date | null;
  createdAt: Date;
  receipts?: { userId: string; deliveredAt: Date | null; readAt: Date | null }[];
}) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    type: message.type,
    text: message.deletedAt ? null : message.text,
    voiceUrl: message.deletedAt || !message.voiceKey ? null : `/api/v1/messages/${message.id}/voice`,
    voiceDurationMs: message.deletedAt ? null : message.voiceDurationMs,
    clientMessageId: message.clientMessageId,
    deleted: Boolean(message.deletedAt),
    createdAt: message.createdAt.toISOString(),
    receipts: (message.receipts ?? []).map((r) => ({
      userId: r.userId,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      readAt: r.readAt?.toISOString() ?? null,
    })),
  };
}
