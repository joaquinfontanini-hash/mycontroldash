# Fix — Moneda, Ida y Vuelta, Precio Total y Rango de Fechas

## INSTRUCCIONES PARA REPLIT AGENT

Hay 4 correcciones a aplicar en el módulo de viajes. No toques nada más.

---

## FIX 1 — Conversión de moneda ARS → USD para comparar con presupuesto

### Problema
El usuario define su presupuesto en ARS (ej: $350.000 ARS).
SerpAPI retorna precios en USD (ej: $328 USD).
El sistema compara $328 con $350.000 sin convertir → muestra todo como "dentro del presupuesto".

### Solución
Antes de comparar el precio con el presupuesto, convertir usando el tipo de cambio actual.

En el servicio de búsqueda, agregar esta función:

```typescript
async function getUsdToArsRate(): Promise<number> {
  try {
    // API gratuita de tipo de cambio, sin key requerida
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await res.json();
    return data.rates?.ARS || 1200; // fallback si falla
  } catch {
    return 1200; // fallback conservador
  }
}
```

En el endpoint `/run`, antes del loop de destinos:

```typescript
// Obtener tipo de cambio si el presupuesto es en ARS
let usdToArs = 1;
if (profile.currency === 'ARS') {
  usdToArs = await getUsdToArsRate();
  console.log(`[FX] Tipo de cambio USD/ARS: ${usdToArs}`);
}
```

Al guardar cada resultado, agregar el precio convertido y mostrar ambos:

```typescript
// Precio en la moneda original de SerpAPI (USD)
const priceUsd = flight.price || 0;

// Precio convertido a la moneda del perfil
const priceInProfileCurrency = profile.currency === 'ARS' 
  ? priceUsd * usdToArs 
  : priceUsd;

// Presupuesto máximo con tolerancia
const budgetWithTolerance = profile.maxBudget * (1 + (profile.tolerancePercent || 20) / 100);

// Solo incluir si está dentro del presupuesto
if (priceInProfileCurrency > budgetWithTolerance) {
  console.log(`[Filter] Vuelo $${priceUsd} USD = $${priceInProfileCurrency} ARS > presupuesto $${budgetWithTolerance} ARS. Omitido.`);
  continue; // no agregar este resultado
}

// Guardar con precio en la moneda del perfil
allResults.push({
  ...resultData,
  price: Math.round(priceInProfileCurrency),      // precio en ARS
  currency: profile.currency,                      // "ARS"
  priceOriginal: priceUsd,                         // precio original en USD
  priceOriginalCurrency: 'USD',                    // moneda original
  exchangeRate: usdToArs,                          // tipo de cambio usado
});
```

En la card de resultado en el frontend, mostrar ambos precios:

```tsx
<div>
  <p className="text-2xl font-bold">
    {new Intl.NumberFormat('es-AR', { 
      style: 'currency', 
      currency: result.currency,
      maximumFractionDigits: 0 
    }).format(result.price)}
  </p>
  {result.priceOriginal && result.currency !== 'USD' && (
    <p className="text-xs text-muted-foreground">
      USD {result.priceOriginal} · TC: {result.exchangeRate?.toFixed(0)}
    </p>
  )}
</div>
```

Agregar columnas a la tabla `travel_search_results` si no existen:
```sql
ALTER TABLE travel_search_results 
  ADD COLUMN IF NOT EXISTS price_original_currency text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(12,4);
```

---

## FIX 2 — Ida y vuelta obligatorio

### Problema
El campo `returnDate` no se está enviando correctamente a SerpAPI,
por lo que busca solo ida.

### Solución
En el endpoint `/run`, asegurarse de que `return_date` SIEMPRE se envíe
cuando el perfil tiene `minDays` configurado:

```typescript
// Calcular returnDate SIEMPRE que haya minDays
const minDays = profile.minDays || 3; // mínimo 3 días si no está configurado

const returnDate = (() => {
  const d = new Date(departureDate);
  d.setDate(d.getDate() + minDays);
  return d.toISOString().split('T')[0];
})();

// En los params de SerpAPI, SIEMPRE incluir return_date:
const params = new URLSearchParams({
  engine: 'google_flights',
  api_key: process.env.SERPAPI_KEY!,
  departure_id: profile.originJson?.code || '',
  arrival_id: dest.code || '',
  outbound_date: departureDate,
  return_date: returnDate,   // ← SIEMPRE presente
  adults: String(profile.travelersCount || 1),
  currency: currency,
  hl: 'es',
  type: profile.directFlightOnly ? '2' : '1'
});
// NO hacer params.set condicional, el return_date va siempre
```

En la card de resultado, mostrar claramente ida y vuelta:

```tsx
<div className="flex items-center gap-1 text-sm">
  <span>📅</span>
  <span>
    {formatDate(result.departureDate)} → {formatDate(result.returnDate)}
  </span>
  {result.nights && (
    <span className="text-muted-foreground">· {result.nights} noches</span>
  )}
</div>
```

---

## FIX 3 — Precio total por grupo (no por persona)

### Problema
SerpAPI retorna el precio POR PERSONA.
Si el perfil tiene 2 viajeros, el precio total es el doble.

### Solución
Multiplicar el precio por la cantidad de viajeros ANTES de comparar con el presupuesto:

```typescript
const pricePerPerson = flight.price || 0;
const travelers = profile.travelersCount || 1;

// Precio total del grupo en USD
const totalPriceUsd = pricePerPerson * travelers;

// Convertir a moneda del perfil
const totalPriceInProfileCurrency = profile.currency === 'ARS'
  ? totalPriceUsd * usdToArs
  : totalPriceUsd;

// Comparar precio TOTAL con presupuesto (que también es total)
const budgetWithTolerance = profile.maxBudget * (1 + (profile.tolerancePercent || 20) / 100);

if (totalPriceInProfileCurrency > budgetWithTolerance) {
  console.log(`[Filter] Total ${travelers} pax: $${totalPriceInProfileCurrency} > presupuesto $${budgetWithTolerance}. Omitido.`);
  continue;
}

allResults.push({
  ...resultData,
  price: Math.round(totalPriceInProfileCurrency),   // precio TOTAL del grupo
  pricePerPerson: Math.round(
    profile.currency === 'ARS' ? pricePerPerson * usdToArs : pricePerPerson
  ),
  currency: profile.currency,
  priceOriginal: totalPriceUsd,
  travelersCount: travelers,
});
```

Agregar columna si no existe:
```sql
ALTER TABLE travel_search_results
  ADD COLUMN IF NOT EXISTS price_per_person numeric(12,2);
```

En la card mostrar desglose:
```tsx
<div>
  <p className="text-2xl font-bold">
    {formatCurrency(result.price, result.currency)}
  </p>
  {result.travelersCount > 1 && result.pricePerPerson && (
    <p className="text-xs text-muted-foreground">
      {formatCurrency(result.pricePerPerson, result.currency)} por persona · {result.travelersCount} pax
    </p>
  )}
</div>
```

---

## FIX 4 — Rango de fechas de salida

### Problema
Actualmente busca en una sola fecha. El usuario quiere resultados
para todas las fechas dentro de un rango (ej: del 1 al 30 de mayo).

### Solución

#### 4a — Agregar campos al perfil si no existen
```sql
ALTER TABLE travel_search_profiles
  ADD COLUMN IF NOT EXISTS departure_date_from text,
  ADD COLUMN IF NOT EXISTS departure_date_to text;
```

#### 4b — En el ProfileFormDialog, agregar en opciones avanzadas:

```tsx
{/* Rango de fechas de salida */}
<div className="space-y-2">
  <label className="text-sm font-medium">Rango de fechas de salida</label>
  <p className="text-xs text-muted-foreground">
    El sistema buscará ofertas para fechas dentro de este rango.
    Si no se define, busca desde hoy +30 días.
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

#### 4c — En el endpoint /run, generar múltiples fechas y buscar en cada una:

```typescript
// Generar fechas de búsqueda dentro del rango
function generateSearchDates(profile: any): string[] {
  const from = profile.departureDateFrom
    ? new Date(profile.departureDateFrom)
    : new Date(Date.now() + 14 * 86400000); // hoy + 14 días

  const to = profile.departureDateTo
    ? new Date(profile.departureDateTo)
    : new Date(Date.now() + 60 * 86400000); // hoy + 60 días

  const dates: string[] = [];
  const diffDays = Math.round((to.getTime() - from.getTime()) / 86400000);

  if (diffDays <= 7) {
    // Rango corto: buscar cada día
    for (let i = 0; i <= diffDays; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
  } else if (diffDays <= 30) {
    // Rango medio: buscar cada 3 días
    for (let i = 0; i <= diffDays; i += 3) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
  } else {
    // Rango largo: buscar cada 7 días (máx 8 fechas para no agotar cuota)
    for (let i = 0; i <= diffDays && dates.length < 8; i += 7) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
  }

  return dates;
}

// En el endpoint /run, reemplazar el loop de fechas:
const searchDates = generateSearchDates(profile);
console.log(`[Run] Buscando en ${searchDates.length} fechas:`, searchDates);

for (const dest of destinations.slice(0, 2)) {        // máx 2 destinos
  for (const date of searchDates) {                    // todas las fechas del rango
    // ... llamada a SerpAPI con esa fecha ...
    await new Promise(r => setTimeout(r, 500));        // pausa entre llamadas
  }
}
```

#### 4d — Mostrar en la card de resultado el badge de fecha:

```tsx
// Las cards ya muestran departureDate, asegurarse que sea visible y claro
<div className="text-sm font-medium">
  Salida: {new Date(result.departureDate + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })}
</div>
```

---

## RESUMEN DE CAMBIOS

| Fix | Qué resuelve |
|---|---|
| Fix 1 | Presupuesto en ARS se compara correctamente convirtiendo USD→ARS con TC real |
| Fix 2 | Ida y vuelta siempre presente en la búsqueda |
| Fix 3 | Precio mostrado es el total del grupo, con desglose por persona |
| Fix 4 | Rango de fechas configurable, busca en múltiples fechas del rango |

## NOTA IMPORTANTE SOBRE CUOTA SERPAPI

Con rango de fechas, cada fecha consume 1 llamada a SerpAPI.
Con 100 llamadas/mes gratuitas y búsqueda cada 7 días en rango de 60 días
= 8 fechas × 2 destinos = 16 llamadas por perfil por ejecución.
El sistema ya trackea esto en `travel_api_quotas` y para si se agota la cuota.
