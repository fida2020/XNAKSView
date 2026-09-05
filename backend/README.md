# XNAKView Backend

Node.js + TypeScript REST API. Express, Prisma (PostgreSQL), Redis.

## Structure

```
src/
├── app.ts             # Express app assembly: middleware pipeline + routes
├── server.ts            # Process entrypoint: listen + graceful shutdown
├── config/env.ts          # zod-validated environment config
├── lib/
│   ├── logger.ts             # pino structured logger
│   ├── prisma.ts               # Prisma client singleton + health check
│   ├── redis.ts                  # ioredis client singleton + health check
│   ├── storage.ts                  # StorageDriver abstraction (local disk today)
│   ├── ffmpeg.ts                      # probe/thumbnail/transcode child processes
│   └── videoProcessing.ts               # Orchestrates the video processing pipeline
├── middleware/
│   ├── requestId.ts                 # X-Request-Id assignment/propagation
│   ├── rateLimit.ts                    # express-rate-limit (in-memory + Redis)
│   ├── validate.ts                        # zod request validation helper
│   ├── auth.ts                              # requireAuth: token + live session check
│   ├── upload.ts                              # multer config for video uploads
│   ├── errorHandler.ts                          # Centralized error handling
│   └── notFound.ts                                # 404 fallback
├── schemas/                # zod request-body schemas (auth, profile, video, admin)
├── routes/v1/               # All routes mounted under /api/v1 (health, auth, me, profile, videos, feed, follow, admin)
├── test/                # Vitest setup, shared helpers, fixtures/ (a real sample video)
└── utils/AppError.ts            # Typed operational error
```

See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the full
request lifecycle, database, and security design.

## Running locally

```bash
cp .env.example .env   # fill in real values; never commit .env
npm install
npm run prisma:generate
npm run prisma:migrate   # requires a reachable PostgreSQL — see infrastructure/
npm run dev                # starts on PORT (default 4000)
```

The server starts even if PostgreSQL/Redis are unreachable — dependency
connections are attempted in the background rather than blocking startup.
Check `/api/v1/health` for live per-dependency status:

```bash
curl http://localhost:4000/api/v1/health
```

Video processing requires `ffmpeg`/`ffprobe` on `PATH` (or
`FFMPEG_PATH`/`FFPROBE_PATH` pointing at them) — without it, uploads will
be accepted but every video will end up `FAILED` with a real error
message rather than silently succeeding.

## Database

Prisma schema: `prisma/schema.prisma`. Step 1 defines only foundation/
identity models (User, Profile, Verification, Device, Session) — see
`../docs/ARCHITECTURE.md` §4 for why and how future domains extend it.

```bash
npm run prisma:validate     # schema syntax/relations check, no DB needed
npm run prisma:migrate        # create + apply a migration (dev)
npm run prisma:migrate:deploy   # apply existing migrations (CI/prod)
npm run prisma:studio             # visual DB browser
```

## Verifying

```bash
npm run lint
npx tsc --noEmit
npm run build
npm test    # Vitest + Supertest, against a live Postgres/Redis
npm start   # runs the built dist/server.js
```
