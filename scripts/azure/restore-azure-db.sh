#!/usr/bin/env bash
# Restore a pg_dump archive (created by export-replit-db.sh) into
# Azure Database for PostgreSQL (Flexible Server).
#
#   bash scripts/azure/restore-azure-db.sh '<azure-connection-url>' <dump-file>
#
# Example connection URL:
#   postgresql://fietsadmin:PASSWORD@myserver.postgres.database.azure.com:5432/fietsroute?sslmode=require
#
# Notes:
# - The target database must already exist (create it in the Azure portal or
#   with: psql '<admin-url>/postgres' -c 'CREATE DATABASE fietsroute').
# - --clean --if-exists makes the restore repeatable (drops objects first).
# - --no-owner/--no-privileges avoid errors about missing Replit roles.

set -euo pipefail

TARGET_URL="${1:?Usage: restore-azure-db.sh '<azure-connection-url>' <dump-file>}"
DUMP_FILE="${2:?Usage: restore-azure-db.sh '<azure-connection-url>' <dump-file>}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "ERROR: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

echo "Restoring $DUMP_FILE ..."
pg_restore \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --exit-on-error \
  --dbname "$TARGET_URL" \
  "$DUMP_FILE"

echo
echo "Restore complete. Tables and exact row counts in the target database:"
psql "$TARGET_URL" -t -A -F' | ' -c "
  SELECT table_name,
         (xpath('/row/cnt/text()',
                query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I', table_schema, table_name),
                             false, true, '')))[1]::text::bigint AS rows
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;"
echo
echo "Compare these counts against the ones printed by export-replit-db.sh."
