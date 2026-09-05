# XNAKView

**BALOCH SAHAB TECHNOLOGIES (SMC-PRIVATE) LIMITED** · balochsahab.com

Monorepo for the XNAKView platform. This is **Step 3 — Video Platform**,
built on Steps 1-2 (foundation, then auth/profiles): short-form video
upload with real processing (FFmpeg transcoding + thumbnails), a
vertical feed, likes/comments/shares/views, follow/unfollow, and video
reporting — still with no LIVE, dating, chat, calls, coins, gifts,
monetization, ads, or advanced AI built yet. See
[`docs/ROADMAP.md`](docs/ROADMAP.md) for the full phase plan and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how everything fits
together.

## Structure

```
XNAKView/
├── mobile/              # Flutter app — Android + iOS
├── backend/              # Node.js + TypeScript REST API
├── admin/                 # Next.js admin console
├── infrastructure/          # Local dev infra (Docker Compose)
└── docs/                     # Architecture, roadmap, progress notes
```

Each app is self-contained with its own `README.md`, dependency manifest,
and tooling — start there for app-specific detail:

- [`backend/README.md`](backend/README.md)
- [`mobile/README.md`](mobile/README.md)
- [`admin/README.md`](admin/README.md)
- [`infrastructure/README.md`](infrastructure/README.md)

## Prerequisites

| Tool | Used by | Required version |
|---|---|---|
| Node.js + npm | `backend/`, `admin/` | Node 20+ |
| Flutter SDK | `mobile/` | 3.x (stable channel) |
| Android SDK | `mobile/` (Android target) | Installed + licensed via `flutter doctor` |
| Xcode | `mobile/` (iOS target) | macOS only |
| Docker | `infrastructure/` | Optional locally — needed to run Postgres/Redis via Compose |
| PostgreSQL 16 | `backend/` | Via Docker Compose, or a local install |
| Redis 7 | `backend/` | Via Docker Compose, or a local install |
| FFmpeg (`ffmpeg` + `ffprobe`) | `backend/` | Required for video processing — must be on `PATH`, or point `FFMPEG_PATH`/`FFPROBE_PATH` at it |

## Quick start

### 1. Start local infrastructure (Postgres + Redis)

```bash
docker compose -f infrastructure/docker-compose.yml up -d
```

If you don't have Docker, install PostgreSQL 16 and Redis 7 locally instead,
and point `backend/.env` at them.

### 2. Backend

```bash
cd backend
cp .env.example .env      # fill in real values — never commit .env
npm install
npm run prisma:generate
npm run prisma:migrate     # applies the schema to your database
npm run dev                  # http://localhost:4000
curl http://localhost:4000/api/v1/health
```

Try registration and login directly:

```bash
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Str0ng!Passw0rd","dateOfBirth":"1995-01-01"}'

curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Str0ng!Passw0rd"}'
```

Upload a video (replace `$TOKEN` with the `accessToken` from either call
above) and watch it process:

```bash
curl -X POST http://localhost:4000/api/v1/videos \
  -H "Authorization: Bearer $TOKEN" \
  -F "video=@/path/to/a/real/video.mp4" \
  -F "caption=My first video"

# Poll until status leaves PROCESSING:
curl http://localhost:4000/api/v1/videos/<id> -H "Authorization: Bearer $TOKEN"

curl http://localhost:4000/api/v1/feed -H "Authorization: Bearer $TOKEN"
```

### 3. Admin

```bash
cd admin
cp .env.example .env.local
npm install
npm run dev                  # http://localhost:3000
```

### 4. Mobile

```bash
cd mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:4000/api/v1
```

## Verifying everything works

```bash
# Backend
cd backend && npm run lint && npx tsc --noEmit && npm run build && npm test

# Admin
cd admin && npm run lint && npx tsc --noEmit && npm run build

# Mobile
cd mobile && flutter analyze && flutter test
```

## Security notes

- Never commit a real `.env`, `.env.local`, or any file containing secrets
  or credentials — every app's `.gitignore` (plus the root `.gitignore`)
  excludes these; only `.env.example` files are committed.
- Rotate the placeholder JWT secrets in `backend/.env.example` before using
  them anywhere beyond local development.
- See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §5 for the full
  security approach.

## Contact / ownership

BALOCH SAHAB TECHNOLOGIES (SMC-PRIVATE) LIMITED — balochsahab.com
