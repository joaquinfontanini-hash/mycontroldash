# Dashboard Web Personal

## Overview

A full-stack personal executive dashboard for an Argentine contador/consultor in Neuquén. Built with React + Vite + TypeScript on the frontend and Express + Node.js on the backend, using PostgreSQL via Drizzle ORM. At v5 with: dollar quotes widget (dolarapi.com), Kanban tasks board, news source filtering + deduplication + Tributum filtering, fiscal table/card view toggle, data quality hardening, Vencimientos (due dates) module, and external file sources registry.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + TypeScript + Tailwind CSS
- **UI Components**: shadcn/ui + Radix UI + Framer Motion
- **Backend**: Express 5 + Node.js
- **Database**: PostgreSQL + Drizzle ORM
- **Authentication**: Dual system — local email/password (session-based, always available) + Google OAuth via Clerk
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
- `/register` — Public registration request form (name, email, password, optional note)
- `/admin` — Admin panel (6 tabs: Users RBAC, Solicitudes de Acceso, Modules toggle, Audit logs, Integrations, Sync logs)
- `/dashboard/due-dates` — Vencimientos: due dates tracker with urgency grouping (overdue/today/3d/week/future/done)
- `/dashboard/finance` — Finanzas personales: patrimonial summary, editable accounts (caja/banco/cripto/inversiones/deuda), pie chart, configurable alert thresholds
- `/settings` — Dashboard configuration (incl. Fuentes Externas section)

### Backend (artifacts/api-server)

**Header controls (Etapa 2 additions):**
- "Modo HOY" button — slide-over panel with today's top 3 priorities (vencimientos + tasks + finance), critical alerts, and recommended action
- "Actualizar datos" button — invalidates all React Query caches
- Alert bell — popover with badge counter for urgent vencimientos (≤7 days) and high-priority tasks, with read/unread state

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
- `/api/due-dates` + `/api/due-dates/:id` — Vencimientos CRUD
- `/api/due-date-categories` + `/api/due-date-categories/:id` — Category CRUD
- `/api/external-sources` + `/api/external-sources/:id` — External file sources CRUD

### Database (lib/db)

Tables: `users`, `tasks`, `shortcuts`, `fiscal_updates`, `travel_offers`, `app_settings`, `news_items`, `weather_snapshots`, `sync_logs`, `discard_logs`, `email_connections`, `currency_rates`, `data_sources`, **`due_dates`**, **`due_date_categories`**, **`external_file_sources`**, **`modules`**, **`user_module_permissions`**, **`security_logs`**, `uploaded_due_files`, `annual_calendar_items`, `clients`, `supplier_batches`, `supplier_batch_items`, `tax_calendars`

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

**Dual auth system (session-based + Clerk):**

1. **Local email/password** (primary): `POST /api/auth/login` verifies bcrypt hash → creates Express session cookie (`connect.sid`, 30-day, stored in PostgreSQL `session` table). Fully independent of Clerk — always works even without internet.
2. **Google OAuth** (via Clerk): after Clerk OAuth completes, `use-user-sync.ts` calls `POST /api/auth/google-session` with the Clerk Bearer token → backend creates a parallel Express session.

**Super admin**: `joaquin.fontanini@gmail.com`, password `12345678` (bcrypt-hashed in DB, id=2, role=`super_admin`).

**Key files:**
- `artifacts/api-server/src/routes/auth.ts` — login, google-session, logout, me routes
- `artifacts/api-server/src/middleware/require-auth.ts` — checks `req.session.userId` first, then Clerk JWT
- `artifacts/dashboard/src/pages/sign-in.tsx` — dual form: Google button (Clerk modal) + email/password
- `artifacts/dashboard/src/lib/local-auth.ts` — `LOCAL_AUTH_MODE`, `verifyLocalPassword`, `saveLocalSession`
- `artifacts/dashboard/src/hooks/use-user-sync.ts` — registers Google user + establishes backend session

User roles: super_admin, admin, editor, viewer. All dashboard routes require a valid session.

## Data Isolation & Security

**Per-user data isolation** is enforced on all functional tables. Every resource is scoped to the authenticated user:

- **Tables with `user_id TEXT` column**: `tasks`, `shortcuts`, `daily_goals`, `strategy_goals`, `finance_accounts`, `due_dates`, `clients`, `supplier_payment_batches`
- **`userId` strategy**: stored as `String(dbUser.id)` (internal integer ID cast to string), consistent across local + Clerk auth.
- **`getCurrentUserId(req)`**: reads from `req.dbUser` (set by `requireAuth` middleware) — always returns the correct integer ID as string, for both local and Clerk sessions.
- **`assertOwnership(req, res, recordUserId)`**: returns 404 (not 403) if `recordUserId !== String(dbUser.id)`. Super_admin always passes (sees all data for admin purposes).
- **Super_admin bypass**: skips both module permission checks AND ownership checks.

**Module permission guard (`requireModule`):**
1. Auth + active/blocked check → 2) super_admin bypass → 3) module isActive → 4) `user_module_permissions` override (per-user grant/revoke) → 5) role-level `allowedRoles` check
- Unknown module keys fail-closed (403).
- Guards are applied in `routes/index.ts` with explicit path prefixes: `router.use("/path", requireModule("key"))`.

**Tables intentionally without `user_id`** (shared/global data):
- `travel_offers` — scraped travel deals (like a news feed)
- `finance_config` — shared alert thresholds
- `tax_calendars` — shared AFIP calendar data

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

## V5 Features (completed)

- **Vencimientos module**: `due_dates` + `due_date_categories` tables; full CRUD API; page with urgency grouping (overdue/today/3d/week/future/done); category management dialog; priority coloring
- **Dashboard layout**: `lg:grid-cols-[1fr_288px]`; VencimientosWidget sticky right panel with `self-start lg:sticky lg:top-[76px]` (sticky properly anchored below the 60px header)
- **News deduplication**: `normalizeTitle()` + `titleSimilarity()` (0.75 word overlap); cross-batch dedup via unified `existingNormalizedTitles` Map; logs `skippedDup`/`skippedMediaSummary`
- **Tributum full normative filter** (v5.1 fix): 3-layer filter — (1) resumen-de-medios patterns, (2) `(SourceAttribution)` regex at end of title, (3) `filterNormasNacionales` flag enforces normative markers (RG, Ley, Decreto, AFIP/ARCA/IGJ/BCRA/UIF). Only institutional/regulatory content passes.
- **Widget management**: 6 configurable summary widgets (Emails, Tareas, Fiscal, Viajes, Noticias, Vencimientos); reorder ↑/↓ + show/hide Eye toggle; `Settings2` gear icon in dashboard header; persisted in localStorage key `dashboard-widget-config-v1`; empty-state prompt when all hidden
- **News categories expanded**: 23 chips incl. Inflación, Política, Internacional, Tecnología; unified filter panel with source icon fixed-width layout
- **External file sources**: `external_file_sources` table; full CRUD API; Settings page "Fuentes Externas" section with create/edit/delete dialog
- **Seeding**: `seedDefaultCategories()` in `app.ts` on startup → 7 default due-date categories
- **API server**: Manual validation in all routes (no Zod dependency — Zod only in api-zod lib)
- **Due-dates sidebar nav**: "Vencimientos" added (CalendarClock icon)

## V6 Features (completed)

- **Clients module**: `clients` table; CUIT validation (Módulo 11 with weights `[5,4,3,2,7,6,5,4,3,2]`); AFIP category engine; full CRUD API + page with search/filter
- **Annual calendar**: `annual_calendar_items` table; `patchGanancias2026()` seeded on startup; drag-and-drop reorder; page at `/dashboard/due-dates/annual`
- **Supplier payment batches**: `supplier_batches` + `supplier_batch_items`; CSV import (proveedor, importe, N°doc, venc_original, notas); batch management page
- **Tax Calendars page**: `/dashboard/tax-calendars`; multer file upload to `uploads/tax-calendars/`; activate/delete/reprocess actions
- **VencimientosWidget category tabs**: filterable by category tab strip
- **Security system (RBAC)**:
  - Roles: `super_admin` > `admin` > `editor` > `viewer`
  - `modules` table: 14 modules seeded, each with `isActive` + `allowedRoles[]`
  - `security_logs` table: audit trail for all sensitive actions
  - `users` extended: `isBlocked`, `blockedAt`, `blockedReason`, `lastActivityAt`, `metadata`
  - Middleware: `requireAuth` / `requireAdmin` / `requireSuperAdmin` in `src/middleware/require-auth.ts`
  - `bootstrapSuperAdmin()`: sets `super_admin` role for `SUPER_ADMIN_EMAIL` env var on first login
  - Rate limiting: 500 req/15min general; 30 req/15min for block/unblock/promote/module-toggle
  - Routes: `/api/modules`, `/api/modules/:key/toggle`, `/api/modules/:key/roles`, `/api/security-logs`, `/api/users/:id/block`, `/api/users/:id/unblock`
  - Frontend: 5-tab admin panel (Users RBAC, Modules toggle, Audit logs, Integrations, Sync); `useCurrentUser` hook; layout filters nav items based on active modules + user role
- **`SUPER_ADMIN_EMAIL`** env var: set to auto-promote email to super_admin on first login

## External Excel Cloud — Foundation Checklist

Ready:
- `external_file_sources` table: id, name, type (excel/google_sheets/csv/other), url, identifier, status, notes, userId, createdAt, updatedAt
- Full CRUD API at `/api/external-sources`
- UI management in Settings → "Fuentes Externas"

Still needed for real Excel/Sheets reading:
1. Google OAuth credentials (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`) → already used for Gmail
2. `googleapis` npm package for Sheets API: `pnpm --filter @workspace/api-server add googleapis`
3. A `getGoogleSheetsClient(userId)` service that reads OAuth tokens from `email_connections` table
4. A sync job that reads rows from Google Sheets and stores them in a new `imported_data` table
5. For Excel files: `xlsx` or `exceljs` package + a file upload endpoint

## Chat Interno y Contactos (Módulos 19-20)

### Nuevas tablas en PostgreSQL
- **`user_profiles`**: extends users — phone, bio, avatarUrl, area; userId UNIQUE FK → users
- **`conversations`**: id, type ("direct"/"group"), name, createdAt, updatedAt
- **`conversation_participants`**: conversationId + userId FKs, lastReadAt (for unread tracking), joinedAt
- **`messages`**: conversationId + senderId FKs, content, isDeleted, createdAt

### API Routes (auth required)
- `GET /api/contacts` — all users with profile data merged
- `PATCH /api/contacts/me` — update own phone/bio/avatarUrl/area
- `PATCH /api/contacts/:id` — admin-only: update any user's profile + name
- `GET /api/conversations` — user's conversations with participants, lastMessage, unreadCount
- `POST /api/conversations` — start/get direct conversation (idempotent)
- `GET /api/conversations/unread` — total unread count for badge
- `GET /api/conversations/:id/messages` — last 100 messages, enriched with sender info
- `POST /api/conversations/:id/messages` — send message (max 5000 chars)
- `PUT /api/conversations/:id/read` — mark conversation as read (updates lastReadAt)

### Frontend Pages
- `/dashboard/contacts` — Grid of user cards: avatar/initials, name, role badge, status, email, phone, area, bio; "Mensaje" button → navigates to chat; Edit dialog (own profile, admin can edit anyone)
- `/dashboard/chat` — Split-panel: left (conversations list with unread badges), right (messages + input); polling every 3s; "Nueva conversación" dialog with user search; Responsive (mobile: single panel toggle)

### Sidebar
- Contactos (Contact icon) + Chat (MessageSquare icon) added to ALL_NAV_ITEMS
- Chat item shows live unread badge (polls every 10s via useUnreadMessages hook)
- Badge visible in both expanded and collapsed sidebar states

### Módulos seeded
- `contacts` (orderIndex 18, all roles)
- `chat` (orderIndex 19, all roles)

### Design decisions
- Polling interval: 3s for messages, 10s for unread count in sidebar
- Security: server-side participant check on every message endpoint
- Architecture ready for WebSocket upgrade (all data model in place)
