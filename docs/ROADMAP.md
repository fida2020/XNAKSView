# XNAKView — Roadmap

This roadmap sequences the full product. Each phase builds on the
foundation established by the phases before it. **Only Phase 1 is
implemented today.**

## Phase 1 — Foundation *(current)*

Monorepo structure; backend bootstrap (Express + TypeScript, Prisma,
Redis, structured logging, centralized error handling, security
middleware, `/api/v1/health`); foundation/identity database models (User,
Profile, Verification, Device, Session); Flutter mobile app skeleton
(Android + iOS, clean architecture, routing, secure storage, theme);
Next.js admin app skeleton (shell, sidebar, auth-ready route protection);
local dev infrastructure definition (Docker Compose for Postgres + Redis);
architecture and roadmap documentation.

## Phase 2 — Authentication / Profile / Verification

Real sign-up/sign-in (email, phone, or both), password hashing, JWT
access/refresh token issuance backed by the `Session` model, session
revocation, device registration backed by the `Device` model, age
verification flow backed by the `Verification` model, profile
creation/edit backed by the `Profile` model, admin console real login.

## Phase 3 — Video Feed

Video upload/storage, feed generation/ranking, likes/comments/shares,
creator profiles, basic content moderation hooks (rules-based, not AI yet).

## Phase 4 — LIVE

Live streaming infrastructure, live chat, viewer counts, live-specific
moderation, stream discovery.

## Phase 5 — Dating / Matching

Match model and matching logic, swipe/like mechanics, preferences and
filters, match-safety features.

## Phase 6 — Chat / Voice / Video Calls

Direct/group messaging (`Message` model), real-time delivery, voice
calls, video calls, call history, block/report integration.

## Phase 7 — Coins / Gifts / Creator Earnings

Virtual currency (`Wallet`, `Coins`), gifting during LIVE/video
(`Gifts`), creator earnings ledger, payout requests (`Withdrawals`).

## Phase 8 — Monetization

Subscriptions/premium tiers, ads integration, promotional/boost
mechanics, pricing experiments.

## Phase 9 — AI Moderation / Fraud

Automated content moderation (image/video/text), fraud detection on
payments and coin flows, abuse/spam detection, integration with the
`Reports`/`Moderation` models.

## Phase 10 — Admin / Analytics

Full admin functionality: user management, content moderation queues,
verification review queues, financial oversight (wallets, payouts),
product analytics dashboards, `Levels`/`Teams` management tooling.

## Phase 11 — Security / Testing

Full security review and hardening pass, penetration testing, load
testing, automated test coverage expansion (unit/integration/e2e) across
backend, mobile, and admin.

## Phase 12 — Production Launch

Production infrastructure provisioning, CI/CD pipelines, monitoring and
alerting, app store submission (iOS App Store + Google Play), phased
rollout.
