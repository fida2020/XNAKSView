# XNAKView Admin

Next.js (App Router) admin console.

## Structure

```
src/
├── app/
│   ├── (dashboard)/         # Authenticated shell: sidebar + dashboard placeholder
│   │   ├── layout.tsx
│   │   └── dashboard/
│   │       ├── page.tsx      # Dashboard placeholder (reads backend /health)
│   │       ├── loading.tsx    # Loading state
│   │       └── error.tsx       # Error state
│   ├── login/                # Public route (placeholder — Phase 2 builds real auth)
│   └── layout.tsx
├── components/
│   └── sidebar.tsx
├── lib/
│   ├── api-client.ts          # fetch wrapper for the backend API
│   └── auth.ts                 # Session-cookie helpers used by proxy.ts
├── config/env.ts
└── proxy.ts                     # Route protection (Next.js 16 "proxy" convention,
                                   # formerly "middleware")
```

## Auth-ready route protection

`src/proxy.ts` redirects any request without a session cookie to `/login`
(except `/login` itself), and redirects an authenticated visit to `/login`
back to `/dashboard`. There is no real session issuance yet — Phase 2 wires
up actual sign-in and starts setting that cookie. This exists now so the
route-protection shape doesn't need to change later, only what populates the
cookie.

## Running locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Requires the backend running at the URL configured in `.env.local`
(`NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:4000/api/v1`) for the
dashboard's health card to show real data — it degrades gracefully if the
backend is unreachable.

## Verifying

```bash
npm run lint
npx tsc --noEmit
npm run build
```
