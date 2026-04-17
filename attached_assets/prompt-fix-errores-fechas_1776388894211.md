# Fix — Mensaje de error descriptivo + Rango de fechas + Lógica semanal

## INSTRUCCIONES PARA REPLIT AGENT
Tres mejoras a aplicar. No toques nada más.

---

## MEJORA 1 — Mensaje de error descriptivo en la card del perfil

### Problema
La card muestra "· error" en rojo pero sin explicar qué pasó.

### Solución
En el campo `lastRunSummaryJson` ya se guardan los errores. Mostrarlos en la card.

En el componente de la card de perfil de búsqueda, reemplazar el indicador de error actual:

```tsx
// Reemplazar esto:
<span className="text-red-500">· error</span>

// Por esto:
{profile.lastRunStatus === 'error' && (
  <div className="mt-2">
    <span className="text-red-500 text-xs font-medium">● Error en última ejecución</span>
    {profile.lastRunSummaryJson?.errors?.length > 0 && (
      <p className="text-xs text-red-400 mt-0.5 leading-relaxed">
        {profile.lastRunSummaryJson.errors[0]}
      </p>
    )}
  </div>
)}

{profile.lastRunStatus === 'ok' && profile.lastRunSummaryJson?.count === 0 && (
  <div className="mt-2">
    <span className="text-amber-500 text-xs">● Sin resultados — precio por debajo del mercado actual</span>
  </div>
)}

{profile.lastRunStatus === 'ok' && profile.lastRunSummaryJson?.count > 0 && (
  <div className="mt-2">
    <span className="text-green-500 text-xs">
      ● {profile.lastRunSummaryJson.count} oferta{profile.lastRunSummaryJson.count > 1 ? 's' : ''} encontrada{profile.lastRunSummaryJson.count > 1 ? 's' : ''}
    </span>
  </div>
)}
```

También actualizar el endpoint `/run` para guardar errores descriptivos en `lastRunSummaryJson`:

```typescript
// Al actualizar el perfil después del run, asegurarse de incluir errores:
await db.update(travelSearchProfiles)
  .set({
    lastRunAt: new Date(),
    lastRunStatus: newResults.length > 0 ? 'ok' : errors.length > 0 ? 'error' : 'ok',
    lastRunSummaryJson: {
      count: newResults.length,
      skipped: allResults.length - newResults.length,
      errors: errors.length > 0 ? errors : [],
      ranAt: new Date().toISOString()
    },
    updatedAt: new Date()
  })
  .where(eq(travelSearchProfiles.id, profileId));
```

---

## MEJORA 2 — Rango de fechas en el formulario de búsqueda

### Agregar campos al schema de la DB si no existen:
```sql
ALTER TABLE travel_search_profiles
  ADD COLUMN IF NOT EXISTS departure_date_from text,
  ADD COLUMN IF NOT EXISTS departure_date_to text;
```

### Agregar al schema Drizzle:
```typescript
departureDateFrom: text('departure_date_from'),
departureDateTo: text('departure_date_to'),
```

### Agregar al schema Zod de validación:
```typescript
departureDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
departureDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
```

### En el ProfileFormDialog, agregar esta sección DENTRO del formulario principal (no en opciones avanzadas — es un campo importante):

Ubicarla después del campo de presupuesto y antes de viajeros:

```tsx
{/* Rango de fechas de salida */}
<div className="space-y-2">
  <label className="text-sm font-medium">
    Período de búsqueda
    <span className="text-muted-foreground font-normal ml-1">(opcional)</span>
  </label>
  <p className="text-xs text-muted-foreground">
    El sistema buscará ofertas con salida dentro de este período.
    Si no se define, busca desde hoy hasta 60 días adelante.
  </p>
  <div className="grid grid-cols-2 gap-3">
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">Desde</label>
      <input
        type="date"
        {...form.register('departureDateFrom')}
        min={new Date().toISOString().split('T')[0]}
        className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
      />
    </div>
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">Hasta</label>
      <input
        type="date"
        {...form.register('departureDateTo')}
        min={new Date().toISOString().split('T')[0]}
        className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
      />
    </div>
  </div>
</div>
```

### Mostrar el período en la card del perfil:
```tsx
{(profile.departureDateFrom || profile.departureDateTo) && (
  <p className="text-xs text-muted-foreground">
    📅 {profile.departureDateFrom
      ? new Date(profile.departureDateFrom + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Hoy'
    }
    {' → '}
    {profile.departureDateTo
      ? new Date(profile.departureDateTo + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Sin límite'
    }
  </p>
)}
```

---

## MEJORA 3 — Lógica de búsqueda semanal para rangos largos

### Problema
Un rango Abril-Diciembre 2026 tiene ~270 días.
Si se busca en cada fecha se agotan las 100 llamadas de SerpAPI en 2 días.

### Solución
Distribuir las búsquedas inteligentemente según el largo del rango,
y rotar las fechas en cada ejecución para cubrir todo el período con el tiempo.

Reemplazar la función `generateSearchDates` en el endpoint `/run`:

```typescript
function generateSearchDates(profile: any): string[] {
  const now = new Date();
  
  const from = profile.departureDateFrom
    ? new Date(profile.departureDateFrom + 'T12:00:00')
    : new Date(now.getTime() + 14 * 86400000);

  const to = profile.departureDateTo
    ? new Date(profile.departureDateTo + 'T12:00:00')
    : new Date(now.getTime() + 60 * 86400000);

  // No buscar fechas pasadas
  const effectiveFrom = from < now ? now : from;
  if (effectiveFrom > to) return [];

  const diffDays = Math.round((to.getTime() - effectiveFrom.getTime()) / 86400000);
  const dates: string[] = [];

  if (diffDays <= 14) {
    // Rango corto (≤2 semanas): buscar cada 2 días, máx 7 fechas
    for (let i = 0; i <= diffDays && dates.length < 7; i += 2) {
      const d = new Date(effectiveFrom);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
  } else if (diffDays <= 60) {
    // Rango medio (2 semanas - 2 meses): buscar cada semana, máx 8 fechas
    for (let i = 0; i <= diffDays && dates.length < 8; i += 7) {
      const d = new Date(effectiveFrom);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
  } else {
    // Rango largo (>2 meses, ej: Abril-Diciembre):
    // Tomar 1 fecha representativa por mes del rango, máx 9 fechas
    // Rotar el día del mes según el número de ejecución para cubrir distintos días
    const runCount = profile.lastRunSummaryJson?.runCount || 0;
    const dayOffset = (runCount % 4) * 7; // rota entre días 1, 8, 15, 22 del mes

    let current = new Date(effectiveFrom);
    current.setDate(1 + dayOffset); // primer lunes/martes/etc del mes según rotación

    while (current <= to && dates.length < 9) {
      if (current >= effectiveFrom) {
        dates.push(current.toISOString().split('T')[0]);
      }
      // Avanzar al mismo día del mes siguiente
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1 + dayOffset);
    }
  }

  return dates.filter(d => d >= now.toISOString().split('T')[0]); // solo fechas futuras
}
```

También actualizar `lastRunSummaryJson` para incluir `runCount`:
```typescript
lastRunSummaryJson: {
  count: newResults.length,
  skipped: allResults.length - newResults.length,
  errors: errors.length > 0 ? errors : [],
  runCount: (profile.lastRunSummaryJson?.runCount || 0) + 1,
  ranAt: new Date().toISOString()
}
```

### Resultado para tu caso (Abril-Diciembre 2026):
- Ejecución 1: busca el día 1 de cada mes → 9 fechas = 9 llamadas SerpAPI
- Ejecución 2 (semana siguiente): busca el día 8 de cada mes → 9 fechas
- Ejecución 3: día 15 de cada mes → 9 fechas
- Ejecución 4: día 22 de cada mes → 9 fechas
- Con 2 perfiles y ejecución semanal: 18 llamadas/semana = ~72 llamadas/mes ✅

---

## VERIFICACIÓN FINAL

1. Editá un perfil existente → debe aparecer el campo "Período de búsqueda" con fecha desde/hasta
2. Ponele Abril 2026 → Diciembre 2026
3. Ejecutá → la card debe mostrar cuántas ofertas encontró o el mensaje de error descriptivo
4. Si el precio está muy por debajo del mercado → debe decir "Sin resultados — precio por debajo del mercado actual"
5. En Tab Configuración → verificar que el panel de cuotas muestre las llamadas usadas incrementando
