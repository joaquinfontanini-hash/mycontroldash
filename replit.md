# Dashboard Web Personal

## Overview

This project is a full-stack personal executive dashboard designed for an Argentine contador/consultor. It aims to provide a centralized platform for managing various aspects of their professional life, including financial tracking, task management, news consumption, and fiscal monitoring. The dashboard integrates with external services to provide real-time data and offers a comprehensive view of critical information. Key capabilities include a dollar quotes widget, Kanban task board, news filtering with deduplication, a fiscal monitor with data quality features, due date tracking, and management of external file sources. The business vision is to empower consultants with a powerful, intuitive tool to streamline operations, enhance decision-making, and improve productivity.

## User Preferences

No specific user preferences were provided in the original `replit.md` file.

## System Architecture

The project is built as a monorepo using `pnpm workspaces`.

**Frontend:**
- **Technology Stack:** React, Vite, TypeScript, Tailwind CSS.
- **UI Components:** `shadcn/ui`, Radix UI, Framer Motion.
- **Pages:**
    - `/` (Landing), `/sign-in`, `/sign-up` (Authentication)
    - `/dashboard` (Executive summary with widgets), `/dashboard/tasks` (Full task management with assignment workflow), `/dashboard/shortcuts` (CRUD)
    - `/dashboard/news` (News feed with filters), `/dashboard/emails` (Email inbox), `/dashboard/weather` (3-day forecast)
    - `/dashboard/fiscal` (Monitor Fiscal with card/table toggle), `/dashboard/travel` (Travel offers browser)
    - `/register` (Public registration), `/admin` (Admin panel with 6 tabs)
    - `/dashboard/due-dates` (Due dates tracker)
    - `/dashboard/finance` (Finanzas Personales — Fase 1: dashboard resumen con semáforos, carga rápida de movimientos, tabla con filtros, cuentas, recurrencias. Botón flotante "+" para carga rápida. Demo data via POST /api/finance/seed-demo)
    - `/settings` (Dashboard configuration, including External Sources)
- **UI/UX Decisions:**
    - Dashboard layout utilizes `lg:grid-cols-[1fr_288px]` for a main content area and a sticky right panel for widgets like `VencimientosWidget`.
    - Widgets are configurable with reorder and show/hide toggles, persisted in local storage.
    - News categories are expanded with 23 filter chips.
    - Fiscal monitor offers toggle between card and table views.
    - Chat and Contacts modules are designed with a split-panel view for responsiveness.

**Backend:**
- **Technology Stack:** Express 5, Node.js.
- **Database:** PostgreSQL with Drizzle ORM.
- **Authentication:** Dual system combining local email/password (session-based) and Google OAuth via Clerk.
    - Local authentication uses bcrypt hashing and Express sessions stored in PostgreSQL.
    - Clerk integrates for Google OAuth, creating a parallel Express session.
    - User roles: `super_admin`, `admin`, `editor`, `viewer`.
    - Security middleware (`requireAuth`, `requireModule`, `assertOwnership`) enforces data isolation and role-based access control.
- **Validation:** Zod (`zod/v4`) with `drizzle-zod`.
- **API Codegen:** Orval (from OpenAPI spec).
- **Core Features:**
    - Full Tasks module: 14 endpoints with CRUD, assignment workflow (pending_acceptance → in_progress), accept/reject by assignee, progress tracking (0-100%), comments, audit history, cancel/archive/reassign actions. Tables: `tasks`, `task_comments`, `task_history`.
    - CRUD APIs for shortcuts, fiscal data, travel offers, news, emails, weather, settings, users, currency, sync logs, due dates, due date categories, and external file sources.
    - `GET /api/users/assignable` — returns basic user info for assignment dropdowns (requires auth).
    - Real-time data refresh mechanisms for fiscal and news data.
    - Header controls include "Modo HOY" for priority overview, "Actualizar datos" for cache invalidation, and an alert bell for urgent items.
    - Data quality system with scoring (0-100) for fiscal updates and travel offers, including discard thresholds and logging.
    - News module redesigned: sources updated to Infobae + LM Neuquén (primary) + Ámbito, La Nación, Diario Río Negro, Clarín (supplementary); Tributum and Contadores en Red disabled. Automatic classification by regionLevel (internacional/nacional/regional), newsCategory (economia/politica/laboral/juicios), impactLevel (alto/medio/bajo), priorityScore. New tables: `saved_news` (per-user saved articles), `user_alerts` (per-user alert configurations). New endpoints: POST/DELETE /news/:id/save, GET /news/saved, GET/POST /news/alerts, PATCH/DELETE /news/alerts/:id.
    - Clients module with CUIT validation and AFIP category engine.
    - Annual calendar with drag-and-drop reordering.
    - Supplier payment batches with CSV import functionality.
    - Tax Calendars page with file upload and management.
    - Internal Chat and Contacts module with `user_profiles`, `conversations`, `conversation_participants`, and `messages` tables, supporting direct and group conversations with unread tracking and polling for updates.
    - **Sistema de Vencimientos + Alertas + Semáforos (v2):**
      - AFIP Engine (afip-engine.ts): calculateTrafficLight (verde>7d, amarillo 3-7d, rojo≤2d/vencido, gris=done), clientTrafficLight(), getDueDatesKPIs(), updateAllTrafficLights(), generateDueDatesForClient(), generateDueDatesForAllClients(), full JSON traceability (classificationReason field), audit logging.
      - Email Alert Service (email-alert.service.ts): sendDueDateAlert(), runDailyAlertJob(), resendAlert(). HTML templates with semáforo colors. Deduplication (24h). SMTP not configured = logs as "skipped" never fails silently. Env: SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_URL.
      - New routes (fiscal-admin.ts): GET /api/due-dates/kpis, POST /api/due-dates/recalculate, GET /api/due-dates/:id/traceability, POST /api/due-dates/:id/mark-reviewed, POST /api/due-dates/:id/resend-alert, full CRUD /api/tax-homologation, GET /api/alert-logs, POST /api/alert-logs/:id/resend, GET /api/audit-logs.
      - New DB tables (fiscal-due-dates.ts): tax_homologation, alert_logs, audit_logs, semaforo_rules.
      - Extended due_dates table: trafficLight, cuitGroup, cuitTermination, taxCode, classificationReason, alertGenerated, lastAlertSentAt, manualReview, reviewNotes, reviewedAt, reviewedBy.
      - Extended clients table: emailSecondary, clientPriority, alertsActive, responsible.
      - Frontend (due-dates.tsx): KPI bar (9 tiles), semáforo badges, table/card toggle, trazabilidad modal with alert history + resend + mark-reviewed, tabs (Vencimientos / Alertas enviadas), filters (status, semáforo, category, text search), sorted by rojo-first then date.
      - Scheduler: semáforos recalculated at 7:00 AM, email alerts at 8:00 AM daily.
    - **Finanzas Personales — Fase 1 + Fase 2 (completo):**
      - DB tables: `finance_accounts`, `finance_config`, `finance_categories`, `finance_transactions` (+ cardId, installmentPlanId columns), `finance_recurring_rules`, `finance_cards`, `finance_installment_plans`, `finance_loans`.
      - Backend (finance.ts): Full CRUD for categories, transactions, recurring-rules, accounts, config, cards (/api/finance/cards), installment-plans (/api/finance/installment-plans), loans (/api/finance/loans). GET /api/finance/cards/:id/summary (cycle spending). GET /api/finance/summary (Phase 2: compromisos, presionFinanciera semaphore, upcoming payments cards+loans+installments). POST /api/finance/seed-demo (2 cards, 2 installment plans, 1 loan, 6 recurring rules).
      - Pressure meter: green < 50% income committed, yellow 50-80%, red > 80% or > saldoDisponible.
      - Card balance isolation: card transactions (cardId set) do NOT affect account balance.
      - Frontend (finance.tsx): 8 tabs — Resumen (PressureMeter + insights panel + compromisos + 6 KPI cards + upcoming payments + alerts + recent tx + upcoming recurrences + category breakdown + accounts), Movimientos, Cuentas, Tarjetas, Prestamos, Recurrencias, Presupuestos, Proyección.
      - New modals: CardModal, InstallmentPlanModal, LoanModal, BudgetModal.
      - Account types: caja, banco, billetera_virtual, tarjeta, cripto, inversiones, deuda.
      - **Fase 3:** `finance_budgets` table (userId, categoryId, month YYYY-MM, amount). Budget CRUD with upsert logic. GET /api/finance/budgets?month returns enriched list with spent/remaining/pct/status. GET /api/finance/projection computes 35-day daily balance series from recurring rules + card dues + loans + installments; returns horizons (7d/15d/month-end) + calendarEvents + highPressureDays. GET /api/finance/insights computes: variable expense trend vs prev month, top expense category, budget alerts (>80% and exceeded), upcoming pressure week, subscriptions %, projected month-end balance. Frontend: Presupuestos tab (month navigator, summary card, BudgetCard list sorted by pct, BudgetModal); Proyección tab (3 horizon cards, SVG projection chart, high-pressure days, insights panel, FinancialCalendar grouped by date); Resumen tab now shows InsightRow panel after alerts.

**System Design Choices:**
- **Monorepo:** Centralized management of frontend, backend, and shared libraries.
- **Data Isolation:** Enforced per-user using `user_id` columns in relevant tables and `assertOwnership` middleware.
- **Module-based Access Control:** `modules` table defines features, their `isActive` status, and `allowedRoles`. `requireModule` middleware controls access.
- **Security Logging:** `security_logs` table for auditing sensitive actions.
- **Rate Limiting:** Implemented for general API requests and specific administrative actions.

## External Dependencies

- **dolarapi.com:** For fetching real-time dollar quotes (Blue, MEP, Cripto, Oficial).
- **Clerk:** For Google OAuth authentication and user management.
- **Open-Meteo:** For weather forecasts.
- **RSS Feeds:** Infobae, LM Neuquén (primary sources), Ámbito, La Nación, Diario Río Negro, Clarín (supplementary). Tributum and Contadores en Red removed.
- **Google APIs (googleapis npm package):** Potentially for Google Sheets integration (requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`).
- **PostgreSQL:** Primary database.
- **Zod:** Schema validation library.
- **bcrypt:** Password hashing.
- **multer:** For handling file uploads (e.g., tax calendars).
- **xlsx or exceljs:** For processing Excel files (future integration).