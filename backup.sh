#!/bin/bash
# InventarioOps — Backup semanal con retención de 4 semanas
# Guarda un dump de PostgreSQL y exporta el Excel del período
# Uso: ./backup.sh
# Cron recomendado: 0 2 * * 0   (cada domingo a las 2am)

# ── Configuración ──────────────────────────────────────────
BACKUP_DIR="/opt/inventario-backups"   # Carpeta donde se guardan los backups
CONTAINER="inventario_db"             # Nombre del contenedor PostgreSQL
DB_NAME="inventario"
DB_USER="inventario"
KEEP_WEEKS=4                          # Cuántos backups conservar

# ── Setup ──────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
FECHA=$(date +%Y-%m-%d)
ARCHIVO="$BACKUP_DIR/inventario_$FECHA.sql.gz"

echo "🗄️  InventarioOps — Backup $FECHA"

# ── Dump de PostgreSQL comprimido ──────────────────────────
docker exec "$CONTAINER" \
  pg_dump -U "$DB_USER" "$DB_NAME" \
  | gzip > "$ARCHIVO"

if [ $? -eq 0 ]; then
  TAMANIO=$(du -sh "$ARCHIVO" | cut -f1)
  echo "✅ Backup guardado: $ARCHIVO ($TAMANIO)"
else
  echo "❌ Error al generar el backup"
  exit 1
fi

# ── Borrar backups más antiguos que 4 semanas ──────────────
echo "🧹 Limpiando backups con más de $KEEP_WEEKS semanas..."
find "$BACKUP_DIR" -name "inventario_*.sql.gz" \
  -mtime +$((KEEP_WEEKS * 7)) \
  -print -delete

# ── Resumen de backups actuales ────────────────────────────
echo ""
echo "📦 Backups disponibles:"
ls -lh "$BACKUP_DIR"/inventario_*.sql.gz 2>/dev/null || echo "  (ninguno)"
echo ""
echo "✅ Backup completado"
