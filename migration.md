# Migración a Multi-Membership (Ratings y Stats por Grupo)

Estado: EN PROGRESO (rama `feature/multi-membership`)

## Objetivo

Separar identidad global del jugador (Player) de su desempeño/contexto en cada grupo, permitiendo:

- Un mismo Player en múltiples grupos.
- Rating y estadísticas (gamesPlayed, wins, losses, draws) independientes por grupo.
- Visibilidad de jugadores limitada a los grupos a los que pertenece el usuario.

## Resumen Arquitectura Nueva

- `Player`: identidad global (name, nickname, abilities base).
- `Group`: contenedor de miembros (legacy: sigue teniendo `members` array temporalmente).
- `GroupMembership`: relación Player↔Group con rating contextual y stats.
  - Campos principales: `groupId`, `playerId`, `rating`, `gamesPlayed`, `wins`, `losses`, `draws`, `role`, `status`.
- Rating engine y stats se aplican sobre `GroupMembership` (fallback a Player si no hay contexto).

## Cronología de Cambios (Step-by-Step)

| Paso | Cambio | Archivo(s) | Notas |
|------|--------|------------|-------|
| 1 | Crear rama de feature | git branch | `feature/multi-membership` |
| 2 | Base de datos nueva | `mongo.ts` | Parametrizamos `dbName` (`MONGODB_DBNAME` -> fallback `footy-v2`). |
| 3 | Modelo `GroupMembership` | `src/models/groupMembership.model.ts` | Índice único `(groupId, playerId)`. Campos rating y stats. |
| 4 | Script seed inicial | `scripts/seed-multigroup.ts` | Crea user, player, group y membership owner. |
| 5 | Endpoint listado contextual | `GET /groups/:id/players` | Usa memberships si existen, fallback a `group.members`. |
| 6 | Middleware acceso grupo | `src/middlewares/groupAccess.ts` | Inyecta `req.groupContext` (groupId, isOwner, isMember, membership). |
| 7 | Team generation usa rating contextual | `matches.controller.ts` (generateTeams) | Consulta `GroupMembership` por (groupId, playerIds). |
| 8 | applyRatings contextual | `matches.controller.ts` (applyRatings) | Upsert membership rating; fallback Player si no `groupId`. |
| 9 | Migrar gamesPlayed a finalize | `matches.controller.ts` (finalizeMatch) | Quita incremento en applyRatings. Upsert membership si falta. |
| 10 | Wins/Losses/Draws por grupo | `matches.controller.ts` (finalizeMatch) | Incrementa según resultado del match. |
| 11 | Eliminado doble gamesPlayed | Ajuste applyRatings | Ahora sólo finalize cuenta partidos. |
| 12 | Endpoint crear membership | `POST /groups/:id/memberships` | Owner crea/upsertea membership (abilityOverrides / initialRating). |
| 13 | Endpoint ranking grupo | `GET /groups/:id/ranking` | Orden por rating desc (luego gamesPlayed). |
| 14 | Endpoint mis memberships | `GET /me/memberships` | Lista memberships del Player del usuario. |

## Situación Actual

- Ratings y stats (gamesPlayed + W/L/D) ya se almacenan en `GroupMembership` durante finalize/apply.
- Aún existe `Player.rating` y `Player.gamesPlayed` (legacy) para compatibilidad.
- `group.members` sigue siendo usado como fallback; se deprecará tras creación de memberships para todos.

## Pendientes / Próximos (Backlog)

1. Eliminar lectura directa de `Player.rating` en frontend (usar siempre rating contextual).
2. UI: selector activo de grupo / switcher global.
3. Quitar incremento `Player.gamesPlayed` legacy tras backfill completo.
4. Aplicar `abilityOverrides` efectivamente en generación de equipos (hoy sólo se almacena).
5. Script de migración (si hay datos previos):

   a. Crear default group si era monogrupo.
   b. Generar membership para cada Player (rating/gamesPlayed legacy).
   c. (Opcional) Recalcular W/L/D agregando matches históricas.

6. Limpieza final: remover campos `rating` y `gamesPlayed` de `Player` y fallback a `group.members`.
7. Documentar contrato `groupContext` en README/API.
8. Paginación / filtros (minGames, search) en ranking.
9. Validaciones con Zod en endpoints nuevos.
10. Crear índices físicos si la data crece (ver sección Índices Recomendados).
11. Endpoint opcional: PATCH membership (para actualizar role / abilityOverrides / status).

## Consideraciones de Diseño

- Upsert en finalize y apply evita errores si un jugador participa sin membership creada explícitamente (fallback).
- Stats sólo incrementan una vez: en `finalizeMatch` (source of truth). applyRatings no toca stats.
- W/L/D se calculan simples: equipo A vs B. Empate incrementa `draws`.
- Seguridad: middleware `requireGroupAccess` centraliza validación; futuras rutas deberían usarlo para reducir duplicación.

## Adaptaciones Frontend Requeridas

1. Reemplazar listados globales de jugadores por `GET /groups/:groupId/players`.
2. Añadir selector de grupo (persistir en estado / ruta / query param / header `x-group-id`).
3. Para cada vista de jugador mostrar rating contextual (campo `rating` retornado por endpoint de grupo) en lugar de `Player.rating` global.
4. Ajustar creación de match para enviar `groupId` y sólo permitir players del mismo grupo.
5. Mostrar ranking (cuando implementado) usando `GroupMembership.rating`.
6. En perfil player: pestaña “Grupos” con tabla de { groupName, rating, games, W/L/D }.
7. Migrar cálculo de estadísticas generales a sumatoria / agregación multi-grupo si se requiere vista global.

## Estrategia de Despliegue / Cutover (si existiera prod)

1. Deploy con dual-read: generateTeams y applyRatings ya soportan membership pero siguen aceptando rating global.
2. Backfill memberships existentes antes de habilitar UI de switching.
3. Habilitar UI de selección de grupo y endpoints scopiados.
4. Confirmar que no se leen más los campos globales (telemetría o logs).
5. Remover campos legacy / código de fallback.

## Ejemplos de Consultas Mongo Útiles

Top 10 jugadores de un grupo por rating:

```js
db.groupmemberships.find({ groupId: ObjectId('<gid>') })
  .sort({ rating: -1 })
  .limit(10);
```

Encontrar memberships de un player:

```js
db.groupmemberships.find({ playerId: ObjectId('<pid>') });
```

Ranking (top N con proyección básica):

```js
db.groupmemberships.find({ groupId: ObjectId('<gid>') }, { rating: 1, gamesPlayed: 1, wins: 1, losses: 1, draws: 1, playerId: 1 })
  .sort({ rating: -1, gamesPlayed: -1 })
  .limit(50);
```

Memberships de un player con lookup de nombre de grupo (pipeline ejemplo):

```js
db.groupmemberships.aggregate([
  { $match: { playerId: ObjectId('<pid>') } },
  { $lookup: { from: 'groups', localField: 'groupId', foreignField: '_id', as: 'g' } },
  { $unwind: '$g' },
  { $project: { rating: 1, gamesPlayed: 1, wins: 1, losses: 1, draws: 1, role: 1, status: 1, groupName: '$g.name' } }
]);
```

## Endpoints Añadidos

### POST /groups/:id/memberships

Crea o upsertea una membership (sólo owner del grupo). Garantiza compat con legacy agregando el player al array `group.members`.

Body JSON (campos opcionales):

```json
{
  "playerId": "<playerObjectId>",
  "initialRating": 1200,   // opcional
  "abilityOverrides": { "pace": 8, "vision": 7 }
}
```

Respuesta (201):

```json
{
  "message": "Membership creado",
  "membership": { "_id": "...", "groupId": "...", "playerId": "...", "rating": 1200, "gamesPlayed": 0, "wins": 0, "losses": 0, "draws": 0 }
}
```

### GET /groups/:id/ranking?limit=50

Devuelve ranking ordenado por `rating desc, gamesPlayed desc`.

Respuesta:

```json
{
  "groupId": "<gid>",
  "count": 3,
  "ranking": [
    { "position": 1, "playerId": "...", "name": "Juan", "rating": 1280, "gamesPlayed": 15, "wins": 9, "losses": 4, "draws": 2 },
    { "position": 2, "playerId": "...", "name": "Luis", "rating": 1210, "gamesPlayed": 10, "wins": 5, "losses": 3, "draws": 2 },
    { "position": 3, "playerId": "...", "name": "Pablo", "rating": 1180, "gamesPlayed": 8, "wins": 4, "losses": 2, "draws": 2 }
  ]
}
```

Parámetro `limit` (default 50, max 100).

### GET /me/memberships

Lista las memberships del Player asociado al usuario autenticado.

Respuesta:

```json
{
  "playerId": "<playerId>",
  "count": 2,
  "memberships": [
    { "membershipId": "...", "groupId": "...", "groupName": "Los Pibes", "rating": 1200, "gamesPlayed": 5, "wins": 3, "losses": 1, "draws": 1, "role": "member", "status": "active" },
    { "membershipId": "...", "groupId": "...", "groupName": "Mixto", "rating": 1000, "gamesPlayed": 0, "wins": 0, "losses": 0, "draws": 0, "role": "member", "status": "active" }
  ]
}
```

## Decisiones Clave

- Se prefirió `GroupMembership` en vez de duplicar `Player` por grupo → reduce redundancia y facilita stats multi-grupo.
- Upsert en finalize/apply simplifica onboarding de jugadores sin flujo explícito de invitación.
- Mantener `group.members` temporalmente evita migración forzada inmediata.

## Riesgos y Mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Doble conteo gamesPlayed (legacy) | Eliminado incremento en applyRatings. |
| Player sin membership previo | Upsert automático. |
| Front mezclando rating global/contextual | Fase de documentación y endpoint claro. |
| Performance ranking grupos grandes | Índice `{ groupId: 1, rating: -1 }` recomendado (pendiente). |

## Índices Recomendados (pendiente crear si se necesita)

```js
db.groupmemberships.createIndex({ groupId: 1, playerId: 1 }, { unique: true });
db.groupmemberships.createIndex({ groupId: 1, rating: -1 });
db.groupmemberships.createIndex({ playerId: 1 });
```

## TODO Inline (Código)

- [ ] Reemplazar validaciones manuales por middleware donde falte.
- [ ] Aplicar abilityOverrides en generación de equipos.
- [ ] Paginación y filtros en ranking.
- [ ] Validaciones Zod (schemas request/response).
- [ ] Remover fallback a `group.members` tras backfill + UI migrada.

---
Última actualización: (se actualizará conforme avancemos).
