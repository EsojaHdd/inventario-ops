# InventarioOps

Real-time warehouse inventory system built for **Zebra TC22 scanners**. Tracks shipments, manages locations, and provides live dashboards for supervisors — all operated directly from the scanner screen.

## Stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL 16 |
| Cache / WebSockets | Redis 7 |
| Backend | Node.js + JWT auth |
| Frontend | React + Vite + Nginx |
| Orchestration | Docker Compose |

## Project structure

```
inventario-ops/
├── docker-compose.yml
├── .env.example
├── db/
│   └── init.sql          ← PostgreSQL schema (ENUMs, triggers, indexes)
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── App.jsx
        └── pages/
            ├── Dashboard.jsx
            ├── ScannerTC22.jsx
            └── Admin.jsx
```

## Setup

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env — set DB_PASSWORD and JWT_SECRET before running

# 2. Start all services
docker compose up -d

# 3. Follow logs
docker compose logs -f backend

# 4. Stop
docker compose down
```

## URLs

| URL | Description |
|-----|-------------|
| `http://SERVER/` | Supervisor dashboard |
| `http://SERVER/scanner` | Zebra TC22 scanner screen |
| `http://SERVER/admin` | Admin panel |

## First login

- **User:** `admin`
- **Password:** defined in `.env` at first run

> ⚠️ Change the default password immediately from the Admin panel (`/admin`) before going to production.

## Roles

| Role | Permissions |
|---|---|
| **operator** | Scan packages, query status, change location |
| **supervisor** | All operator permissions + upload lists + view dashboard |
| **admin** | All supervisor permissions + manage users, locations, mark abandoned |

## Zebra TC22 configuration

The TC22 scanner with DataWedge can be configured in **HID keyboard mode**:
- Open DataWedge on the TC22
- Active profile → Output → Keyboard
- The scanner sends the barcode as keyboard input
- The `/scanner` page captures input automatically — no extra app needed

## List formats

The system accepts **CSV, XLSX, or TXT** files.

**Transit list** — expected columns:
`DATE, MASTER, TRACKING, VALUE, CURRENCY, PIECES, WEIGHT, DESTINATION, SENDER, RECIPIENT, DESCRIPTION, PROCESS`

**Inventory list** — single `TRACKING` column (one per line; plain TXT also works).
