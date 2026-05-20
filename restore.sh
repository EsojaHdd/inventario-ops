#!/bin/bash
# InventarioOps — Restaurar un backup
# Uso: ./restore.sh inventario_2026-03-30.sql.gz

BACKUP_DIR="/opt/inventario-backups"
CONTAINER="inventario_db"
DB_NAME="inventario"
DB_USER="inventario"

if [ -z "$1" ]; then
  echo "Uso: ./restore.sh <archivo.sql.gz>"
  echo ""
  echo "Backups disponibles:"
  ls -lh "$BACKUP_DIR"/inventario_*.sql.gz 2>/dev/null || echo "  (ninguno)"
  exit 1
fi

ARCHIVO="$BACKUP_DIR/$1"
if [ ! -f "$ARCHIVO" ]; then
  # Intentar ruta absoluta si no se encontró en BACKUP_DIR
  ARCHIVO="$1"
fi

if [ ! -f "$ARCHIVO" ]; then
  echo "❌ Archivo no encontrado: $1"
  exit 1
fi

echo "⚠️  Esto BORRARÁ la base de datos actual y restaurará desde:"
echo "   $ARCHIVO"
echo ""
read -p "¿Confirmas? (escribe 'si' para continuar): " CONFIRM

if [ "$CONFIRM" != "si" ]; then
  echo "Cancelado."
  exit 0
fi

echo "🔄 Restaurando..."

# Borrar BD actual y recrear
docker exec "$CONTAINER" psql -U "$DB_USER" -c "DROP DATABASE IF EXISTS $DB_NAME;"
docker exec "$CONTAINER" psql -U "$DB_USER" -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

# Restaurar desde el dump
zcat "$ARCHIVO" | docker exec -i "$CONTAINER" psql -U "$DB_USER" "$DB_NAME"

if [ $? -eq 0 ]; then
  echo "✅ Restauración completada desde $ARCHIVO"
else
  echo "❌ Error durante la restauración"
  exit 1
fi
