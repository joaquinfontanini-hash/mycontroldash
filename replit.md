# Dashboard Web Personal

## Overview

A full-stack personal executive dashboard for an Argentine contador/consultor in Neuquén. Built with React + Vite + TypeScript on the frontend and Express + Node.js on the backend, using PostgreSQL via Drizzle ORM. v2 features global search (Cmd+K), functional dark/light mode, advanced fiscal filters, full settings persistence, tabbed admin panel with integration status, inline form validation, and elegant empty states.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + TypeScript + Tailwind CSS
- **UI Components**: shadcn/ui + Radix UI + Framer Motion
- **Backend**: Express 5 + Node.js
- **Database**: PostgreSQL + Drizzle ORM
- **Authentication**: Clerk (Google OAuth + email/password)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Application Structure

### Frontend (artifacts/dashboard)

- `/` — Landing page (redirects to /dashboard if signed in)
- `/sign-in` — Clerk sign-in page
- `/sign-up` — Clerk sign-up page
- `/dashboard` — Executive summary with widget cards
- `/dashboard/tasks` — Task management (CRUD)
- `/dashboard/shortcuts` — Quick access shortcuts (CRUD)
- `/dashboard/news` — News feed with category filters
- `/dashboard/emails` — Email inbox
- `/dashboard/weather` — 3-day weather forecast for Neuquén
- `/dashboard/fiscal` — Monitor Fiscal (filterable fiscal updates)
- `/dashboard/travel` — Travel offers browser
- `/admin` — Admin panel (user management, system settings)
- `/settings` — Dashboard configuration

### Backend (artifacts/api-server)

Routes under `/api`:
- `/api/healthz` — Health check
- `/api/dashboard/summary` — Dashboard overview
- `/api/tasks` — Task CRUD
- `/api/shortcuts` — Shortcuts CRUD
- `/api/fiscal` + `/api/fiscal/metrics` + `/api/fiscal/saved` — Fiscal monitor
- `/api/travel` — Travel offers
- `/api/news` — News articles (mock)
- `/api/emails` + `/api/emails/stats` — Email data (mock)
- `/api/weather` — Weather forecast (mock)
- `/api/settings` — App settings
- `/api/users` + `/api/users/me` — User management

### Database (lib/db)

Tables: `users`, `tasks`, `shortcuts`, `fiscal_updates`, `travel_offers`, `app_settings`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/dashboard run dev` — run frontend locally

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned)
- `CLERK_SECRET_KEY` — Clerk secret key (auto-provisioned)
- `CLERK_PUBLISHABLE_KEY` — Clerk publishable key (auto-provisioned)
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key for frontend (auto-provisioned)
- `SESSION_SECRET` — Session secret

## Authentication

Uses Clerk authentication with support for Google OAuth. User roles: admin, editor, viewer.
- Admin can manage users (activate/deactivate, change roles)
- All dashboard routes require authentication

## Data Quality System (v3)

Added quality scoring (0-100) to fiscal updates and travel offers:
- **`data-quality.service.ts`**: scoring rules for both domains (URL validity, date validation, title length, price sanity, expiry check)
- **Fiscal rules**: -30 missing source URL, -20 invalid URL format, -30 invalid date, -20 short title, -15 duplicate/short summary
- **Travel rules**: -40 zero/null price, -30 invalid URL, -20 expired offer, -20 invalid duration
- **Discard threshold**: 40 (configurable via `DEFAULT_QUALITY_THRESHOLD`)
- **DB columns added**: `qualityScore integer`, `qualityIssues text (JSON)`, `needsReview boolean`, `isHidden boolean` on both tables
- **`discard_logs` table**: stores every auto-discarded item with module, source, title, URL, and reason
- **New endpoints**: `GET /api/fiscal/discards`, `GET /api/travel/quality`, `POST /api/travel/score-all`
- **UI**: quality score badge (green/amber/red) on each fiscal card and travel card; needsReview warning indicator; issues list; quality threshold slider in advanced filters; warning strip showing counts; discard log in Admin → Sincronización tab

## Connecting Real APIs (Future)

- **News**: Replace mock data in `artifacts/api-server/src/routes/news.ts` with RSS/API fetch
- **Emails**: Integrate Gmail API or Microsoft Graph API, replace mock in `emails.ts`
- **Weather**: Integrate OpenWeatherMap or similar API, replace mock in `weather.ts`
- **Fiscal**: Add scraping/API layer that inserts to `fiscal_updates` table
- **Travel**: Connect to travel provider APIs (Despegar, Almundo, etc.)
