# InventarioOps

Sistema de inventario en tiempo real para bodegas con scanners Zebra TC22.

## Estructura del proyecto

```
inventario-ops/
├── docker-compose.yml
├── .env.example
├── db/
│   └── init.sql          ← Schema de PostgreSQL
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

## Levantar en desarrollo / producción

```bash
# 1. Clonar y configurar
cp .env.example .env
# Editar .env con tus contraseñas

# 2. Levantar todo
docker compose up -d

# 3. Ver logs
docker compose logs -f backend

# 4. Bajar
docker compose down
```

## URLs

| URL | Descripción |
|-----|-------------|
| `http://SERVER/` | Dashboard de supervisión |
| `http://SERVER/scanner` | Pantalla Zebra TC22 |
| `http://SERVER/admin` | Panel de administración |

## Usuario por defecto

- **Usuario:** `admin`
- **Contraseña:** `admin123`

⚠️ Cambiar la contraseña en producción desde el panel de Admin.

## Roles y permisos

| Rol | Permisos |
|-----|----------|
| **operador** | Escanear, consultar, cambiar ubicación |
| **supervisor** | Todo del operador + cargar listas + ver dashboard |
| **admin** | Todo + gestión de usuarios, ubicaciones, marcar abandono |

## Configuración de Zebra TC22

El scanner TC22 con DataWedge puede configurarse en modo **HID keyboard**:
- Abre DataWedge en el TC22
- Perfil activo → Output → Keyboard
- El scanner enviará el código como si fuera teclado
- La pantalla `/scanner` captura el input automáticamente

## Formato de las listas

El sistema acepta archivos **CSV, XLSX o TXT**.

Para las listas de tránsito, el formato esperado es el del archivo Excel con columnas:
`FECHA, MASTER, GUIA, VALOR, MND, PZA, PESO, DESTINO, REMITENTE, CLIENTE (DESTINATARIO), DESCRIPCION, PROCESO`

Para la lista de inventario, basta con una columna `GUIA` (una por línea en TXT también funciona).
