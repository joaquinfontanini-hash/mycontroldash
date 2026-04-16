# Prompt de Corrección — Módulo de Viajes
## Fixes urgentes post v2.0

---

## INSTRUCCIONES PARA REPLIT AGENT

Hay 3 problemas a corregir en el módulo de viajes. Aplicá los cambios en orden.
No toques nada que no esté mencionado explícitamente acá.

---

## PROBLEMA 1 — Autocomplete de origen/destino no trae resultados

### Causa probable
El endpoint `GET /api/travel/locations?q=` no está funcionando correctamente,
o la tabla `travel_locations` está vacía (no se ejecutó el seed).

### Fix — Verificar y corregir el endpoint de autocomplete

1. Revisar que el endpoint exista y esté registrado en el router:
```typescript
router.get('/locations', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q as string || '').toLowerCase().trim();
    if (!q) return res.json([]);

    const results = await db.query.travelLocations.findMany({
      where: or(
        ilike(travelLocations.normalizedName, `%${q}%`),
        ilike(travelLocations.label, `%${q}%`),
        ilike(travelLocations.code, `%${q}%`),
        sql`${travelLocations.aliases}::text ILIKE ${'%' + q + '%'}`
      ),
      limit: 12,
      orderBy: [asc(travelLocations.label)]
    });

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

2. Verificar que la tabla `travel_locations` tenga datos. Ejecutar en la DB:
```sql
SELECT COUNT(*) FROM travel_locations;
```
Si retorna 0, ejecutar el seed llamando a `POST /api/travel/seed-locations`.

3. Si el endpoint no existe o da error, recrearlo completo como se muestra arriba.

---

## PROBLEMA 2 — Módulo de Configuración no carga ("error inesperado")

### Causa probable
El nuevo componente `ApiQuotaPanel` tiene un error de renderizado, probablemente
porque `GET /api/travel/api-quotas` o `GET /api/travel/scheduler-status` fallan
antes de que la tabla `travel_api_quotas` exista.

### Fix 1 — Migración de la tabla si no existe
Asegurarse de que esta migración se ejecute al iniciar el servidor:

```typescript
// En server/index.ts o donde se inicializa la DB, agregar:
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS travel_api_quotas (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_name      text NOT NULL,
    period_month  text NOT NULL,
    calls_used    integer DEFAULT 0,
    calls_limit   integer NOT NULL,
    last_call_at  timestamptz,
    updated_at    timestamptz DEFAULT now(),
    UNIQUE(api_name, period_month)
  )
`);
```

### Fix 2 — Proteger el componente ApiQuotaPanel con manejo de errores

Envolver el componente en un ErrorBoundary y proteger cada query:

```tsx
// En ApiQuotaPanel.tsx, proteger el render:
export function ApiQuotaPanel() {
  const { data: quotas, isLoading: quotasLoading, error: quotasError } = useApiQuotas();
  const { data: schedulerData, error: schedulerError } = useSchedulerStatus();

  // Si hay error en las queries, mostrar estado degradado en lugar de romper
  if (quotasError || schedulerError) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
        <p className="text-sm text-amber-800">
          No se pudo cargar el estado de las APIs. 
          Verificá que las variables de entorno SERPAPI_KEY y AMADEUS_CLIENT_ID estén configuradas.
        </p>
      </div>
    );
  }

  // ... resto del componente igual
}
```

### Fix 3 — Proteger el Tab de Configuración con ErrorBoundary

En el componente padre que renderiza las tabs, envolver el tab de configuración:

```tsx
// Agregar este ErrorBoundary simple:
class TabErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-6 text-center text-muted-foreground">
          <p>Error al cargar este panel. Intentá recargar la página.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// Usar en el tab de configuración:
<TabErrorBoundary>
  <ApiQuotaPanel />
</TabErrorBoundary>
```

---

## PROBLEMA 3 — Ampliar catálogo de aeropuertos

### Reemplazar completamente el seed de `travel_locations`

El nuevo catálogo debe incluir:
- Todas las capitales de América del Sur, Central y del Norte
- Principales capitales de Europa
- Aeropuertos argentinos: NQN (Neuquén), EZE, AEP, MDZ, COR, BRC, ROS, IGR, USH, MDQ, SLA, JUJ, TUC, CPC

```typescript
// En server/routes/travel.ts o donde esté el seed, reemplazar el array de locations:

const TRAVEL_LOCATIONS = [
  // ─── ARGENTINA ───────────────────────────────────────────
  { label: 'Neuquén (NQN)', normalizedName: 'neuquen', code: 'NQN', country: 'Argentina', region: 'Patagonia', type: 'airport', aliases: ['neuquen', 'nqn', 'chapelco'] },
  { label: 'Buenos Aires — Ezeiza (EZE)', normalizedName: 'buenos aires ezeiza', code: 'EZE', country: 'Argentina', region: 'Argentina', type: 'airport', aliases: ['eze', 'ezeiza', 'bue', 'buenos aires'] },
  { label: 'Buenos Aires — Aeroparque (AEP)', normalizedName: 'buenos aires aeroparque', code: 'AEP', country: 'Argentina', region: 'Argentina', type: 'airport', aliases: ['aep', 'aeroparque', 'jorge newbery'] },
  { label: 'Mendoza (MDZ)', normalizedName: 'mendoza', code: 'MDZ', country: 'Argentina', region: 'Cuyo', type: 'airport', aliases: ['mdz', 'mendoza'] },
  { label: 'Córdoba (COR)', normalizedName: 'cordoba', code: 'COR', country: 'Argentina', region: 'Centro', type: 'airport', aliases: ['cor', 'cordoba'] },
  { label: 'Bariloche (BRC)', normalizedName: 'bariloche', code: 'BRC', country: 'Argentina', region: 'Patagonia', type: 'airport', aliases: ['brc', 'bariloche', 'san carlos de bariloche'] },
  { label: 'Rosario (ROS)', normalizedName: 'rosario', code: 'ROS', country: 'Argentina', region: 'Litoral', type: 'airport', aliases: ['ros', 'rosario'] },
  { label: 'Puerto Iguazú (IGR)', normalizedName: 'puerto iguazu', code: 'IGR', country: 'Argentina', region: 'Litoral', type: 'airport', aliases: ['igr', 'iguazu', 'cataratas'] },
  { label: 'Ushuaia (USH)', normalizedName: 'ushuaia', code: 'USH', country: 'Argentina', region: 'Patagonia', type: 'airport', aliases: ['ush', 'ushuaia', 'tierra del fuego'] },
  { label: 'Mar del Plata (MDQ)', normalizedName: 'mar del plata', code: 'MDQ', country: 'Argentina', region: 'Argentina', type: 'airport', aliases: ['mdq', 'mar del plata', 'mardelplata'] },
  { label: 'Salta (SLA)', normalizedName: 'salta', code: 'SLA', country: 'Argentina', region: 'Norte', type: 'airport', aliases: ['sla', 'salta'] },
  { label: 'Jujuy (JUJ)', normalizedName: 'jujuy', code: 'JUJ', country: 'Argentina', region: 'Norte', type: 'airport', aliases: ['juj', 'jujuy', 'san salvador de jujuy'] },
  { label: 'Tucumán (TUC)', normalizedName: 'tucuman', code: 'TUC', country: 'Argentina', region: 'Norte', type: 'airport', aliases: ['tuc', 'tucuman'] },
  { label: 'Chapelco — San Martín de los Andes (CPC)', normalizedName: 'chapelco san martin de los andes', code: 'CPC', country: 'Argentina', region: 'Patagonia', type: 'airport', aliases: ['cpc', 'chapelco', 'san martin de los andes'] },
  { label: 'Trelew (REL)', normalizedName: 'trelew', code: 'REL', country: 'Argentina', region: 'Patagonia', type: 'airport', aliases: ['rel', 'trelew'] },
  { label: 'Puerto Madryn (PMY)', normalizedName: 'puerto madryn', code: 'PMY', country: 'Argentina', region: 'Patagonia', type: 'airport', aliases: ['pmy', 'puerto madryn'] },
  { label: 'Comodoro Rivadavia (CRD)', normalizedName: 'comodoro rivadavia', code: 'CRD', country: 'Argentina', region: 'Patagonia', type: 'airport', aliases: ['crd', 'comodoro rivadavia', 'rivadavia'] },
  { label: 'Santa Rosa (RSA)', normalizedName: 'santa rosa', code: 'RSA', country: 'Argentina', region: 'Argentina', type: 'airport', aliases: ['rsa', 'santa rosa', 'la pampa'] },
  { label: 'Corrientes (CNQ)', normalizedName: 'corrientes', code: 'CNQ', country: 'Argentina', region: 'Litoral', type: 'airport', aliases: ['cnq', 'corrientes'] },
  { label: 'Posadas (PSS)', normalizedName: 'posadas', code: 'PSS', country: 'Argentina', region: 'Litoral', type: 'airport', aliases: ['pss', 'posadas'] },
  { label: 'Río Gallegos (RGL)', normalizedName: 'rio gallegos', code: 'RGL', country: 'Argentina', region: 'Patagonia', type: 'airport', aliases: ['rgl', 'rio gallegos'] },
  { label: 'Villa Mercedes (VME)', normalizedName: 'villa mercedes', code: 'VME', country: 'Argentina', region: 'Cuyo', type: 'airport', aliases: ['vme', 'villa mercedes', 'san luis'] },

  // ─── SUDAMÉRICA — CAPITALES ───────────────────────────────
  { label: 'Santiago de Chile (SCL)', normalizedName: 'santiago chile', code: 'SCL', country: 'Chile', region: 'Sudamérica', type: 'airport', aliases: ['scl', 'santiago', 'chile'] },
  { label: 'Montevideo (MVD)', normalizedName: 'montevideo', code: 'MVD', country: 'Uruguay', region: 'Sudamérica', type: 'airport', aliases: ['mvd', 'montevideo', 'uruguay'] },
  { label: 'São Paulo (GRU)', normalizedName: 'sao paulo', code: 'GRU', country: 'Brasil', region: 'Sudamérica', type: 'airport', aliases: ['gru', 'sao paulo', 'guarulhos', 'brasil'] },
  { label: 'Río de Janeiro (GIG)', normalizedName: 'rio de janeiro', code: 'GIG', country: 'Brasil', region: 'Sudamérica', type: 'airport', aliases: ['gig', 'rio de janeiro', 'galeao'] },
  { label: 'Bogotá (BOG)', normalizedName: 'bogota', code: 'BOG', country: 'Colombia', region: 'Sudamérica', type: 'airport', aliases: ['bog', 'bogota', 'colombia', 'el dorado'] },
  { label: 'Lima (LIM)', normalizedName: 'lima', code: 'LIM', country: 'Perú', region: 'Sudamérica', type: 'airport', aliases: ['lim', 'lima', 'peru'] },
  { label: 'Quito (UIO)', normalizedName: 'quito', code: 'UIO', country: 'Ecuador', region: 'Sudamérica', type: 'airport', aliases: ['uio', 'quito', 'ecuador'] },
  { label: 'Caracas (CCS)', normalizedName: 'caracas', code: 'CCS', country: 'Venezuela', region: 'Sudamérica', type: 'airport', aliases: ['ccs', 'caracas', 'venezuela'] },
  { label: 'La Paz (LPB)', normalizedName: 'la paz', code: 'LPB', country: 'Bolivia', region: 'Sudamérica', type: 'airport', aliases: ['lpb', 'la paz', 'bolivia'] },
  { label: 'Asunción (ASU)', normalizedName: 'asuncion', code: 'ASU', country: 'Paraguay', region: 'Sudamérica', type: 'airport', aliases: ['asu', 'asuncion', 'paraguay'] },
  { label: 'Brasilia (BSB)', normalizedName: 'brasilia', code: 'BSB', country: 'Brasil', region: 'Sudamérica', type: 'airport', aliases: ['bsb', 'brasilia'] },
  { label: 'Medellín (MDE)', normalizedName: 'medellin', code: 'MDE', country: 'Colombia', region: 'Sudamérica', type: 'airport', aliases: ['mde', 'medellin'] },
  { label: 'Guayaquil (GYE)', normalizedName: 'guayaquil', code: 'GYE', country: 'Ecuador', region: 'Sudamérica', type: 'airport', aliases: ['gye', 'guayaquil'] },

  // ─── CENTROAMÉRICA Y CARIBE ───────────────────────────────
  { label: 'La Habana (HAV)', normalizedName: 'la habana', code: 'HAV', country: 'Cuba', region: 'Caribe', type: 'airport', aliases: ['hav', 'habana', 'cuba'] },
  { label: 'Cancún (CUN)', normalizedName: 'cancun', code: 'CUN', country: 'México', region: 'Caribe', type: 'airport', aliases: ['cun', 'cancun', 'riviera maya', 'mexico caribe'] },
  { label: 'Ciudad de México (MEX)', normalizedName: 'ciudad de mexico', code: 'MEX', country: 'México', region: 'Norteamérica', type: 'airport', aliases: ['mex', 'ciudad de mexico', 'cdmx', 'mexico'] },
  { label: 'San José de Costa Rica (SJO)', normalizedName: 'san jose costa rica', code: 'SJO', country: 'Costa Rica', region: 'Centroamérica', type: 'airport', aliases: ['sjo', 'san jose', 'costa rica'] },
  { label: 'Ciudad de Panamá (PTY)', normalizedName: 'ciudad de panama', code: 'PTY', country: 'Panamá', region: 'Centroamérica', type: 'airport', aliases: ['pty', 'panama', 'tocumen'] },
  { label: 'Santo Domingo (SDQ)', normalizedName: 'santo domingo', code: 'SDQ', country: 'República Dominicana', region: 'Caribe', type: 'airport', aliases: ['sdq', 'santo domingo', 'republica dominicana'] },
  { label: 'Punta Cana (PUJ)', normalizedName: 'punta cana', code: 'PUJ', country: 'República Dominicana', region: 'Caribe', type: 'airport', aliases: ['puj', 'punta cana'] },
  { label: 'Guadalajara (GDL)', normalizedName: 'guadalajara', code: 'GDL', country: 'México', region: 'Norteamérica', type: 'airport', aliases: ['gdl', 'guadalajara'] },

  // ─── NORTEAMÉRICA ─────────────────────────────────────────
  { label: 'Miami (MIA)', normalizedName: 'miami', code: 'MIA', country: 'Estados Unidos', region: 'Norteamérica', type: 'airport', aliases: ['mia', 'miami', 'florida'] },
  { label: 'Nueva York — JFK (JFK)', normalizedName: 'nueva york jfk', code: 'JFK', country: 'Estados Unidos', region: 'Norteamérica', type: 'airport', aliases: ['jfk', 'nueva york', 'new york', 'kennedy'] },
  { label: 'Nueva York — Newark (EWR)', normalizedName: 'nueva york newark', code: 'EWR', country: 'Estados Unidos', region: 'Norteamérica', type: 'airport', aliases: ['ewr', 'newark', 'new york'] },
  { label: 'Los Ángeles (LAX)', normalizedName: 'los angeles', code: 'LAX', country: 'Estados Unidos', region: 'Norteamérica', type: 'airport', aliases: ['lax', 'los angeles', 'california'] },
  { label: 'Chicago (ORD)', normalizedName: 'chicago', code: 'ORD', country: 'Estados Unidos', region: 'Norteamérica', type: 'airport', aliases: ['ord', 'chicago', 'ohare'] },
  { label: 'Toronto (YYZ)', normalizedName: 'toronto', code: 'YYZ', country: 'Canadá', region: 'Norteamérica', type: 'airport', aliases: ['yyz', 'toronto', 'canada', 'pearson'] },
  { label: 'Ottawa (YOW)', normalizedName: 'ottawa', code: 'YOW', country: 'Canadá', region: 'Norteamérica', type: 'airport', aliases: ['yow', 'ottawa'] },

  // ─── EUROPA — CAPITALES ───────────────────────────────────
  { label: 'Madrid (MAD)', normalizedName: 'madrid', code: 'MAD', country: 'España', region: 'Europa', type: 'airport', aliases: ['mad', 'madrid', 'barajas', 'espana'] },
  { label: 'Barcelona (BCN)', normalizedName: 'barcelona', code: 'BCN', country: 'España', region: 'Europa', type: 'airport', aliases: ['bcn', 'barcelona', 'el prat'] },
  { label: 'Londres — Heathrow (LHR)', normalizedName: 'londres heathrow', code: 'LHR', country: 'Reino Unido', region: 'Europa', type: 'airport', aliases: ['lhr', 'londres', 'london', 'heathrow'] },
  { label: 'París — CDG (CDG)', normalizedName: 'paris cdg', code: 'CDG', country: 'Francia', region: 'Europa', type: 'airport', aliases: ['cdg', 'paris', 'charles de gaulle', 'francia'] },
  { label: 'Roma — Fiumicino (FCO)', normalizedName: 'roma fiumicino', code: 'FCO', country: 'Italia', region: 'Europa', type: 'airport', aliases: ['fco', 'roma', 'rome', 'fiumicino', 'italia'] },
  { label: 'Frankfurt (FRA)', normalizedName: 'frankfurt', code: 'FRA', country: 'Alemania', region: 'Europa', type: 'airport', aliases: ['fra', 'frankfurt', 'alemania'] },
  { label: 'Berlín (BER)', normalizedName: 'berlin', code: 'BER', country: 'Alemania', region: 'Europa', type: 'airport', aliases: ['ber', 'berlin', 'brandenburgo'] },
  { label: 'Ámsterdam (AMS)', normalizedName: 'amsterdam', code: 'AMS', country: 'Países Bajos', region: 'Europa', type: 'airport', aliases: ['ams', 'amsterdam', 'schiphol', 'holanda'] },
  { label: 'Lisboa (LIS)', normalizedName: 'lisboa', code: 'LIS', country: 'Portugal', region: 'Europa', type: 'airport', aliases: ['lis', 'lisboa', 'lisbon', 'portugal'] },
  { label: 'Zúrich (ZRH)', normalizedName: 'zurich', code: 'ZRH', country: 'Suiza', region: 'Europa', type: 'airport', aliases: ['zrh', 'zurich', 'suiza'] },
  { label: 'Viena (VIE)', normalizedName: 'viena', code: 'VIE', country: 'Austria', region: 'Europa', type: 'airport', aliases: ['vie', 'viena', 'vienna', 'austria'] },
  { label: 'Atenas (ATH)', normalizedName: 'atenas', code: 'ATH', country: 'Grecia', region: 'Europa', type: 'airport', aliases: ['ath', 'atenas', 'athens', 'grecia'] },
  { label: 'Bruselas (BRU)', normalizedName: 'bruselas', code: 'BRU', country: 'Bélgica', region: 'Europa', type: 'airport', aliases: ['bru', 'bruselas', 'brussels', 'belgica'] },
  { label: 'Estocolmo (ARN)', normalizedName: 'estocolmo', code: 'ARN', country: 'Suecia', region: 'Europa', type: 'airport', aliases: ['arn', 'estocolmo', 'stockholm', 'suecia'] },
  { label: 'Oslo (OSL)', normalizedName: 'oslo', code: 'OSL', country: 'Noruega', region: 'Europa', type: 'airport', aliases: ['osl', 'oslo', 'noruega'] },
  { label: 'Copenhague (CPH)', normalizedName: 'copenhague', code: 'CPH', country: 'Dinamarca', region: 'Europa', type: 'airport', aliases: ['cph', 'copenhague', 'copenhagen', 'dinamarca'] },
  { label: 'Helsinki (HEL)', normalizedName: 'helsinki', code: 'HEL', country: 'Finlandia', region: 'Europa', type: 'airport', aliases: ['hel', 'helsinki', 'finlandia'] },
  { label: 'Varsovia (WAW)', normalizedName: 'varsovia', code: 'WAW', country: 'Polonia', region: 'Europa', type: 'airport', aliases: ['waw', 'varsovia', 'warsaw', 'polonia'] },
  { label: 'Praga (PRG)', normalizedName: 'praga', code: 'PRG', country: 'República Checa', region: 'Europa', type: 'airport', aliases: ['prg', 'praga', 'prague'] },
  { label: 'Budapest (BUD)', normalizedName: 'budapest', code: 'BUD', country: 'Hungría', region: 'Europa', type: 'airport', aliases: ['bud', 'budapest', 'hungria'] },
  { label: 'Bucarest (OTP)', normalizedName: 'bucarest', code: 'OTP', country: 'Rumanía', region: 'Europa', type: 'airport', aliases: ['otp', 'bucarest', 'bucharest', 'rumania'] },
  { label: 'Dublín (DUB)', normalizedName: 'dublin', code: 'DUB', country: 'Irlanda', region: 'Europa', type: 'airport', aliases: ['dub', 'dublin', 'irlanda'] },
  { label: 'Milán (MXP)', normalizedName: 'milan', code: 'MXP', country: 'Italia', region: 'Europa', type: 'airport', aliases: ['mxp', 'milan', 'malpensa'] },

  // ─── ASIA Y ORIENTE MEDIO ────────────────────────────────
  { label: 'Dubái (DXB)', normalizedName: 'dubai', code: 'DXB', country: 'Emiratos Árabes', region: 'Asia', type: 'airport', aliases: ['dxb', 'dubai', 'emiratos'] },
  { label: 'Bangkok (BKK)', normalizedName: 'bangkok', code: 'BKK', country: 'Tailandia', region: 'Asia', type: 'airport', aliases: ['bkk', 'bangkok', 'tailandia'] },
  { label: 'Tokio — Narita (NRT)', normalizedName: 'tokio narita', code: 'NRT', country: 'Japón', region: 'Asia', type: 'airport', aliases: ['nrt', 'tokio', 'tokyo', 'japon', 'narita'] },
  { label: 'Singapur (SIN)', normalizedName: 'singapur', code: 'SIN', country: 'Singapur', region: 'Asia', type: 'airport', aliases: ['sin', 'singapur', 'singapore', 'changi'] },
  { label: 'Sídney (SYD)', normalizedName: 'sidney', code: 'SYD', country: 'Australia', region: 'Oceanía', type: 'airport', aliases: ['syd', 'sidney', 'sydney', 'australia'] },
  { label: 'Ciudad del Cabo (CPT)', normalizedName: 'ciudad del cabo', code: 'CPT', country: 'Sudáfrica', region: 'África', type: 'airport', aliases: ['cpt', 'ciudad del cabo', 'cape town', 'sudafrica'] },
];

// En el endpoint seed, reemplazar el array existente por TRAVEL_LOCATIONS
// Y cambiar la lógica para que SIEMPRE actualice (no solo si está vacío):

router.post('/seed-locations', requireAdmin, async (req, res) => {
  try {
    // Limpiar y reinsertar para asegurar datos frescos
    await db.delete(travelLocations);
    
    const locationsWithId = TRAVEL_LOCATIONS.map(loc => ({
      ...loc,
      id: crypto.randomUUID(),
      createdAt: new Date()
    }));
    
    await db.insert(travelLocations).values(locationsWithId);
    
    res.json({ 
      ok: true, 
      message: `${locationsWithId.length} ubicaciones cargadas correctamente` 
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## PROBLEMA 4 — Ejecutar el seed automáticamente al iniciar

Para que el catálogo siempre esté disponible sin tener que llamarlo manualmente,
agregar en la inicialización del servidor:

```typescript
// En server/index.ts, después de conectar la DB:
async function seedLocationsIfEmpty() {
  try {
    const count = await db.select({ count: sql<number>`count(*)` })
      .from(travelLocations);
    const total = Number(count[0]?.count || 0);
    
    if (total < 10) {
      console.log('[Seed] Cargando catálogo de ubicaciones...');
      // Ejecutar el mismo array TRAVEL_LOCATIONS del seed endpoint
      await db.delete(travelLocations);
      await db.insert(travelLocations).values(
        TRAVEL_LOCATIONS.map(loc => ({
          ...loc,
          id: crypto.randomUUID(),
          createdAt: new Date()
        }))
      );
      console.log(`[Seed] ${TRAVEL_LOCATIONS.length} ubicaciones cargadas.`);
    }
  } catch (err) {
    console.error('[Seed] Error al cargar ubicaciones:', err);
  }
}

// Llamar al iniciar:
await seedLocationsIfEmpty();
```

---

## VERIFICACIÓN FINAL

Después de aplicar todos los cambios, verificar:

1. Tipear "neu" en el campo Origen → debe mostrar "Neuquén (NQN)"
2. Tipear "brc" → debe mostrar "Bariloche (BRC)"
3. Tipear "mad" → debe mostrar "Madrid (MAD)"
4. Abrir Tab Configuración → debe cargar sin error
5. Verificar que el panel de cuotas muestre SerpAPI y Amadeus con barras de progreso

Si el autocomplete sigue sin funcionar después del fix, verificar en la consola del navegador
(F12 → Network) qué responde `GET /api/travel/locations?q=neu` y reportar el error exacto.
