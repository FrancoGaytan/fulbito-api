# Migration Addendum (Join Code & Claim Flow)

Fecha: 2025-10-26  
Rama: `feature/multi-membership` (extensión)

## Resumen

Se agrega un mecanismo de incorporación a grupos mediante `joinCode` que permite:

- Usuarios sin player reclamar un placeholder existente (primer grupo que pisan).
- Usuarios que ya tienen player unirse a un nuevo grupo sin reclamar otra card (membership automática).
- Rotar el código para revocar accesos futuros.
- Exponer el `joinCode` sólo al owner en `GET /groups/:id`.

## Cambios en Modelo

`Group`:

- `joinCode: string` (index)
- `joinCodeUpdatedAt: Date`

Generación inicial de código en `createGroup`.

## Nuevos / Modificados Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/groups/:id` | GET | Ahora incluye `joinCode` sólo si el caller es owner. |
| `/groups/:id/join` | POST | Flujos: attach existing player o listar placeholders para claim. |
| `/groups/:id/claim-player` | POST | Reclamar player (sólo si usuario aún no tiene uno). |
| `/groups/:id/rotate-join-code` | POST | Owner rota el código (devuelve nuevo). |

### 1. POST /groups/:id/join

Body:

```json
{ "code": "ABCD123" }
```

Respuestas:

- Usuario con player existente:

```json
{
  "mode": "attached-existing-player",
  "playerId": "64f...",
  "membership": {
    "groupId": "...",
    "playerId": "64f...",
    "rating": 1000,
    "gamesPlayed": 0,
    "wins": 0,
    "losses": 0,
    "draws": 0
  },
  "membershipCreated": true
}
```

- Usuario sin player:

```json
{
  "mode": "need-claim",
  "unclaimed": [
    { "playerId": "p1", "name": "Juan" },
    { "playerId": "p2", "name": "Carlos", "nickname": "Carl" }
  ]
}
```

### 2. POST /groups/:id/claim-player

Body:

```json
{ "code": "ABCD123", "playerId": "p1" }
```

Respuesta:

```json
{
  "playerId": "p1",
  "claimed": true,
  "membership": {
    "groupId": "...",
    "playerId": "p1",
    "rating": 1000,
    "gamesPlayed": 0,
    "wins": 0,
    "losses": 0,
    "draws": 0
  }
}
```

Errores:

- 409 si el usuario ya tiene otro player reclamado.
- 400 código inválido.
- 404 player no pertenece al grupo.

### 3. POST /groups/:id/rotate-join-code

Sólo owner.

Respuesta:

```json
{ "groupId": "...", "joinCode": "NUEVOCOD" }
```

## Lógica y Reglas

1. Un usuario sólo puede tener un `Player` (índice unique por userId).
2. Primer grupo → reclama placeholder (si no tiene player).
3. Siguientes grupos → join directo (membership upsert) ignorando placeholders.
4. Placeholders duplicados (mismo nombre) no afectan, ya que identidad va por `userId`.
5. Owner puede rotar código para invalidar el anterior (no se guarda histórico).

## Impacto Frontend

| Vista | Acción |
|-------|--------|
| Pantalla Join | Input code → POST `/groups/:id/join` → ramifica según `mode`. |
| Claim placeholders | Listar `unclaimed` y POST claim-player. |
| Mostrar código | Si owner: mostrar `joinCode` y botón "Rotar". |
| Multi-join | Al reusar player: no se muestra listado claim. |

## Estados Especiales

| Caso | Respuesta |
|------|-----------|
| Join sin code (no owner) | 400 |
| Code válido pero sin placeholders y user sin player | `need-claim` con array vacío (UI: pedir crear placeholder manual) |
| Claim de player ya reclamado | 409 |
| Claim teniendo ya player distinto | 409 + `yourPlayerId` |

## Seguridad

- Código alfanumérico 8 chars (configurable). Rotable.
- No se expone a no-owners vía `GET /groups/:id`.
- Rate limiting sugerido (futuro) para evitar brute force.

## Próximas Mejores (Opcional)

1. Endpoint para crear placeholder rápido si `unclaimed` está vacío y usuario aún no tiene player.
2. Auditoría: log de rotaciones, quién rotó y cuándo.
3. Expiración opcional (TTL) del código tras X días.
4. Métrica de cuántos joins produjo cada código (tracking).

## Backlog Ajustado

- Remover eventual endpoint legacy de join simple (sin code) si no se usa.
- Documentar en README principal el nuevo flujo.

## Resumen Breve para Equipo Front

1. Usar `POST /groups/:id/join` con `code`.
2. Si `mode = need-claim`, mostrar lista `unclaimed` y permitir claim.
3. Si `mode = attached-existing-player`, redirigir directamente a dashboard del grupo.
4. Como owner, exponer joinCode y rotar si se filtra.

Fin del addendum.
