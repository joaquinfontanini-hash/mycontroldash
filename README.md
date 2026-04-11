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
│   │   └── src/schema/      # Tablas PostgreSQL
│   └── api-client-react/    # Hooks generados desde OpenAPI
└── pnpm-workspace.yaml
```

---

## Cómo correr el proyecto

### Requisitos
- Node.js 20+
- pnpm 8+
- PostgreSQL (provisto por Replit)

### Instalación

```bash
pnpm install
```

### Desarrollo

```bash
# Backend (puerto 8080)
pnpm --filter @workspace/api-server run dev

# Frontend (puerto dinámico por PORT env)
pnpm --filter @workspace/dashboard run dev
```

### Variables de entorno requeridas

```
DATABASE_URL=          # PostgreSQL connection string
CLERK_SECRET_KEY=      # Clerk backend secret
VITE_CLERK_PUBLISHABLE_KEY=  # Clerk frontend key
VITE_CLERK_PROXY_URL=  # Clerk proxy para Replit
SESSION_SECRET=        # Para sesiones firmadas
SUPER_ADMIN_EMAIL=     # Email del super administrador
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
- **CORS**: Origins permitidos configurables por env
- **Audit log**: Registro de eventos de seguridad en `security_logs`
- **Módulos**: Cada módulo tiene lista de roles permitidos (`allowedRoles`)
- **Rutas protegidas**: `requireAuth` middleware en todos los endpoints privados

---

## Cómo agregar un nuevo módulo

### 1. Schema de base de datos (si aplica)

```typescript
// lib/db/src/schema/mi-modulo.ts
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const miModuloTable = pgTable("mi_modulo", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

```typescript
// lib/db/src/schema/index.ts
export * from "./mi-modulo";
```

```bash
cd lib/db && npx tsc --build && npx drizzle-kit push
```

### 2. API route

```typescript
// artifacts/api-server/src/routes/mi-modulo.ts
import { Router } from "express";
import { requireAuth } from "../middleware/require-auth.js";

const router = Router();

router.get("/mi-modulo", requireAuth, async (req, res) => {
  // lógica aquí
  res.json([]);
});

export default router;
```

```typescript
// artifacts/api-server/src/routes/index.ts
import miModuloRouter from "./mi-modulo";
router.use(miModuloRouter);
```

### 3. Seed del módulo

```typescript
// artifacts/api-server/src/lib/seed-modules.ts
{ key: "mi-modulo", name: "Mi Módulo", description: "...", allowedRoles: ["super_admin", "admin"], orderIndex: 18 }
```

### 4. Página frontend

```typescript
// artifacts/dashboard/src/pages/dashboard/mi-modulo.tsx
export default function MiModuloPage() {
  return <div>Mi módulo</div>;
}
```

### 5. Routing y sidebar

```typescript
// artifacts/dashboard/src/App.tsx
import MiModuloPage from "@/pages/dashboard/mi-modulo";
const MiModulo = () => <DashboardLayout><MiModuloPage /></DashboardLayout>;
const RouteMiModulo = () => <ProtectedRoute moduleKey="mi-modulo" component={MiModulo} />;
// En el Switch:
<Route path="/dashboard/mi-modulo" component={RouteMiModulo} />
```

```typescript
// artifacts/dashboard/src/components/layout.tsx
import { Icon } from "lucide-react";
{ href: "/dashboard/mi-modulo", label: "Mi Módulo", icon: Icon, moduleKey: "mi-modulo" }
```

---

## Cómo agregar una nueva automatización/regla

Las reglas del motor de decisiones están en:

```
artifacts/dashboard/src/hooks/use-decision-engine.ts
```

### Estructura de una regla

```typescript
// En la función runRules():
if (/* condición */) {
  items.push({
    id: "mi-regla-id",
    type: "problem" | "risk" | "opportunity" | "action",
    level: "critical" | "high" | "medium" | "info",
    title: "Título claro de la situación",
    detail: "Detalle accionable y específico",
    href: "/dashboard/modulo-relacionado",
    rule: "nombre_de_la_regla",  // identificador único
  });
}
```

### Agregar datos a la regla

1. Añadir el `useQuery` necesario en el hook `useDecisionEngine`
2. Agregar el dato como parámetro a `runRules()` y `computeScores()`
3. Exportar el tipo correspondiente si es necesario

---

## Cómo agregar un nuevo widget al dashboard

Los widgets están en `artifacts/dashboard/src/pages/dashboard/index.tsx`.

### 1. Definir el widget

```typescript
const ALL_WIDGETS = [
  // ...existentes
  {
    id: "mi-widget",
    label: "Mi Widget",
    icon: <Icon className="h-4 w-4" />,
    defaultEnabled: true,
    component: <MiWidgetComponent />,
  },
];
```

### 2. Crear el componente

El widget debe ser auto-contenido, manejar sus propios datos con `useQuery`, y respetar los estados de carga.

### 3. La configuración persiste automáticamente

La visibilidad de cada widget se guarda en `localStorage` con la clave `dashboard-widget-config-v1`.

---

## Cómo escalar a backend completo

El sistema ya tiene backend real (Express + PostgreSQL). Para escalar:

### Capa de servicios

Crear lógica de negocio en `artifacts/api-server/src/services/`:

```typescript
// artifacts/api-server/src/services/due-dates.service.ts
export async function getUpcomingDueDates(userId: string, days: number) {
  // lógica de negocio aquí
}
```

### Adaptadores externos

Para integrar fuentes externas (AFIP API, bancos, etc.), crear adaptadores en `artifacts/api-server/src/adapters/`:

```typescript
// artifacts/api-server/src/adapters/afip.adapter.ts
export class AfipAdapter {
  async getVencimientos(): Promise<Vencimiento[]> { /* ... */ }
}
```

### Variables de entorno para integraciones

Usar el sistema de secretos de Replit para agregar API keys sin exponerlas en el código.

### Multi-tenancy

La tabla `user_settings` ya es multi-usuario (por `user_id` de Clerk). Para otros datos multi-usuario, agregar columna `user_id` a las tablas y filtrar por el usuario autenticado en cada query.

---

## Deuda técnica conocida

- Los switches de notificaciones en Ajustes (fiscal/viajes) no persisten — requieren conectar a `user_settings`
- El Gantt no tiene drag & drop — requiere biblioteca específica o lógica de mouse events
- Los scores de Salud y Estrés persisten en localStorage en lugar de backend
- No hay paginación en historial de objetivos diarios

---

## Checklist de prueba del sistema

- [ ] Login con Clerk funciona
- [ ] Dashboard carga con widgets
- [ ] Vencimientos: crear, editar, completar, recurrencia
- [ ] Tareas: crear, mover entre estados (Kanban)
- [ ] Clientes: CRUD completo
- [ ] Finanzas: agregar cuentas, ver resumen, configurar umbrales
- [ ] Objetivos del día: agregar, completar, ver historial
- [ ] Estrategia: crear objetivo, ver en Gantt
- [ ] Decisiones: ver score y lista de acciones
- [ ] Modo HOY: abre, muestra datos reales de todas las fuentes
- [ ] Campana de alertas: muestra badge y popover con alertas
- [ ] Ajustes: guardar preferencias, configurar sensibilidad de alertas
- [ ] Admin: panel visible solo para super_admin/admin
- [ ] Theme claro/oscuro funciona
