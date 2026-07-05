#!/usr/bin/env bash
# Export the Replit Postgres database to a pg_dump custom-format archive.
#
# Run inside the Replit workspace shell (DATABASE_URL is already set there):
#   bash scripts/azure/export-replit-db.sh [output-file]
#
# The custom format (-Fc) is compressed and lets pg_restore reorder/skip
# objects. --no-owner/--no-privileges strip Replit-specific role grants that
# do not exist on Azure.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set. Run this inside the Replit workspace shell.}"

OUT="${1:-fietsroute-$(date +%Y%m%d-%H%M%S).dump}"

echo "Dumping database to $OUT ..."
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "$OUT"

echo "Dump complete: $(du -h "$OUT" | cut -f1)"
echo
echo "Tables and exact row counts in the source database:"
psql "$DATABASE_URL" -t -A -F' | ' -c "
  SELECT table_name,
         (xpath('/row/cnt/text()',
                query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I', table_schema, table_name),
                             false, true, '')))[1]::text::bigint AS rows
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;"
echo
echo "Next: download $OUT and restore it into Azure with:"
echo "  bash scripts/azure/restore-azure-db.sh '<azure-connection-url>' $OUT"
