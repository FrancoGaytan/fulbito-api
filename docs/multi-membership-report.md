# Informe Técnico Completo: Migración a Multi-Membership y Ratings Contextuales por Grupo

Versión documento: 1.0  
Fecha: 2025-10-25  
Rama base: `feature/multi-membership`

---
## 1. Executive Summary
Se rediseñó el modelo de dominio para permitir que un mismo jugador (Player) participe en múltiples grupos con un rating y estadísticas independientes en cada uno. Esto habilita rankings por grupo, evolución contextual y futuras capacidades como habilidades sobreescritas (abilityOverrides) o roles administrativos específicos. La implementación se hizo de manera incremental y compatible con el modelo legacy (`Player.rating`, `group.members`). El backend ya expone los endpoints mínimos para que el frontend adopte el nuevo paradigma sin bloquear la evolución futura.

---
## 2. Objetivos
- Desacoplar identidad global (Player) de rendimiento contextual (GroupMembership).
- Permitir múltiples grupos con estadísticas segregadas (rating, gamesPlayed, wins, losses, draws).
- Facilitar ranking por grupo y vistas personalizadas.
- Mantener compatibilidad temporal con campos legacy para transición suave.
- Minimizar cambios iniciales en el frontend (fallbacks y dual-read).

---
## 3. Estado Antes vs Después
| Aspecto | Antes (Legacy) | Después (Multi-Membership) |
|---------|----------------|----------------------------|
| Rating | Campo único en `Player` | Campo principal en `GroupMembership` (fallback a Player si falta) |
| Stats (games, W/L/D) | `Player.gamesPlayed` (sin W/L/D) | `GroupMembership.gamesPlayed / wins / losses / draws` |
| Pertenencia a grupo | Array `group.members` | `GroupMembership` + array `group.members` (fase temporal) |
| Ranking | No nativo (orden por Player.rating) | Endpoint `/groups/:id/ranking` contextual |
| Escalabilidad multi-grupo | Limitada (rating global) | Total (aislamiento por grupo) |
| Extensibilidad (overrides) | No | Sí (campo `abilityOverrides`) |

---
## 4. Nuevos Artefactos
### 4.1 Modelo `GroupMembership`
Campos clave:
- `groupId`: Ref Group.
- `playerId`: Ref Player.
- `rating`: inicial 1000 (o configurable en creación manual / upsert).
- `gamesPlayed`, `wins`, `losses`, `draws`.
- `abilityOverrides` (Map<string, number>, opcional).
- `role`: 'member' | 'admin' | 'owner' (semántica futura ampliable).
- `status`: 'active' | 'invited' | 'inactive'.

Índices:
- Único compuesto `(groupId, playerId)`.
- Recomendados (a crear según crecimiento): `{ groupId: 1, rating: -1 }`, `{ playerId: 1 }`.

---
## 5. Endpoints Afectados / Añadidos
| Endpoint | Tipo | Estado | Descripción |
|----------|------|--------|-------------|
| `GET /groups/:id/players` | Nuevo (contextual) | Listo | Lista jugadores con rating contextual o fallback legacy. |
| `POST /groups/:id/memberships` | Nuevo | Listo | Crea/upsertea relación contextual (owner). |
| `GET /groups/:id/ranking` | Nuevo | Listo | Ranking por rating desc (limit configurable). |
| `GET /me/memberships` | Nuevo | Listo | Lista todas las memberships del Player del usuario. |
| `matches` (generate/apply/finalize) | Modificado | Listo | Usa/actualiza rating y stats por `GroupMembership`. |

---
## 6. Flujo de Datos (Simplificado)
1. Front selecciona un grupo (desde `GET /groups` o `GET /me/memberships`).
2. Lista jugadores: `GET /groups/:id/players` → retorna rating contextual o fallback.
3. Generación de equipos y registro de partidos usan `groupId` → finalizeMatch aplica rating y W/L/D.
4. Ranking se obtiene por `GET /groups/:id/ranking`.
5. Owner puede invitar / crear membership explícita para jugadores ya existentes.

---
## 7. Migración Ejecutada (Cronología Clave)
1. Parametrización de DB (`mongo.ts`).
2. Creación del modelo `GroupMembership` + índice único.
3. Seed inicial multigrupo (`scripts/seed-multigroup.ts`).
4. Refactor generación y aplicación de ratings a contexto de grupo.
5. Centralización de incremento de `gamesPlayed` en `finalizeMatch`.
6. Agregado de estadísticas W/L/D por grupo.
7. Endpoints contextualizados para listar jugadores, crear membership, ranking y listar mis memberships.
8. Documentación (`migration.md`) y reporte actual.

---
## 8. Estado Actual vs Legacy
| Elemento | Estado | Plan de Deprecación |
|----------|--------|---------------------|
| `Player.rating` | Aún en uso como fallback | Remover tras adopción completa UI |
| `Player.gamesPlayed` | No actualizado en nuevo flujo | Backfill opcional + remover |
| `group.members` | Fallback compatibilidad | Eliminar cuando todos tengan membership |
| Ratings contextuales | Operativos | Estables |
| W/L/D contextuales | Operativos | Estables |

---
## 9. Plan de Adaptación Frontend (Fases)
| Fase | Objetivo | Acciones | Criterio de Cierre |
|------|----------|----------|--------------------|
| 1 | Integración mínima | Usar nuevos endpoints sin romper legacy | Listas y ranking operativos |
| 2 | Contexto persistente | Selector de grupo global | Estado de grupo actual en store/router |
| 3 | Eliminación legacy rating | No usar `Player.rating` directo | Auditoría de lecturas removidas |
| 4 | Membership management | UI para invitar/crear | CRUD básico de membership |
| 5 | Optimización | Paginación ranking, filtros | Rápida respuesta en grupos grandes |
| 6 | Depuración final | Remover fallbacks y campos | Deploy sin campos legacy |

### 9.1 Mínimo Necesario Ahora (Fase 1)
- Agregar selector de grupo (dropdown) → mantener `activeGroupId`.
- Reemplazar vistas que listaban jugadores globales por `GET /groups/:id/players`.
- Mostrar ranking con `GET /groups/:id/ranking`.
- Vista "Mis Grupos": `GET /me/memberships`.

### 9.2 Recomendaciones UI
| Vista Legacy | Nueva Referencia | Cambio |
|--------------|------------------|--------|
| Lista global de jugadores | Lista por grupo | Endpoint contextual |
| Perfil jugador global | Perfil + pestaña "Grupos" | Tabla memberships |
| Dashboard rating único | Selector + ranking por grupo | Múltiples rankings |
| Crear partido (sin grupo) | Crear partido con `groupId` | Campo requerido |

---
## 10. Edge Cases Considerados
| Caso | Comportamiento Actual | Resultado |
|------|-----------------------|-----------|
| Player participa sin membership previa | Upsert en finalize/apply | Se crea membership default (rating 1000) |
| Grupo sin memberships pero con `members` legacy | Fallback usa `group.members` | No rompe UI |
| Jugador eliminado (futuro) | Memberships huérfanas potenciales | Requiere cleanup batch |
| Doble creación membership | Índice único previene duplicados | 409 interno gestionado (findOneAndUpdate upsert) |
| abilityOverrides malformado | Guardado opcional, no usado aún | Inocuo |

---
## 11. Seguridad & Autorización
- Middleware `requireGroupAccess` valida owner o miembro.
- Creación de membership: exige owner (`requireGroupOwner`).
- Lectura de ranking y players: requiere pertenencia.
- Futuro: roles `admin` para delegar gestiones.

---
## 12. Performance & Escalabilidad
| Dimensión | Situación | Mejora Potencial |
|----------|----------|------------------|
| Ranking | Query simple con sort | Índice `{ groupId, rating: -1 }` |
| Listado players | Dos colecciones (memberships + players) | Proyección + `$lookup` pipeline opcional |
| finalizeMatch | Upserts por jugador | BulkWrite (optimización futura) |
| Almacenamiento | Tamaño lineal a (#grupos * #miembros) | Sharding futuro (groupId) si escala |

---
## 13. Recomendaciones de Testing
| Tipo | Casos | Notas |
|------|-------|-------|
| Unit | finalizeMatch stats, applyRatings fallback | Mock de modelos Mongoose |
| Integration | Crear membership y ranking | Semilla controlada |
| Regression | Lista legacy sin membership | Asegura fallback |
| Performance (later) | Ranking grupos grandes | Dataset sintético |

---
## 14. Riesgos y Mitigaciones
| Riesgo | Impacto | Mitigación | Estado |
|--------|---------|-----------|--------|
| UI siga usando rating global | Inconsistencias | Auditoría + doc clara | Pendiente |
| Duplicación de jugadores (legacy + membership) | Datos redundantes | Cortar fallback tras backfill | Planificado |
| Falta de índices en crecimiento | Latencia ranking | Crear índices recomendados | A demanda |
| abilityOverrides no aplicado | UX inconsistente futura | Planificar fase 2 | Diferido |

---
## 15. Próximas Mejores (Roadmap Técnico)
1. Aplicar `abilityOverrides` en team generation (ponderar abilities base vs override).
2. Endpoint PATCH membership (cambiar role/status/overrides).
3. Paginación y búsqueda (nombre/nickname) en ranking.
4. Métricas derivadas (winRate, streak, ratingDelta promedio). 
5. Auditoría de partidas y re-cálculo batch (consistencia post-bugs). 
6. Remover campos legacy y fallback tras confirmación UI.

---
## 16. Estrategia de Cutover (Producción Hipotética)
| Paso | Acción | Éxito |
|------|--------|-------|
| 1 | Deploy dual | Sin errores en logs |
| 2 | Backfill memberships | 100% players con membership |
| 3 | Habilitar UI contextual | Uso estable de nuevos endpoints |
| 4 | Métricas verificación | Divergencia < 1% rating | 
| 5 | Remover fallback | Campos legacy no referenciados |

---
## 17. Contratos de API (Extracto)
### 17.1 GET /groups/:id/players
Respuesta:
```json
{
  "groupId": "<gid>",
  "count": 3,
  "players": [
    { "playerId": "...", "name": "Juan", "nickname": "ju", "rating": 1210, "gamesPlayed": 10, "membershipId": "..." }
  ]
}
```

### 17.2 POST /groups/:id/memberships
```json
{
  "playerId": "<playerId>",
  "initialRating": 1180,
  "abilityOverrides": { "pace": 8 }
}
```

### 17.3 GET /groups/:id/ranking
```json
{
  "groupId": "<gid>",
  "count": 2,
  "ranking": [
    { "position": 1, "playerId": "...", "name": "Ana", "rating": 1320, "gamesPlayed": 12, "wins": 8, "losses": 3, "draws": 1 }
  ]
}
```

### 17.4 GET /me/memberships
```json
{
  "playerId": "<pid>",
  "count": 2,
  "memberships": [
    { "membershipId": "...", "groupId": "...", "groupName": "Los Pibes", "rating": 1200, "gamesPlayed": 5, "wins": 3, "losses": 1, "draws": 1, "role": "member", "status": "active" }
  ]
}
```

---
## 18. Changelog Resumido
| Versión | Fecha | Cambio |
|---------|-------|--------|
| 0.1 | Inicial | Diseño y modelo GroupMembership |
| 0.2 | + Seed | Script seed multigrupo |
| 0.3 | + Ratings | Refactor applyRatings / finalizeMatch |
| 0.4 | + Stats | W/L/D y centralización gamesPlayed |
| 0.5 | + Endpoints | players, memberships, ranking, my memberships |
| 1.0 | Reporte | Documento consolidado y listo para UI adoption |

---
## 19. Exportar a PDF
Puedes exportar este archivo desde VS Code:
1. Abrir el markdown.
2. Usar comando: "Markdown: Print" (o extensión) → Guardar como PDF.
3. Alternativa CLI (ejemplo usando `pandoc`):
   ```bash
   pandoc docs/multi-membership-report.md -o multi-membership-report.pdf
   ```

---
## 20. Conclusión
La base técnica para multi-grupo con ratings y estadísticas contextuales está lista y estable. El frontend puede integrarse inmediatamente usando los endpoints actuales y progresar luego a fases de optimización y limpieza legacy sin refactors profundos adicionales.

---
## 21. Anexo: Resumen de Acciones Frontend Prioritarias
1. Implementar selector de grupo persistente.
2. Reemplazar listados globales por endpoint contextual.
3. Integrar ranking y vista "Mis Grupos".
4. Ajustar creación de partidos para incluir `groupId`.
5. Evitar lectura directa de `Player.rating` en nuevas pantallas.

Fin del documento.
