# Dashboard Web Personal

## Overview

A full-stack personal executive dashboard for an Argentine contador/consultor in Neuquén. Built with React + Vite + TypeScript on the frontend and Express + Node.js on the backend, using PostgreSQL via Drizzle ORM. At v4 with: dollar quotes widget (dolarapi.com), Kanban tasks board, news source filtering, fiscal table/card view toggle, data quality hardening, and expanded admin panel.

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
- `/dashboard` — Executive summary with widget cards (includes dollar widget)
- `/dashboard/tasks` — Kanban board (Pendiente / En progreso / Terminado)
- `/dashboard/shortcuts` — Quick access shortcuts (CRUD)
- `/dashboard/news` — News feed with category + source filters
- `/dashboard/emails` — Email inbox (Gmail OAuth or mock)
- `/dashboard/weather` — 3-day weather forecast for Neuquén (Open-Meteo)
- `/dashboard/fiscal` — Monitor Fiscal with card/table view toggle + quality filters
- `/dashboard/travel` — Travel offers browser (with quality scoring)
- `/admin` — Admin panel (users, integrations, sync logs, discard logs)
- `/settings` — Dashboard configuration

### Backend (artifacts/api-server)

Routes under `/api`:
- `/api/healthz` — Health check
- `/api/dashboard/summary` — Dashboard overview
- `/api/tasks` — Task CRUD
- `/api/shortcuts` — Shortcuts CRUD
- `/api/fiscal` + `/api/fiscal/metrics` + `/api/fiscal/saved` + `/api/fiscal/discards` — Fiscal monitor
- `/api/fiscal/refresh` — Manual fiscal data refresh
- `/api/travel` — Travel offers + `/api/travel/quality`
- `/api/news` + `/api/news/sources` — News articles (RSS + DB cache)
- `/api/news/refresh` — Manual news refresh
- `/api/emails` + `/api/emails/stats` + `/api/emails/oauth/*` — Email data
- `/api/weather` — Weather forecast (Open-Meteo)
- `/api/settings` — App settings
- `/api/users` + `/api/users/me` — User management
- `/api/currency` — Dollar quotes (dolarapi.com: Blue, MEP, Cripto, Oficial)
- `/api/sync/status` + `/api/sync/logs` — Sync status and logs

### Database (lib/db)

Tables: `users`, `tasks`, `shortcuts`, `fiscal_updates`, `travel_offers`, `app_settings`, `news_items`, `weather_snapshots`, `sync_logs`, `discard_logs`, `email_connections`, `currency_rates`, `data_sources`

## Active RSS Sources

### News (6 active / 6 disabled)

Active: Ámbito, La Nación, Diario Río Negro, Clarín, Tributum, Contadores en Red

Disabled (blocked/HTML): El Cronista, Infobae, LM Neuquén, AFIP, iProfesional, Página 12

### Fiscal (3 active / 4 disabled)

Active: Ámbito Financiero, Tributum, Contadores en Red

Disabled: AFIP (404), Boletín Oficial (SPA), El Cronista (HTML)

## Key Developer Notes

- **Logger**: named export `import { logger } from "../lib/logger.js"` — NOT default.
- **DB dist rebuild**: `cd lib/db && npx tsc --build` → `cd lib/api-zod && npx tsc --build --force` → `cd lib/api-client-react && npx tsc --build --force`. Then `npx drizzle-kit push --force`.
- **Dashboard resolves types** from `lib/api-client-react/src/generated/api.schemas.ts` — must be manually updated when adding fields. After editing, rebuild api-client-react.
- **api-zod index**: only export from `./generated/api`, NOT `./generated/types` (causes duplicate name conflicts).
- **travelOffersTable.price** is PostgreSQL `numeric` → comes as string → must cast with `Number(price)`.
- **Currency service**: Uses `await res.json() as unknown` then casts to `Record<string, unknown>`.
- **News limit logic**: `limit > 20` bypasses newsCount setting cap (used for source filtering with limit=200).
- **Default quality threshold**: 40 in `data-quality.service.ts`.
- **Gmail OAuth**: requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` env vars. Without them, emails page shows mock data.

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
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Gmail OAuth (optional)

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
- **UI**: quality score badge (green/amber/red) on each fiscal card and travel card; quality threshold slider; discard log in Admin → Sincronización tab

## V4 Features (completed)

- **Dollar widget**: `currency_rates` table, `currency.service.ts` fetching dolarapi.com; dashboard home card with Blue/MEP/Cripto/Oficial rates
- **Kanban board**: Tasks page transformed to 3-column board (Pendiente/En progreso/Terminado) with click-to-move, dropdown menus, search+priority filter, overdue highlighting
- **News expansion**: 12 sources configured (6 active), source filter chips in UI, limit bypass for source filtering
- **Fiscal table view**: card/table toggle with keyboard shortcut (`T`), same filters apply to both views
- **`data_sources` table**: added to DB schema
