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
# instalar dependencias
npm install

# levantar en modo dev
npm run dev

# compilar
npm run build

# ejecutar compilado
npm start