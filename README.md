<div align="center">

# Fulbito API ⚽
API REST para organizar partidos de fútbol amateur: jugadores con habilidades y rating, grupos, partidos, generación de equipos balanceados (algoritmo propio + opcional IA), feedback y aplicación controlada de ratings.

</div>

---

## 🚀 Stack
- Node.js + Express + TypeScript
- MongoDB (Mongoose)
- JWT Auth
- (Opcional) Gemini API para sugerir equipos
- Despliegue agnóstico (ej: Koyeb, Render, Fly.io, etc.)

## 📦 Features
- Auth + Password Reset seguro (código 6 dígitos + session token hasheados)
- Players: creación, habilidades, edición, claim/unclaim por usuario
- Groups: creación, join por código, memberships contextualizadas (rating/stats por grupo)
- Matches: creación, agregar participantes, generación de equipos (algoritmo local o IA), feedback por jugador, finalize + apply ratings único
- Voting/Feedback: votos up/neutral/down agregados antes de aplicar rating
- Rating Engine: delta por resultado + ajuste feedback + multiplicadores bracket + clamps
- Join Codes: rotación, join-by-code sin conocer `groupId`
- Multi‑membership: estadísticas y rating contextuales por grupo

## 🔢 Rating Algorithm (simplificado)
1. Base: Win +10 / Lose -10 / Draw +2
2. Feedback agregado: up +2, down -2 (cap ±6)
3. Multiplicador: rating <950 => +20%, rating >1200 => -20%
4. Clamp delta final a [-40, +40]; rating mínimo 500
5. Persistencia: se guarda `ratingChanges` y flag `ratingApplied=true` (idempotente)

## 🤖 Equipos con IA (Gemini)
`POST /api/matches/:id/generate-teams?ai=1&seed=123`
- Prompt con jugadores, ratings y restricciones
- Validación JSON estricta (Zod) y fallback a algoritmo local si falla
- Param `seed` para reproducibilidad

## 🔐 Password Reset Flow
1. `POST /api/auth/request-reset-code` → siempre 200 (oculta existencia de email) + `devCode` en no‑prod
2. `POST /api/auth/verify-reset-code` → valida código (hash + expiración) y emite `resetSessionToken`
3. `POST /api/auth/reset-password` → usa session token (hash) y setea nueva password

Seguridad: códigos y tokens hash (SHA-256), expiración configurable (`RESET_CODE_TTL_MINUTES`), throttle (`RESET_CODE_THROTTLE_MS`).

## 🧩 Endpoints (resumen)
### Auth
`POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/request-reset-code` · `POST /api/auth/verify-reset-code` · `POST /api/auth/reset-password`

### Players
`POST /api/players` · `GET /api/players` · `GET /api/players/:id` · `PATCH /api/players/:id/abilities` · `POST /api/players/:id/claim` · `POST /api/players/:id/unclaim` · `DELETE /api/players/:id`

### Groups / Memberships
`POST /api/groups` · `GET /api/groups` · `GET /api/groups/:id` · `POST /api/groups/:id/join` · `POST /api/groups/join-by-code` · `POST /api/groups/:id/players` · `POST /api/groups/:id/rotate-join-code`

### Rankings & Members
`GET /api/groups/:id/ranking` · `GET /me/memberships` · `GET /groups/:groupId/players`

### Matches
`POST /api/matches` · `GET /api/matches/group/:id` · `POST /api/matches/:id/participants` · `POST /api/matches/:id/generate-teams` · `POST /api/matches/:id/feedback` · `GET /api/matches/:id/my-votes` · `GET /api/matches/:id/vote-progress` · `POST /api/matches/:id/finalize` · `POST /api/matches/:id/apply-ratings`

### Health
`GET /health`

## 🌱 Seed / Scripts
- `scripts/seed-multigroup.ts` crea usuario, player, group y membership base.
- `scripts/test-email-reset.ts` envía código de reset directo (sin HTTP) para pruebas.

## 🔑 Variables de Entorno (principal)
```env
PORT=3000
MONGODB_URI=...
JWT_SECRET=un_secreto_largo

# IA (opcional)
GEMINI_API_KEY=
USE_GEMINI_TEAMS=false

# Reset password
RESET_CODE_TTL_MINUTES=15
RESET_CODE_THROTTLE_MS=60000

# Email
EMAIL_PROVIDER=resend
EMAIL_FROM=onboarding@resend.dev   # Cambiar a no-reply@tudominio.com cuando verifiques
RESEND_API_KEY=...
NODE_ENV=development
```

## ▶️ Run
```bash
npm install
npm run dev
# build
npm run build
npm start
```

## 🔐 Seguridad Destacada
- Códigos y tokens de reset hasheados
- Respuesta neutra en generación de código
- Aplicación única de ratings (idempotente)
- Join codes rotables
- Contexto de rating por grupo (evita contaminación global)

## 📧 Email / Dominio
Actualmente sandbox: `onboarding@resend.dev`. Ver sección añadida al final (Email / Reset Password – Dominio vs Sandbox) para migración futura a dominio propio.

## 🚧 Futuras Mejoras / Backlog
- Adquirir dominio y configurar DKIM/SPF/DMARC
- Migración definitiva de ratings legacy a GroupMembership (script)
- Rate limiting global / por IP
- Observabilidad (metrics + tracing)
- Limpieza campos legacy cuando migrate 100%

## Licencia
MIT

---

## 📧 Email / Reset Password – Dominio vs Sandbox
Actualmente se usa `onboarding@resend.dev` (sandbox). Ver detalle de migración a dominio propio (DKIM/SPF/DMARC) al adquirir un dominio. Pasos resumidos ya incluidos arriba.
 
---

## 📧 Email / Reset Password – Dominio vs Sandbox

Actualmente el sistema de reset de contraseña usa un servicio de envío (Resend). En desarrollo se está utilizando el remitente sandbox `onboarding@resend.dev`.

### ¿Por qué funciona sin dominio propio?
Resend expone un remitente compartido para pruebas iniciales. Mientras uses ese correo:
* No necesitás configurar DKIM/SPF/DMARC.
* Podés validar el flujo completo (request code → verify → reset password).
* No tenés branding ni reputación propia (el correo llega “desde Resend”).

### Limitaciones de seguir con `onboarding@resend.dev`
* Menor confianza del usuario final (no coincide el dominio con tu app).
* Difícil mejorar entregabilidad o reputación a largo plazo.
* Posibles límites de volumen / cambios unilaterales del proveedor.
* No separás tráfico (invites, resets, notificaciones) por subdominios.

### ¿Puedo usar otro @resend.dev gratuito?
No de forma garantizada. Resend sólo asegura el sandbox `onboarding@resend.dev`. Para usar un remitente personalizado (no-reply@tudominio.com) necesitás comprar y verificar un dominio. Usar direcciones arbitrarias @resend.dev no es soportado y puede bloquearse.

### Cuándo migrar a un dominio propio
Migra antes de exponer la app públicamente o cuando:
* Haya usuarios reales externos.
* Necesites mejor tasa de apertura y menos spam.
* Quieras enviar otros tipos de emails (invitaciones, resúmenes, etc.).
* Requieras cumplimiento de políticas de seguridad / auditoría.

### Pasos para la migración futura (Backlog)
1. Registrar dominio (ej. fulbitoweb.com) en un registrador confiable (Cloudflare Registrar, Porkbun, Namecheap).
2. Mantener NS por defecto inicialmente (más simple).
3. Agregar registros DNS:
  * DKIM: `resend._domainkey` TXT con valor que entrega Resend (clave larga `v=DKIM1; k=rsa; p=...`).
  * SPF: `@` TXT → `v=spf1 include:resend.com ~all`.
  * DMARC (opcional inicial): `_dmarc` TXT → `v=DMARC1; p=none; rua=mailto:postmaster@<dominio>`.
4. Esperar propagación (5–30 min) y refrescar verificación en Resend.
5. Cambiar `.env`: `EMAIL_FROM=Fulbito <no-reply@fulbitoweb.com>`.
6. Reiniciar backend y probar flujo de reset (script o endpoint).

### Variables de entorno relevantes
```env
EMAIL_PROVIDER=resend
EMAIL_FROM=onboarding@resend.dev   # cambiar a no-reply@tudominio.com tras verificación
RESEND_API_KEY=...                 # clave real de Resend
RESET_CODE_TTL_MINUTES=15
RESET_CODE_THROTTLE_MS=60000
```

### Script de prueba directa (sin servidor HTTP)
```bash
npx tsx scripts/test-email-reset.ts tu_correo@ejemplo.com 123456
```
Muestra “Listo…” y si el remitente está activo llega el correo / o se loguea en consola (modo fallback).

### Backlog / Nota técnica
Añadir una tarjeta: “Adquirir dominio y configurar DKIM/SPF/DMARC antes de lanzamiento público”.

---
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