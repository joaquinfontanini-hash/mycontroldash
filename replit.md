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
    - **Studio Audit Fixes (applied)**: C1) `tasks.teamBoard` now filters by userId (cross-user data leak fixed); C2) `admin.jobs.health` gated by `super_admin` role in `/data` endpoint AND catalog filtered for non-admins; C3) `DashboardBuilder` lazy import moved to module level (was inside render, caused state loss); C4) `assertOwnership` misuse in archive/restore/delete replaced with explicit 403 responses; D1) Viewer now applies `gridColumn: span N` from layout `w` field (handles legacy 12-col and new 3-col systems); D2) New `POST /api/studio/dashboards/:id/save` endpoint wraps name+status+widgetOrder+layout in a single DB transaction (replaces N+1 saves); D3) Permissions N+1 query fixed — batch loads users in one query; D4) Max 20 widgets per dashboard enforced in POST /widgets; D5) Smart summary has in-memory TTL cache (2 min per userId); E3) `beforeunload` + back-button confirmation when hasUnsavedChanges; E4) `updateWidgetMutation` no longer incorrectly resets `hasUnsavedChanges`; Spec gap: `refreshIntervalSeconds` fully wired — configurable in builder properties panel, used by viewer for `refetchInterval`.
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