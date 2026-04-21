# Executive Dashboard — Panel de Control Ejecutivo Personal

Panel privado de gestión ejecutiva para profesionales independientes. Diseñado para contadores y consultores en Argentina.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + Vite + TypeScript |
| Backend | Express + Node.js + TypeScript |
| Base de datos | PostgreSQL + Drizzle ORM |
| Autenticación | Clerk (JWT + OAuth) |
| Estilos | Tailwind CSS + shadcn/ui |
| Estado del servidor | TanStack Query (React Query) |
| Monorepo | pnpm workspaces |

---

## Despliegue en Producción (Vercel + Railway + Supabase)

### Arquitectura recomendada

```
Vercel (frontend estático)  →  Railway/Render (backend Express)  →  Supabase (PostgreSQL)
```

> **¿Por qué dos plataformas?**
> El backend tiene tareas programadas (cron jobs), procesos en segundo plano y conexiones persistentes que no son compatibles con funciones serverless de Vercel. Vercel es ideal para el frontend estático (React+Vite).

---

### Paso 1 — Base de datos en Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com)
2. Andá a **SQL Editor** y ejecutá el contenido completo de [`schema.sql`](./schema.sql)
3. Copiá la **Transaction pooler connection string** (puerto 6543):
   - Supabase → Project Settings → Database → Connection pooling

---

### Paso 2 — Backend en Railway

1. Creá una cuenta en [railway.app](https://railway.app)
2. Nuevo proyecto → **Deploy from GitHub repo**
3. En **Settings** del servicio configurá:
   - **Build Command**: `pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build`
   - **Start Command**: `pnpm --filter @workspace/api-server run start`
   - **Root Directory**: (dejar vacío — raíz del monorepo)
4. Agregá las variables de entorno (ver tabla abajo)
5. Una vez desplegado, copiá la URL pública (ej: `https://tu-api.up.railway.app`)

**Variables de entorno para Railway (backend):**

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Transaction pooler URL de Supabase (puerto 6543) |
| `SESSION_SECRET` | String aleatorio ≥ 64 caracteres |
| `EMAIL_ENCRYPTION_KEY` | String aleatorio ≥ 64 caracteres |
| `CLERK_SECRET_KEY` | Secret key de Clerk (`sk_live_...`) |
| `CLERK_FAPI` | Frontend API URL de Clerk |
| `CLERK_PROXY_PATH` | `/__clerk` |
| `ALLOWED_ORIGINS` | URL de tu frontend en Vercel (ej: `https://tu-app.vercel.app`) |
| `APP_URL` | URL de tu frontend en Vercel |
| `NODE_ENV` | `production` |
| `SMTP_HOST` | Host SMTP (ej: `smtp.gmail.com`) |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Dirección de email |
| `SMTP_PASS` | Contraseña de app (no la contraseña normal) |
| `SMTP_FROM` | Dirección de email remitente |
| `SERPAPI_KEY` | API key de SerpAPI (para noticias) |

---

### Paso 3 — Frontend en Vercel

1. Importá el repositorio en [vercel.com](https://vercel.com)
2. Vercel detecta `vercel.json` automáticamente — no cambies nada en el wizard
3. Configurá estas variables en **Project Settings → Environment Variables**:

| Variable | Descripción |
|----------|-------------|
| `VITE_API_URL` | URL del backend en Railway (sin slash final) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Publishable key de Clerk (`pk_live_...`) |
| `VITE_CLERK_PROXY_URL` | `https://tu-api.up.railway.app/__clerk` |

4. Deployá (o disparalo manualmente desde el dashboard de Vercel)

---

### Paso 4 — Configurar Clerk para producción

En el [dashboard de Clerk](https://dashboard.clerk.com):
- Agregá el dominio de Vercel como **Allowed origin**
- Configurá el **Proxy URL** como `https://tu-api.up.railway.app/__clerk`

---

### Pasos manuales necesarios

| Paso | Dónde | Qué hacer |
|------|-------|-----------|
| 1 | Supabase | Ejecutar `schema.sql` en el SQL Editor |
| 2 | Clerk | Agregar dominio Vercel a Allowed origins |
| 3 | Clerk | Configurar el Proxy URL con la URL de Railway |
| 4 | Railway | Configurar todas las variables de entorno |
| 5 | Vercel | Configurar `VITE_API_URL`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PROXY_URL` |

---

## Desarrollo local

### Requisitos
- Node.js 20+
- pnpm 9+
- PostgreSQL local o acceso a Supabase

```bash
# 1. Instalar dependencias
pnpm install

# 2. Copiar y completar variables de entorno
cp .env.example .env
# Editá .env con tus valores

# 3. Aplicar esquema a la base de datos
pnpm --filter @workspace/db run push

# 4. Iniciar todos los servicios (el entorno Replit arranca automáticamente)
```

> Para desarrollo sin Clerk, usá el modo de autenticación local:
> ```
> VITE_LOCAL_AUTH_MODE=true
> VITE_LOCAL_EMAIL=admin@local.dev
> VITE_LOCAL_NAME=Admin
> VITE_LOCAL_PASSWORD=admin123
> ```

---

## Estructura del proyecto

```
/
├── artifacts/
│   ├── api-server/          # Backend Express
│   │   └── src/
│   │       ├── routes/      # Endpoints REST
│   │       ├── middleware/  # Auth, rate-limit, CORS
│   │       ├── lib/         # Logger, scheduler, seed
│   │       └── index.ts     # Entry point
│   └── dashboard/           # Frontend React
│       └── src/
│           ├── pages/       # Páginas del dashboard
│           ├── components/  # Componentes reutilizables
│           ├── hooks/       # Hooks personalizados
│           ├── services/    # Capa de servicios (API client)
│           └── App.tsx      # Routing principal
├── lib/
│   ├── db/                  # Drizzle ORM — schema y conexión
│   │   └── src/schema/      # 85 tablas PostgreSQL
│   └── api-client-react/    # Hooks generados desde OpenAPI
├── schema.sql               # Schema completo para Supabase
├── .env.example             # Plantilla de variables de entorno
└── vercel.json              # Config de deploy del frontend en Vercel
```

---

## Módulos disponibles

| Módulo | Ruta | Descripción |
|--------|------|-------------|
| Dashboard | `/dashboard` | Resumen principal con widgets |
| Vencimientos | `/dashboard/due-dates` | Vencimientos impositivos con recurrencia |
| Tareas | `/dashboard/tasks` | Board Kanban de tareas |
| Clientes | `/dashboard/clients` | Cartera de clientes |
| Proveedores | `/dashboard/supplier-batches` | Lotes de pago |
| Calendarios | `/dashboard/tax-calendars` | Calendarios impositivos anuales |
| Finanzas | `/dashboard/finance` | Resumen financiero personal |
| Objetivos del día | `/dashboard/goals` | Checklist diario |
| Estrategia | `/dashboard/strategy` | Objetivos estratégicos + Gantt |
| Decisiones | `/dashboard/decisions` | Motor de decisiones + scoring |
| Ajustes | `/settings` | Configuración del sistema |
| Admin | `/admin` | Panel de administración (super_admin) |

---

## Arquitectura de seguridad

- **Autenticación**: Clerk (JWT verificado en cada request)
- **RBAC**: 4 roles — `super_admin`, `admin`, `editor`, `viewer`
- **Rate limiting**: 500 req/15min general, 30 req/15min endpoints sensibles
- **CORS**: Origins permitidos configurables por env (`ALLOWED_ORIGINS`)
- **Audit log**: Registro de eventos de seguridad en `security_logs`
- **Módulos**: Cada módulo tiene lista de roles permitidos (`allowedRoles`)
- **Rutas protegidas**: `requireAuth` middleware en todos los endpoints privados

---

## Scripts principales

```bash
pnpm build                                       # Build completo del monorepo
pnpm --filter @workspace/dashboard run build     # Build solo el frontend
pnpm --filter @workspace/api-server run build    # Build solo el backend
pnpm --filter @workspace/db run push             # Sincronizar schema con la DB
```
