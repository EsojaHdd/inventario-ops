-- InventarioOps — Schema v3
-- Todos los CREATE usan IF NOT EXISTS para sobrevivir reinicios sin -v

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
DO $$ BEGIN
  CREATE TYPE rol_usuario  AS ENUM ('admin', 'supervisor', 'operador');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estatus_guia AS ENUM ('pendiente', 'escaneada', 'transito_local', 'transito_mty', 'desconocida', 'abandono');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_escaneo AS ENUM ('escaneo', 'consulta', 'cambio_ubicacion', 'transito', 'nota', 'auditoria');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tablas
CREATE TABLE IF NOT EXISTS usuarios (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(50) NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  rol           rol_usuario NOT NULL DEFAULT 'operador',
  activo        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ubicaciones (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     VARCHAR(20) NOT NULL UNIQUE,
  zona       VARCHAR(10) NOT NULL,
  rack       VARCHAR(10) NOT NULL,
  nivel      VARCHAR(10) NOT NULL,
  etiqueta   VARCHAR(100),           -- nombre descriptivo ej: "Anaquel entrada"
  activa     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ubicaciones_codigo ON ubicaciones(codigo);

CREATE TABLE IF NOT EXISTS dias_operacion (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha              DATE NOT NULL UNIQUE,
  lista_inv_cargada  BOOLEAN     NOT NULL DEFAULT false,
  lista_inv_at       TIMESTAMPTZ,
  lista_inv_usuario  UUID REFERENCES usuarios(id),
  cerrado            BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guias (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dia_id            UUID        NOT NULL REFERENCES dias_operacion(id) ON DELETE CASCADE,
  numero_guia       VARCHAR(50) NOT NULL,
  numero_master     VARCHAR(50),
  destino           VARCHAR(100),
  remitente         TEXT,
  cliente           TEXT,
  descripcion       TEXT,
  proceso           VARCHAR(30),
  total_bultos      INTEGER     NOT NULL DEFAULT 1,
  bultos_escaneados INTEGER     NOT NULL DEFAULT 0,
  estatus           estatus_guia NOT NULL DEFAULT 'pendiente',
  ubicacion_id      UUID REFERENCES ubicaciones(id),
  tipo_transito     VARCHAR(20),
  cerrado_como      VARCHAR(20),
  cerrado_por       UUID REFERENCES usuarios(id),
  cerrado_at        TIMESTAMPTZ,
  ultimo_escaneo    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(dia_id, numero_guia)
);
CREATE INDEX IF NOT EXISTS idx_guias_dia       ON guias(dia_id);
CREATE INDEX IF NOT EXISTS idx_guias_numero    ON guias(numero_guia);
CREATE INDEX IF NOT EXISTS idx_guias_estatus   ON guias(estatus);
CREATE INDEX IF NOT EXISTS idx_guias_ubicacion ON guias(ubicacion_id);

-- PIDs: bultos individuales de una guia
CREATE TABLE IF NOT EXISTS pids (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guia_id    UUID        NOT NULL REFERENCES guias(id) ON DELETE CASCADE,
  pid        VARCHAR(100) NOT NULL,
  escaneado  BOOLEAN     NOT NULL DEFAULT false,
  scanned_at TIMESTAMPTZ,
  usuario_id UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guia_id, pid)
);
CREATE INDEX IF NOT EXISTS idx_pids_guia ON pids(guia_id);
CREATE INDEX IF NOT EXISTS idx_pids_pid  ON pids(pid);

-- Notas por guia
CREATE TABLE IF NOT EXISTS notas_guia (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guia_id    UUID        NOT NULL REFERENCES guias(id) ON DELETE CASCADE,
  usuario_id UUID        NOT NULL REFERENCES usuarios(id),
  texto      TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notas_guia ON notas_guia(guia_id);

-- Auditorias
CREATE TABLE IF NOT EXISTS auditorias (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   UUID        NOT NULL REFERENCES usuarios(id),
  iniciada_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cerrada_at   TIMESTAMPTZ,
  total_sistema   INTEGER NOT NULL DEFAULT 0,
  total_fisico    INTEGER NOT NULL DEFAULT 0,
  coincidencias   INTEGER NOT NULL DEFAULT 0,
  sobrantes       INTEGER NOT NULL DEFAULT 0,
  faltantes       INTEGER NOT NULL DEFAULT 0,
  cerrada      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS auditoria_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auditoria_id UUID        NOT NULL REFERENCES auditorias(id) ON DELETE CASCADE,
  guia_id      UUID        REFERENCES guias(id),
  numero_guia  VARCHAR(50) NOT NULL,
  ubicacion    VARCHAR(20),
  resultado    VARCHAR(20) NOT NULL, -- 'coincidencia' | 'sobrante' | 'faltante'
  scanned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_items ON auditoria_items(auditoria_id);

-- escaneos: log completo
CREATE TABLE IF NOT EXISTS escaneos (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guia_id      UUID        REFERENCES guias(id),
  usuario_id   UUID        REFERENCES usuarios(id),
  ubicacion_id UUID        REFERENCES ubicaciones(id),
  tipo         tipo_escaneo NOT NULL DEFAULT 'escaneo',
  detalle      TEXT,
  barcode_raw  VARCHAR(100) NOT NULL,
  dispositivo  VARCHAR(50),
  scanned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_escaneos_guia    ON escaneos(guia_id);
CREATE INDEX IF NOT EXISTS idx_escaneos_usuario ON escaneos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_escaneos_fecha   ON escaneos(scanned_at);

-- Migraciones para BD existente (agrega columnas si no existen)
DO $$ BEGIN
  ALTER TABLE ubicaciones ADD COLUMN etiqueta VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE tipo_escaneo ADD VALUE IF NOT EXISTS 'nota';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE tipo_escaneo ADD VALUE IF NOT EXISTS 'auditoria';
EXCEPTION WHEN others THEN NULL; END $$;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON usuarios;
CREATE TRIGGER trg_usuarios_updated_at BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_guias_updated_at ON guias;
CREATE TRIGGER trg_guias_updated_at BEFORE UPDATE ON guias FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- El usuario admin se crea en el arranque del backend (seedAdmin)
-- Credenciales por defecto: admin / admin123
