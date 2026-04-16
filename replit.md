# Dashboard Web Personal

## Overview

This project is a full-stack personal executive dashboard designed for an Argentine contador/consultor. It provides a centralized platform for managing financial tracking, task management, news consumption, and fiscal monitoring. The dashboard integrates with external services for real-time data, offering a comprehensive view of critical professional information. Key capabilities include a dollar quotes widget, Kanban task board, news filtering with deduplication, a fiscal monitor with data quality features, due date tracking, and management of external file sources. The business vision is to empower consultants with a powerful, intuitive tool to streamline operations, enhance decision-making, and improve productivity.

## User Preferences

No specific user preferences were provided in the original `replit.md` file.

## System Architecture

The project is built as a monorepo using `pnpm workspaces`.

**Frontend:**
- **Technology Stack:** React, Vite, TypeScript, Tailwind CSS, `shadcn/ui`, Radix UI, Framer Motion.
- **UI/UX Decisions:**
    - Dashboard layout uses a main content area and a sticky right panel for widgets.
    - Configurable widgets with reorder and show/hide options, persisted in local storage.
    - News categories offer extensive filter chips.
    - Fiscal monitor allows toggling between card and table views.
    - Responsive split-panel designs for chat and contacts modules.
- **Key Pages:** Dashboard with various modules (Tasks, News, Fiscal, Finance, Due Dates, Settings, Admin) and authentication pages.

**Backend:**
- **Technology Stack:** Express 5, Node.js, PostgreSQL with Drizzle ORM.
- **Authentication:** Dual system combining local email/password (session-based) and Google OAuth via Clerk, with role-based access control (`super_admin`, `admin`, `editor`, `viewer`).
- **Validation:** Zod with `drizzle-zod`.
- **API Codegen:** Orval (from OpenAPI spec).
- **Core Features:**
    - Comprehensive CRUD APIs for all modules (Tasks, Shortcuts, Fiscal, News, Finance, Due Dates, etc.).
    - Advanced Tasks module with assignment workflow, progress tracking, comments, and audit history.
    - Real-time data refresh mechanisms for fiscal and news.
    - Data quality system with scoring for fiscal updates and travel offers.
    - Enhanced News module with updated sources, automatic classification, user-saved articles, and alert configurations.
    - Clients module with CUIT validation and AFIP category engine.
    - Robust Due Dates and Alerts system with AFIP Engine for traffic light calculations, email alerts, and detailed traceability.
    - Full Personal Finance module (Finanzas Personales) including accounts, transactions, recurring rules, cards, installment plans, loans, budgets, goals, and smart suggestions.
    - Internal Chat and Contacts module with direct and group conversations, unread tracking, and polling.
    - System hardening includes external cache with circuit breaker for resilient service calls, cron job observability, and in-app notification system.
    - DB-backed user preferences and security logging.
    - **Dashboard Studio** (Parts 1 & 2 complete + security/quality audit fixes): Dynamic dashboard builder with 3 creation flows — "Crear desde prompt" (heuristic NLP parser), Template Gallery (10 built-in templates), and Wizard (3-step guided builder). 7 DB tables, 19 data sources, 14 widget types. Route: `/dashboard/studio`, module key: `dashboard_studio`. Part 2 additions: visual DnD builder (`@dnd-kit/core`), widget config panel, breakpoint-aware viewer (desktop/mobile), snapshot system with cache age badges + refresh, rule-based smart summary engine, permissions CRUD (grant/revoke by userId), full frontend restructure under `src/pages/dashboard/studio/` (index, builder, viewer, types, components/, modals/). Data endpoint returns `{data, fromSnapshot, snapshotAt, snapshotStatus}` per widget.
    - **Studio Audit Fixes (applied)**: C1) `tasks.teamBoard` now filters by userId (cross-user data leak fixed); C2) `admin.jobs.health` gated by `super_admin` role in `/data` endpoint AND catalog filtered for non-admins; C3) `DashboardBuilder` lazy import moved to module level (was inside render, caused state loss); C4) `assertOwnership` misuse in archive/restore/delete replaced with explicit 403 responses; D1) Viewer applies `gridColumn: span N` from layout `w` field (handles legacy 12-col and new 3-col systems); D2) New `POST /api/studio/dashboards/:id/save` endpoint wraps name+status+widgetOrder+layout in single DB transaction; D3) Permissions N+1 fixed — batch loads users; D4) Max 20 widgets per dashboard enforced; D5) Smart summary in-memory TTL cache (2 min per userId); E3) `beforeunload` + back-button guard when hasUnsavedChanges; E4) `updateWidgetMutation` no longer resets `hasUnsavedChanges`; `refreshIntervalSeconds` per-dashboard fully wired (schema, PATCH, batch-save, viewer refetchInterval); `refreshIntervalSeconds` per-widget copied in duplicate; status enum validated in PATCH; `dataSignature` computed (sha256 of dataSourceKey+configJson) and stored on snapshot save+refresh; **DashboardFiltersBar** component created — renders date_range/select/text filters from DB, passes `dateFrom`/`dateTo` as query params to `/data` endpoint, data sources use them for filtering (dueDates.upcoming, finance.summary, finance.transactions.recent); widget column width selector (1/2/3 cols) in WidgetConfigPanel, initialized from existing layout, persisted on batch save; `sourceType` comment updated to include `duplicate`.
    - **Studio Bug Fixes (session 3)**: (1) Rebuilt `@workspace/db` TypeScript declarations — `dashboard-studio.d.ts` and other new schema files were missing from `dist/`, causing stale type errors for `dashboardTemplatesTable`, `widgetDefinitionsTable`, etc.; (2) Fixed `auditLog` helper: added required `module: "dashboard_studio"` and `entity: "dashboard"` to satisfy NOT NULL constraints; (3) Fixed permissions handler: renamed `subjectRoleKey` → `roleKey` (matching schema column), removed `updatedAt` and `grantedBy` (columns that don't exist) from insert/update; (4) Fixed `studio-data-sources.ts`: `clientsTable.isActive` → `clientsTable.status === "active"` (schema uses text status, not boolean); (5) Fixed all 25 route handler types: added explicit `req: Request, res: Response` annotations to suppress implicit `any` TypeScript errors caused by passing middleware as array.
    - **Important**: `getCurrentUserIdNum(req)` helper in `require-auth.ts` returns the user's numeric ID (for integer FK columns like `dashboards.owner_user_id`). Always use this for `dashboardsTable` operations; use `getCurrentUserId(req)` (string) for TEXT userId columns (tasks, finance, etc.).

**System Design Choices:**
- **Monorepo:** Centralized development and management.
- **Data Isolation:** Enforced per-user using `user_id` and `assertOwnership` middleware.
- **Module-based Access Control:** `requireModule` middleware controls feature access based on `isActive` status and `allowedRoles`.
- **Resilient External Services:** Utilizes caching, circuit breakers, and stale cache fallbacks for external API integrations.
- **Robustness:** Includes timeout guards and retry mechanisms for critical fetches and user synchronization.

## External Dependencies

- **dolarapi.com:** For real-time dollar quotes.
- **Clerk:** For Google OAuth authentication and user management.
- **Open-Meteo:** For weather forecasts.
- **RSS Feeds:** Infobae, LM Neuquén (primary); Ámbito, La Nación, Diario Río Negro, Clarín (supplementary).
- **Google APIs (googleapis npm package):** For potential future Google Sheets integration.
- **PostgreSQL:** Primary database.
- **Zod:** Schema validation.
- **bcrypt:** Password hashing.
- **multer:** For file uploads.
- **xlsx or exceljs:** For future Excel file processing.