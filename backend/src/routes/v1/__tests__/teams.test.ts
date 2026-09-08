import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { logTeamActivity } from '@/lib/gamification/teams';
import { prisma } from '@/lib/prisma';
import { app, registerAdmin, registerUser } from '@/test/helpers';

/**
 * Step 11 — LIVE Teams. Real backend, real Postgres, no mocks. Membership/
 * role/target/activity flows are exercised through the real HTTP routes;
 * `logTeamActivity` (the one function real LIVE-end/Gift-receive hooks call)
 * is invoked directly here to simulate those hooks without needing a full
 * LiveKit LIVE session or a funded Gift for every scenario — the same
 * "call the lib function directly" pattern this codebase already uses for
 * unit-style economy tests.
 */

async function createTeamAs(accessToken: string, name = 'The Rockets') {
  return request(app).post('/api/v1/teams').set('Authorization', `Bearer ${accessToken}`).send({ name });
}

async function inviteAndAccept(teamId: string, inviterToken: string, inviteeToken: string, inviteeId: string) {
  const invite = await request(app).post(`/api/v1/teams/${teamId}/invites`).set('Authorization', `Bearer ${inviterToken}`).send({ userId: inviteeId });
  expect(invite.status).toBe(201);
  const accept = await request(app).post(`/api/v1/teams/invites/${invite.body.id}/respond`).set('Authorization', `Bearer ${inviteeToken}`).send({ accept: true });
  expect(accept.status).toBe(200);
  return invite.body;
}

describe('Team creation & membership limits', () => {
  it('makes the creator OWNER, and blocks creating a second team while already active in one', async () => {
    const { response } = await registerUser();
    const create = await createTeamAs(response.body.accessToken);
    expect(create.status).toBe(201);
    expect(create.body.memberCount).toBe(1);

    const detail = await request(app).get(`/api/v1/teams/${create.body.id}`).set('Authorization', `Bearer ${response.body.accessToken}`);
    expect(detail.body.members).toHaveLength(1);
    expect(detail.body.members[0].role).toBe('OWNER');

    const second = await createTeamAs(response.body.accessToken, 'Second Team');
    expect(second.status).toBe(409);
  });
});

describe('Invites & role authorization', () => {
  it('lets an OWNER invite, blocks a plain MEMBER from inviting, and lets a promoted MANAGER invite', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: memberReg } = await registerUser();
    const { response: strangerReg } = await registerUser();
    const team = await createTeamAs(ownerReg.body.accessToken);

    await inviteAndAccept(team.body.id, ownerReg.body.accessToken, memberReg.body.accessToken, memberReg.body.user.id);

    const memberInvites = await request(app)
      .post(`/api/v1/teams/${team.body.id}/invites`)
      .set('Authorization', `Bearer ${memberReg.body.accessToken}`)
      .send({ userId: strangerReg.body.user.id });
    expect(memberInvites.status).toBe(403);

    const promote = await request(app)
      .patch(`/api/v1/teams/${team.body.id}/members/${memberReg.body.user.id}/role`)
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ role: 'MANAGER' });
    expect(promote.status).toBe(200);

    const managerInvites = await request(app)
      .post(`/api/v1/teams/${team.body.id}/invites`)
      .set('Authorization', `Bearer ${memberReg.body.accessToken}`)
      .send({ userId: strangerReg.body.user.id });
    expect(managerInvites.status).toBe(201);
  });

  it('only the OWNER can remove a MANAGER', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: managerReg } = await registerUser();
    const { response: otherManagerReg } = await registerUser();
    const team = await createTeamAs(ownerReg.body.accessToken);

    await inviteAndAccept(team.body.id, ownerReg.body.accessToken, managerReg.body.accessToken, managerReg.body.user.id);
    await request(app).patch(`/api/v1/teams/${team.body.id}/members/${managerReg.body.user.id}/role`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`).send({ role: 'MANAGER' });

    await inviteAndAccept(team.body.id, ownerReg.body.accessToken, otherManagerReg.body.accessToken, otherManagerReg.body.user.id);
    await request(app).patch(`/api/v1/teams/${team.body.id}/members/${otherManagerReg.body.user.id}/role`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`).send({ role: 'MANAGER' });

    const managerRemovesManager = await request(app)
      .delete(`/api/v1/teams/${team.body.id}/members/${otherManagerReg.body.user.id}`)
      .set('Authorization', `Bearer ${managerReg.body.accessToken}`);
    expect(managerRemovesManager.status).toBe(403);

    const ownerRemovesManager = await request(app)
      .delete(`/api/v1/teams/${team.body.id}/members/${otherManagerReg.body.user.id}`)
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(ownerRemovesManager.status).toBe(200);

    const detail = await request(app).get(`/api/v1/teams/${team.body.id}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(detail.body.memberCount).toBe(2); // owner + remaining manager
  });

  it('a declined invite never creates a membership', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: inviteeReg } = await registerUser();
    const team = await createTeamAs(ownerReg.body.accessToken);

    const invite = await request(app).post(`/api/v1/teams/${team.body.id}/invites`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`).send({ userId: inviteeReg.body.user.id });
    const decline = await request(app).post(`/api/v1/teams/invites/${invite.body.id}/respond`).set('Authorization', `Bearer ${inviteeReg.body.accessToken}`).send({ accept: false });
    expect(decline.status).toBe(200);

    const detail = await request(app).get(`/api/v1/teams/${team.body.id}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(detail.body.memberCount).toBe(1);
  });
});

describe('Leaving & ownership transfer', () => {
  it('lets a MEMBER leave freely but blocks the OWNER from leaving without transferring first', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: memberReg } = await registerUser();
    const team = await createTeamAs(ownerReg.body.accessToken);
    await inviteAndAccept(team.body.id, ownerReg.body.accessToken, memberReg.body.accessToken, memberReg.body.user.id);

    const ownerLeaves = await request(app).post(`/api/v1/teams/${team.body.id}/leave`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(ownerLeaves.status).toBe(409);

    const memberLeaves = await request(app).post(`/api/v1/teams/${team.body.id}/leave`).set('Authorization', `Bearer ${memberReg.body.accessToken}`);
    expect(memberLeaves.status).toBe(200);

    const detail = await request(app).get(`/api/v1/teams/${team.body.id}`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(detail.body.memberCount).toBe(1);
  });

  it('transfers ownership: old owner becomes MANAGER, new owner becomes OWNER', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: memberReg } = await registerUser();
    const team = await createTeamAs(ownerReg.body.accessToken);
    await inviteAndAccept(team.body.id, ownerReg.body.accessToken, memberReg.body.accessToken, memberReg.body.user.id);

    const transfer = await request(app)
      .post(`/api/v1/teams/${team.body.id}/transfer-ownership`)
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ newOwnerId: memberReg.body.user.id });
    expect(transfer.status).toBe(200);

    const detail = await request(app).get(`/api/v1/teams/${team.body.id}`).set('Authorization', `Bearer ${memberReg.body.accessToken}`);
    const roles = Object.fromEntries(detail.body.members.map((m: { userId: string; role: string }) => [m.userId, m.role]));
    expect(roles[memberReg.body.user.id]).toBe('OWNER');
    expect(roles[ownerReg.body.user.id]).toBe('MANAGER');

    // The old owner can now leave freely — no longer the OWNER.
    const oldOwnerLeaves = await request(app).post(`/api/v1/teams/${team.body.id}/leave`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(oldOwnerLeaves.status).toBe(200);
  });
});

describe('Team targets, activity, and fraud exclusion', () => {
  it('advances a target from real activity and marks it COMPLETED, notifying leadership', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: hostReg } = await registerUser();
    const team = await createTeamAs(ownerReg.body.accessToken);
    await inviteAndAccept(team.body.id, ownerReg.body.accessToken, hostReg.body.accessToken, hostReg.body.user.id);

    const periodStart = new Date(Date.now() - 60_000).toISOString();
    const periodEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const target = await request(app)
      .post(`/api/v1/teams/${team.body.id}/targets`)
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ metric: 'LIVE_HOURS', targetValue: 30, periodStart, periodEnd });
    expect(target.status).toBe(201);

    await logTeamActivity(hostReg.body.user.id, 'LIVE_HOURS_LOGGED', 20);
    const midway = await request(app).get(`/api/v1/teams/${team.body.id}/targets`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(midway.body.targets[0].currentValue).toBe(20);
    expect(midway.body.targets[0].status).toBe('ACTIVE');

    await logTeamActivity(hostReg.body.user.id, 'LIVE_HOURS_LOGGED', 15);
    const completed = await request(app).get(`/api/v1/teams/${team.body.id}/targets`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(completed.body.targets[0].status).toBe('COMPLETED');
    expect(completed.body.targets[0].currentValue).toBe(35);

    const notification = await prisma.gamificationNotification.findFirst({ where: { userId: ownerReg.body.user.id, type: 'TEAM_TARGET_COMPLETED' } });
    expect(notification).not.toBeNull();

    const activity = await request(app).get(`/api/v1/teams/${team.body.id}/activity`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(activity.body.activity.length).toBeGreaterThan(0);
  });

  it('records fraud-held activity for audit but never counts it toward a target', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: hostReg } = await registerUser();
    const team = await createTeamAs(ownerReg.body.accessToken);
    await inviteAndAccept(team.body.id, ownerReg.body.accessToken, hostReg.body.accessToken, hostReg.body.user.id);
    await prisma.fraudHold.create({ data: { userId: hostReg.body.user.id, reason: 'test', createdById: null } });

    const target = await request(app)
      .post(`/api/v1/teams/${team.body.id}/targets`)
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ metric: 'LIVE_HOURS', targetValue: 10, periodStart: new Date(Date.now() - 60_000).toISOString(), periodEnd: new Date(Date.now() + 3_600_000).toISOString() });

    await logTeamActivity(hostReg.body.user.id, 'LIVE_HOURS_LOGGED', 50);

    const targets = await request(app).get(`/api/v1/teams/${team.body.id}/targets`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(targets.body.targets.find((t: { id: string }) => t.id === target.body.id).currentValue).toBe(0);

    // The public activity feed excludes fraud-held entries entirely.
    const activity = await request(app).get(`/api/v1/teams/${team.body.id}/activity`).set('Authorization', `Bearer ${ownerReg.body.accessToken}`);
    expect(activity.body.activity.some((a: { type: string; value: number }) => a.type === 'LIVE_HOURS_LOGGED' && a.value === 50)).toBe(false);

    const rawEntry = await prisma.teamActivityEntry.findFirst({ where: { teamId: team.body.id, type: 'LIVE_HOURS_LOGGED', value: 50 } });
    expect(rawEntry?.excludedAsFraud).toBe(true); // still recorded, for audit
  });
});

describe('Team leaderboard', () => {
  it('ranks teams by aggregated real activity via an admin recompute', async () => {
    const { response: ownerReg } = await registerUser();
    const { response: hostReg } = await registerUser();
    const team = await createTeamAs(ownerReg.body.accessToken, 'Leaderboard Team');
    await inviteAndAccept(team.body.id, ownerReg.body.accessToken, hostReg.body.accessToken, hostReg.body.user.id);

    await logTeamActivity(hostReg.body.user.id, 'GIFT_RECEIVED', 500);

    const { response: adminReg } = await registerAdmin();
    const recompute = await request(app)
      .post('/api/v1/admin/gamification/leaderboards/recompute')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ type: 'TEAM_PERFORMANCE', period: 'ALL_TIME' });
    expect(recompute.status).toBe(200);

    const board = await request(app).get('/api/v1/teams/leaderboard').set('Authorization', `Bearer ${ownerReg.body.accessToken}`).query({ period: 'ALL_TIME' });
    expect(board.status).toBe(200);
    const entry = board.body.entries.find((e: { team: { id: string } | null }) => e.team?.id === team.body.id);
    expect(entry).toBeDefined();
    expect(Number(entry.score)).toBe(50); // GIFT_RECEIVED contributes floor(coins/10) points
  });
});
