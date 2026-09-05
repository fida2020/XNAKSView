# Infrastructure

Local development infrastructure only, at this stage.

## Contents

- `docker-compose.yml` — PostgreSQL 16 + Redis 7 for local backend development.

## Status

**Docker is not installed** on the machine this was authored on (no `docker`
CLI, no Docker Desktop). This compose file has been written to match
`backend/.env.example` but has **not** been started or tested. Once Docker is
available:

```bash
docker compose -f infrastructure/docker-compose.yml up -d
docker compose -f infrastructure/docker-compose.yml ps
```

Then, from `backend/`, run the Prisma migration against the now-running
database:

```bash
npm run prisma:migrate
```

## Future additions

As later phases land, this directory is where local dev infra for those
phases will live too (e.g. object storage emulation for media uploads, a
message broker if async job processing is introduced). Nothing beyond
PostgreSQL + Redis is needed for Step 1.
