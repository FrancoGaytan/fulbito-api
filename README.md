# Fulbito API ⚽

API REST para organizar partidos de fútbol amateur, con registro de jugadores, grupos, partidos, feedback y generación de equipos balanceados.

## 🚀 Tech stack
- Node.js + Express
- TypeScript
- MongoDB Atlas (Mongoose)# Fulbito API ⚽

API REST para organizar partidos de fútbol amateur, con registro de jugadores, grupos, partidos, feedback y generación de equipos balanceados.

## 🚀 Tech stack
- Node.js + Express
- TypeScript
- MongoDB Atlas (Mongoose)
- JWT Authentication
- Deploy en [Koyeb](https://www.koyeb.com/) (Hobby plan free)

---

## 📦 Features principales
- **Auth**: Registro y login con JWT.
- **Players**: Crear jugadores con habilidades y rating inicial.
- **Groups**: Crear grupos y agregar jugadores propios.
- **Matches**:
  - Crear match con participantes de un grupo.
  - Generar equipos balanceados.
  - Agregar feedback a jugadores.
  - Finalizar partido (ajusta ratings).

---

## 📑 Endpoints principales

### Auth
- `POST /api/auth/register` → `{ email, password }` → `{ token }`
- `POST /api/auth/login` → `{ email, password }` → `{ token }`

### Players
- `POST /api/players` → `{ name, abilities[] }`
- `GET /api/players`
- `PATCH /api/players/:id/abilities` → `{ abilities[] }`

### Groups
- `POST /api/groups` → `{ name }`
- `GET /api/groups`
- `POST /api/groups/:id/players` → `{ playerId }`

### Matches
- `POST /api/matches` → `{ groupId, participants[] }`
- `GET /api/matches/group/:id`
- `POST /api/matches/:id/participants` → `{ playerId }`
- `POST /api/matches/:id/generate-teams`
- `POST /api/matches/:id/feedback` → `{ playerId, vote, note? }`
- `POST /api/matches/:id/finalize` → `{ scoreA, scoreB }`

### Health
- `GET /health` → `{ ok: true }`

---

## 🔑 Variables de entorno

En local (`.env`):

---

## 📦 Features principales
- **Auth**: Registro y login con JWT.
# Fulbito API ⚽

API REST para organizar partidos de fútbol amateur: jugadores con habilidades y rating, grupos colaborativos, partidos con generación de equipos (algoritmo local + Gemini), votos de performance multi‑usuario y aplicación de ratings.

---

## 🚀 Stack
* Node.js + Express + TypeScript
* MongoDB (Mongoose)
* JWT Auth
* Gemini (opcional) para sugerencia de equipos
* Deploy (ej: Koyeb / cualquier plataforma Node)

---

## 📦 Features (resumen)
* Auth + Password Reset (código 6 dígitos + token de sesión temporal).
* Players: creación, habilidades flexibles (objeto o lista), rating inicial calibrado por promedio de habilidades, edición de habilidades, claim/unclaim por usuario.
* Groups: creación vacía, join, agregado bulk de jugadores, flags de acceso (isOwner, isMember, canCreate, canEdit).
* Matches: creación por cualquier miembro, agregado de participantes, generación de equipos (local o IA), feedback/votos por jugador, finalización, aplicación única de ratings con log de cambios, borrado.
* Voting System: cada usuario vota a cada jugador (up/neutral/down). Al aplicar ratings se agregan todos los votos.
* Rating Engine: delta base por resultado + ajuste por votos + multiplicadores por bracket + clamps y mínimo.
* Progress endpoints: estado de mis votos y progreso global (para UI de completitud, sin bloquear aplicación de ratings salvo modo `?requireFull=1`).
* Password Reset seguro (hash de código y de session token).

---

## 🔢 Rating Algorithm (simplificado)
Para cada jugador del equipo:
1. Base: win +10 / lose -10 / draw +2.
2. Feedback: suma de votos (up = +2, down = -2, neutral = 0) limitada a ±6.
3. Multiplicador: rating < 950 → +20% del delta; rating > 1200 → -20%.
4. Clamp delta final: [-40, +40]. Rating mínimo absoluto: 500.
5. Se guarda `match.ratingChanges` con before/after/delta y se marca `ratingApplied=true` (solo una vez).

---

## 🤖 Integración con Gemini
Se puede pedir formar equipos balanceados usando la API Gemini:
* Endpoint: `POST /api/matches/:id/generate-teams?ai=1&seed=123` (si `ai=1` y existe `GEMINI_API_KEY`).
* Prompt: provee lista de jugadores con rating/abilities, solicita 2 equipos A/B minimizando diferencia de suma de ratings (<5% ideal) respetando IDs.
* Validación: respuesta JSON estricta (`{"teams":[{"name":"A","players":[...]},{"name":"B","players":[...]}]}`) validada con Zod.
* Fallback: si IA falla, se usa algoritmo local con random seeded + greedy balance y reequilibrio suave (hasta 5 swaps).
* Re-seed reproducible: parámetro `seed` permite generar variantes controladas.
* Variables de entorno: `GEMINI_API_KEY` y opcional `USE_GEMINI_TEAMS=true` para usar IA por defecto.

---

## 🔐 Password Reset Flow
Endpoints:
1. `POST /api/auth/request-reset-code` → `{ email }` (200 siempre; incluye `devCode` fuera de producción).
2. `POST /api/auth/verify-reset-code` → `{ email, code }` → `{ resetSessionToken }` (invalida el código).
3. `POST /api/auth/reset-password` → `{ email, resetSessionToken, newPassword }` → `{ ok, token }`.

Interno:
* Código 6 dígitos numérico (100000–999999) hash (SHA-256) + expiración (`RESET_CODE_TTL_MINUTES`, default 15).
* Session token (UUID) también hasheado; se invalida tras uso.
* Respuestas homogéneas → evita enumeración de emails.

---

## � Voting & Progress
* `POST /api/matches/:id/feedback` → votar jugador (upsert por usuario+player+match).
* `GET /api/matches/:id/my-votes` → estado personal (`myVotes`,`remainingPlayerIds`,`completed`,`ratingApplied`).
* `GET /api/matches/:id/vote-progress` → agregados (por jugador y por votante).
* `POST /api/matches/:id/apply-ratings` aplica una sola vez; usar `?requireFull=1` para forzar completitud.

---

## 🧩 Endpoints
### Auth
* `POST /api/auth/register` → `{ email, password }`
* `POST /api/auth/login` → `{ email, password }`
* `POST /api/auth/request-reset-code`
* `POST /api/auth/verify-reset-code`
* `POST /api/auth/reset-password`

### Players
* `POST /api/players`
* `GET /api/players`
* `GET /api/players/:id`
* `PATCH /api/players/:id/abilities`
* `POST /api/players/:id/claim`
* `POST /api/players/:id/unclaim`
* `DELETE /api/players/:id`

### Groups
* `POST /api/groups`
* `GET /api/groups`
* `GET /api/groups/:id`
* `POST /api/groups/:id/join`
* `POST /api/groups/:id/players` (añadir uno) / bulk variant
* `DELETE /api/groups/:id`

### Matches
* `POST /api/matches`
* `GET /api/matches/group/:id`
* `POST /api/matches/:id/participants`
* `POST /api/matches/:id/generate-teams[?ai=1&seed=...]`
* `POST /api/matches/:id/feedback`
* `GET /api/matches/:id/my-votes`
* `GET /api/matches/:id/vote-progress`
* `POST /api/matches/:id/finalize`
* `POST /api/matches/:id/apply-ratings[?requireFull=1]`
* `DELETE /api/matches/:id`

### Health
* `GET /health`

---

## 🌱 Seed
`src/dev/seed.ts` permite popular jugadores y un grupo para pruebas (`runSeedByOwnerId` / `runSeedByEmail`).

---

## 🔑 Variables de Entorno
```env
MONGO_URI=...
JWT_SECRET=un_secreto_largo
PORT=3000
GEMINI_API_KEY=
USE_GEMINI_TEAMS=false
RESET_CODE_TTL_MINUTES=15
```

---

## ▶️ Run
```bash
npm install
npm run dev
npm run build
npm start
```

---

## 🔐 Seguridad
* Hash de códigos y tokens de reset.
* Respuesta neutra en request-reset-code.
* Índice único en email.
* Una sola aplicación de ratings por match.
* Votos con índice compuesto para evitar duplicados.

---

## Futuras Mejoras
* Rate limiting y auditoría.
* Historial avanzado de rating y habilidades.
* Notificaciones/email real para reset y eventos.
* Métricas y observabilidad.

---

## Licencia
MIT
- `GET /api/matches/group/:id`
- `POST /api/matches/:id/participants` → `{ playerId }`
- `POST /api/matches/:id/generate-teams`
- `POST /api/matches/:id/feedback` → `{ playerId, vote, note? }`
- `POST /api/matches/:id/finalize` → `{ scoreA, scoreB }`

### Health
- `GET /health` → `{ ok: true }`

---

## 🔑 Variables de entorno

En local (`.env`):

```env
MONGO_URI=mongodb+srv://<usuario>:<pass>@cluster0.xxxxx.mongodb.net/footy
JWT_SECRET=poné_un_secreto_largo
PORT=3000
# Fulbito API ⚽

API REST para organizar partidos de fútbol amateur, con registro de jugadores, grupos, partidos, feedback y generación de equipos balanceados.

## 🚀 Tech stack
- Node.js + Express
- TypeScript
- MongoDB Atlas (Mongoose)
- JWT Authentication
- Deploy en [Koyeb](https://www.koyeb.com/) (Hobby plan free)

---

## 📦 Features principales
- **Auth**: Registro y login con JWT.
- **Players**: Crear jugadores con habilidades y rating inicial.
- **Groups**: Crear grupos y agregar jugadores propios.
- **Matches**:
  - Crear match con participantes de un grupo.
  - Generar equipos balanceados.
  - Agregar feedback a jugadores.
  - Finalizar partido (ajusta ratings).

---

## 📑 Endpoints principales

### Auth
- `POST /api/auth/register` → `{ email, password }` → `{ token }`
- `POST /api/auth/login` → `{ email, password }` → `{ token }`

### Players
- `POST /api/players` → `{ name, abilities[] }`
- `GET /api/players`
- `PATCH /api/players/:id/abilities` → `{ abilities[] }`

### Groups
- `POST /api/groups` → `{ name }`
- `GET /api/groups`
- `POST /api/groups/:id/players` → `{ playerId }`

### Matches
- `POST /api/matches` → `{ groupId, participants[] }`
- `GET /api/matches/group/:id`
- `POST /api/matches/:id/participants` → `{ playerId }`
- `POST /api/matches/:id/generate-teams`
- `POST /api/matches/:id/feedback` → `{ playerId, vote, note? }`
- `POST /api/matches/:id/finalize` → `{ scoreA, scoreB }`

### Health
- `GET /health` → `{ ok: true }`

---

## 🔑 Variables de entorno

En local (`.env`):

```env
MONGO_URI=mongodb+srv://<usuario>:<pass>@cluster0.xxxxx.mongodb.net/footy
JWT_SECRET=poné_un_secreto_largo
PORT=3000
# Fulbito API ⚽

API REST para organizar partidos de fútbol amateur, con registro de jugadores, grupos, partidos, feedback y generación de equipos balanceados.

## 🚀 Tech stack
- Node.js + Express
- TypeScript
- MongoDB Atlas (Mongoose)
- JWT Authentication
- Deploy en [Koyeb](https://www.koyeb.com/) (Hobby plan free)

---

## 📦 Features principales
- **Auth**: Registro y login con JWT.
- **Players**: Crear jugadores con habilidades y rating inicial.
- **Groups**: Crear grupos y agregar jugadores propios.
- **Matches**:
  - Crear match con participantes de un grupo.
  - Generar equipos balanceados.
  - Agregar feedback a jugadores.
  - Finalizar partido (ajusta ratings).

---

## 📑 Endpoints principales

### Auth
- `POST /api/auth/register` → `{ email, password }` → `{ token }`
- `POST /api/auth/login` → `{ email, password }` → `{ token }`

### Players
- `POST /api/players` → `{ name, abilities[] }`
- `GET /api/players`
- `PATCH /api/players/:id/abilities` → `{ abilities[] }`

### Groups
- `POST /api/groups` → `{ name }`
- `GET /api/groups`
- `POST /api/groups/:id/players` → `{ playerId }`

### Matches
- `POST /api/matches` → `{ groupId, participants[] }`
- `GET /api/matches/group/:id`
- `POST /api/matches/:id/participants` → `{ playerId }`
- `POST /api/matches/:id/generate-teams`
- `POST /api/matches/:id/feedback` → `{ playerId, vote, note? }`
- `POST /api/matches/:id/finalize` → `{ scoreA, scoreB }`

### Health
- `GET /health` → `{ ok: true }`

---

## 🔑 Variables de entorno

En local (`.env`):

```env
MONGO_URI=mongodb+srv://<usuario>:<pass>@cluster0.xxxxx.mongodb.net/footy
JWT_SECRET=poné_un_secreto_largo
PORT=3000

- JWT Authentication
- Deploy en [Koyeb](https://www.koyeb.com/) (Hobby plan free)

---

## 📦 Features principales
- **Auth**: Registro y login con JWT.
- **Players**: Crear jugadores con habilidades y rating inicial.
- **Groups**: Crear grupos y agregar jugadores propios.
- **Matches**:
  - Crear match con participantes de un grupo.
  - Generar equipos balanceados.
  - Agregar feedback a jugadores.
  - Finalizar partido (ajusta ratings).

---

## 📑 Endpoints principales

### Auth
- `POST /api/auth/register` → `{ email, password }` → `{ token }`
- `POST /api/auth/login` → `{ email, password }` → `{ token }`

### Players
- `POST /api/players` → `{ name, nickname?, abilities: { defense: 8, passes: 7, ... } }`
- `GET /api/players`
- `PATCH /api/players/:id/abilities` → `{ abilities: { scorer: 9, running: 6 } }`

### Groups
- `POST /api/groups` → `{ name }`
- `GET /api/groups`
- `POST /api/groups/:id/players` → `{ playerId }`

### Matches
- `POST /api/matches` → `{ groupId, participants[] }`
- `GET /api/matches/group/:id`
- `POST /api/matches/:id/participants` → `{ playerId }`
- `POST /api/matches/:id/generate-teams`
- `POST /api/matches/:id/feedback` → `{ playerId, vote, note? }`
- `POST /api/matches/:id/finalize` → `{ scoreA, scoreB }`

### Health
- `GET /health` → `{ ok: true }`

---

## 🔑 Variables de entorno

En local (`.env`):

```env
MONGO_URI=mongodb+srv://<usuario>:<pass>@cluster0.xxxxx.mongodb.net/footy
JWT_SECRET=poné_un_secreto_largo
PORT=3000
# instalar dependencias
npm install

# levantar en modo dev
npm run dev

# compilar
npm run build

# ejecutar compilado
npm start