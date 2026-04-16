# Fix Crítico — Reemplazar simulación por SerpAPI real

## INSTRUCCIONES PARA REPLIT AGENT

El endpoint POST /api/travel/search-profiles/:id/run sigue generando resultados
simulados inventados. Necesito que lo reemplaces completamente por búsquedas
reales usando SerpAPI.

---

## PASO 1 — Encontrar y eliminar la simulación

Buscá en el código cualquier función o bloque que contenga alguna de estas palabras:
- "Simulación"
- "simulated: true"
- "templates" con nombres como "Paquete todo incluido", "Escapada vuelo", "Oferta flash"
- "priceFactorMin", "priceFactorMax"
- "fuentes simuladas" o arrays con "Despegar.com", "LATAM", "Aerolíneas Argentinas" como fuentes hardcodeadas
- Cualquier Math.random() usado para generar precios de vuelos

Eliminá completamente esa lógica. No la comentes, eliminala.

---

## PASO 2 — Reemplazar el endpoint /run completo

Encontrá el archivo donde está `router.post` para la ruta
`/search-profiles/:id/run` o similar y reemplazá TODA la función handler
con esto:

```typescript
router.post('/search-profiles/:id/run', requireAuth, async (req, res) => {
  try {
    const userId = getCurrentUserIdNum(req);
    const profileId = req.params.id;

    // Verificar ownership
    const profile = await db.query.travelSearchProfiles.findFirst({
      where: and(
        eq(travelSearchProfiles.id, profileId),
        eq(travelSearchProfiles.userId, userId)
      )
    });

    if (!profile) {
      return res.status(404).json({ error: 'Perfil no encontrado' });
    }

    // Rate limiting: máx 1 ejecución cada 30 minutos
    if (profile.lastRunAt) {
      const minsSince = (Date.now() - new Date(profile.lastRunAt).getTime()) / 60000;
      if (minsSince < 30) {
        return res.status(429).json({
          error: `Esperá ${Math.ceil(30 - minsSince)} minutos antes de volver a ejecutar este perfil.`
        });
      }
    }

    // Verificar que SERPAPI_KEY esté configurada
    if (!process.env.SERPAPI_KEY) {
      return res.status(500).json({
        error: 'SERPAPI_KEY no está configurada en las variables de entorno.'
      });
    }

    const searchType = profile.searchType || 'vuelos';
    const allResults: any[] = [];
    const errors: string[] = [];

    // Obtener destinos del perfil
    const destinations: any[] = profile.destinationsJson || [];
    if (destinations.length === 0) {
      return res.status(400).json({ error: 'El perfil no tiene destinos configurados.' });
    }

    // Calcular fecha de salida (hoy + 30 días por defecto)
    const departureDate = profile.departureDateFrom
      ? profile.departureDateFrom
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() + 30);
          return d.toISOString().split('T')[0];
        })();

    // Calcular fecha de regreso si hay minDays
    const returnDate = profile.minDays
      ? (() => {
          const d = new Date(departureDate);
          d.setDate(d.getDate() + profile.minDays);
          return d.toISOString().split('T')[0];
        })()
      : undefined;

    // ── BÚSQUEDA REAL EN SERPAPI ──────────────────────────────
    for (const dest of destinations.slice(0, 3)) {
      try {
        const currency = (profile.currency === 'ARS') ? 'USD' : (profile.currency || 'USD');

        const params = new URLSearchParams({
          engine: 'google_flights',
          api_key: process.env.SERPAPI_KEY!,
          departure_id: profile.originJson?.code || '',
          arrival_id: dest.code || '',
          outbound_date: departureDate,
          adults: String(profile.travelersCount || 1),
          currency,
          hl: 'es',
          type: profile.directFlightOnly ? '2' : '1'
        });

        if (returnDate) {
          params.set('return_date', returnDate);
        }

        console.log(`[SerpAPI] Buscando vuelos ${profile.originJson?.code} → ${dest.code} para ${departureDate}`);

        const serpRes = await fetch(`https://serpapi.com/search.json?${params}`);
        const serpData = await serpRes.json();

        if (serpData.error) {
          errors.push(`SerpAPI error para ${dest.code}: ${serpData.error}`);
          continue;
        }

        // Usar best_flights primero, luego other_flights
        const flights = [
          ...(serpData.best_flights || []),
          ...(serpData.other_flights || [])
        ].slice(0, 3);

        if (flights.length === 0) {
          errors.push(`Sin resultados de SerpAPI para ${dest.code}`);
          continue;
        }

        for (let i = 0; i < flights.length; i++) {
          const flight = flights[i];
          const firstLeg = flight.flights?.[0];
          const lastLeg = flight.flights?.[flight.flights.length - 1];

          // Calcular escalas
          const stops = (flight.flights?.length || 1) - 1;

          // Aerolínea del primer segmento
          const airline = firstLeg?.airline || 'Aerolínea';

          // Hora de salida y llegada
          const depTime = firstLeg?.departure_airport?.time?.split(' ')[1] || null;
          const arrTime = lastLeg?.arrival_airport?.time?.split(' ')[1] || null;
          const depDate = firstLeg?.departure_airport?.time?.split(' ')[0] || departureDate;

          // Link REAL a Google Flights
          const externalUrl = serpData.search_metadata?.google_flights_url || null;

          allResults.push({
            searchProfileId: profileId,
            userId,
            source: 'Google Flights',
            apiSource: 'serpapi',
            searchType: 'vuelo',
            externalId: `${profileId}:serpapi:${dest.code}:${departureDate}:${i}`,
            externalUrl,
            title: `Vuelo ${profile.originJson?.code} → ${dest.code} — ${airline}`,
            originJson: profile.originJson,
            destinationJson: dest,
            region: dest.region || null,
            country: dest.country || null,
            price: flight.price || 0,
            currency,
            travelersCount: profile.travelersCount || 1,
            airline,
            stops,
            durationMinutes: flight.total_duration || null,
            departureDate: depDate,
            returnDate: returnDate || null,
            departureTime: depTime,
            arrivalTime: arrTime,
            days: profile.minDays || null,
            nights: profile.minDays ? profile.minDays - 1 : null,
            confidenceScore: 95,
            validationStatus: 'validated',
            status: 'new',
            rawPayloadJson: {
              simulated: false,
              source: 'serpapi',
              runAt: new Date().toISOString()
            },
            foundAt: new Date()
          });
        }

        // Registrar uso de cuota
        const month = new Date().toISOString().slice(0, 7);
        await db.execute(sql`
          INSERT INTO travel_api_quotas (id, api_name, period_month, calls_used, calls_limit, last_call_at, updated_at)
          VALUES (gen_random_uuid(), 'serpapi', ${month}, 1, 100, now(), now())
          ON CONFLICT (api_name, period_month)
          DO UPDATE SET calls_used = travel_api_quotas.calls_used + 1, last_call_at = now(), updated_at = now()
        `);

      } catch (err: any) {
        errors.push(`Error buscando ${dest.code}: ${err.message}`);
        console.error(`[SerpAPI] Error:`, err);
      }

      // Pausa entre destinos
      await new Promise(r => setTimeout(r, 800));
    }

    // ── DEDUPLICAR E INSERTAR ─────────────────────────────────
    const existing = await db.select({ externalId: travelSearchResults.externalId })
      .from(travelSearchResults)
      .where(eq(travelSearchResults.searchProfileId, profileId));

    const existingIds = new Set(existing.map((r: any) => r.externalId));
    const newResults = allResults.filter(r => !existingIds.has(r.externalId));

    if (newResults.length > 0) {
      await db.insert(travelSearchResults).values(newResults);
    }

    // Actualizar estado del perfil
    await db.update(travelSearchProfiles)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: errors.length === 0 || newResults.length > 0 ? 'ok' : 'error',
        lastRunSummaryJson: {
          count: newResults.length,
          skipped: allResults.length - newResults.length,
          errors,
          ranAt: new Date().toISOString()
        },
        updatedAt: new Date()
      })
      .where(eq(travelSearchProfiles.id, profileId));

    res.json({
      ok: true,
      resultsFound: newResults.length,
      skipped: allResults.length - newResults.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err: any) {
    console.error('[/run] Error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

---

## PASO 3 — Actualizar la card de resultado en el frontend

En el componente que renderiza cada resultado de viaje, asegurarte de que:

1. El botón "Ver oferta" use `result.externalUrl` y abra en nueva pestaña:

```tsx
{result.externalUrl ? (
  <a
    href={result.externalUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
  >
    Ver oferta en Google Flights →
  </a>
) : (
  <span className="text-xs text-muted-foreground">Link no disponible</span>
)}
```

2. El campo `source` muestre "Google Flights" en lugar de "Simulación":
```tsx
<span className="text-xs text-muted-foreground">{result.source} · {profile?.name}</span>
```

3. Mostrar escalas correctamente:
```tsx
{result.durationMinutes && (
  <span className="text-sm text-muted-foreground">
    {Math.floor(result.durationMinutes / 60)}h {result.durationMinutes % 60}min
    {' · '}
    {result.stops === 0 ? 'Directo' : `${result.stops} escala${result.stops > 1 ? 's' : ''}`}
  </span>
)}
```

4. Mostrar horarios si están disponibles:
```tsx
{result.departureTime && result.arrivalTime && (
  <span className="text-sm">
    {result.departureTime} → {result.arrivalTime}
  </span>
)}
```

---

## PASO 4 — Limpiar resultados simulados existentes

Ejecutar esta query para borrar todos los resultados anteriores que fueron simulados:

```sql
DELETE FROM travel_search_results
WHERE raw_payload_json->>'simulated' = 'true'
   OR source ILIKE '%simulaci%'
   OR source ILIKE '%Despegar%'
   OR source ILIKE '%Aerolíneas Argentinas%';
```

O simplemente:
```sql
DELETE FROM travel_search_results;
```
(Esto borra todos los resultados y el usuario puede volver a ejecutar los perfiles para obtener datos reales.)

---

## VERIFICACIÓN

Después de aplicar los cambios:

1. Ir a un perfil de búsqueda con origen NQN y destino AEP o EZE
2. Hacer click en "Ejecutar ahora"
3. Esperar 5-10 segundos (es una llamada real a SerpAPI)
4. Los resultados deben mostrar:
   - Source: "Google Flights" (no "Simulación")
   - Precios reales en USD
   - Botón "Ver oferta en Google Flights →" con link real
   - Aerolíneas reales que operan esa ruta
   - Si no hay vuelos directos NQN→AEP, SerpAPI retornará vuelos con escala o sin resultados (eso es correcto — es la realidad)

**Nota importante:** Si SerpAPI no encuentra vuelos para una ruta específica
(por ejemplo NQN→AEP que tiene pocos vuelos), retornará array vacío y el
sistema mostrará "0 resultados encontrados". Eso es el comportamiento correcto
de datos reales — es mejor que inventar vuelos que no existen.
