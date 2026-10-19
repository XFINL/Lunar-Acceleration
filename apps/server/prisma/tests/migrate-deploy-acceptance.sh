#!/usr/bin/env bash
set -euo pipefail

# Run the real Prisma deployment path against a disposable local MySQL schema.
: "${DATABASE_URL:?Set DATABASE_URL to a disposable localhost *_migration_test database}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SERVER_DIR="$ROOT_DIR/apps/server"

# Reject remote databases and non-dedicated schemas before opening a connection.
read -r DB_HOST DB_PORT DB_NAME < <(node - "$DATABASE_URL" <<'NODE'
const url = new URL(process.argv[2]);
const host = url.hostname;
const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error('Acceptance tests may only use a localhost MySQL server');
}
if (!database.endsWith('_migration_test')) {
  throw new Error('Database name must end in _migration_test');
}
process.stdout.write(`${host} ${url.port || '3306'} ${database}\n`);
NODE
)

# Write a private MySQL option file instead of putting credentials in process arguments.
MYSQL_CNF="$(mktemp)"
SCHEMA_DDL="$(mktemp)"
trap 'rm -f "$MYSQL_CNF" "$SCHEMA_DDL"' EXIT
node - "$DATABASE_URL" "$MYSQL_CNF" <<'NODE'
const fs = require('node:fs');
const url = new URL(process.argv[2]);
const escape = (value) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
const content = [
  '[client]',
  `host=${url.hostname}`,
  `port=${url.port || '3306'}`,
  `user=${decodeURIComponent(url.username)}`,
  `password="${escape(decodeURIComponent(url.password))}"`,
  'default-character-set=utf8mb4',
  '',
].join('\n');
fs.writeFileSync(process.argv[3], content, { mode: 0o600 });
NODE

mysql_query() {
  mysql --defaults-extra-file="$MYSQL_CNF" --batch --skip-column-names "$DB_NAME" -e "$1"
}

PREEXISTING_TABLES="$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'")"
if [[ "$PREEXISTING_TABLES" != "0" ]]; then
  echo "Refusing non-empty database $DB_NAME ($PREEXISTING_TABLES base tables found)." >&2
  exit 1
fi

cd "$SERVER_DIR"
pnpm exec prisma validate
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > "$SCHEMA_DDL"
if grep -Eq 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\([0-9]+\)' "$SCHEMA_DDL"; then
  echo 'Prisma emitted an invalid fractional CURRENT_TIMESTAMP default for DATETIME(0).' >&2
  exit 1
fi
grep -q 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP' "$SCHEMA_DDL" || {
  echo 'Prisma schema does not emit a CURRENT_TIMESTAMP default for created_at.' >&2
  exit 1
}
CREATED_DEFAULT="$(python3 - "$SCHEMA_DDL" <<'PY'
import re, sys
sql = open(sys.argv[1], encoding='utf-8').read()
match = re.search(r'`created_at`\s+DATETIME\s+NOT NULL DEFAULT ([^,\n]+)', sql)
if not match:
    raise SystemExit('No generated created_at default found')
print(match.group(1).strip())
PY
)"
pnpm exec prisma migrate deploy

# Execute the expression emitted by Prisma on MySQL (the old CURRENT_TIMESTAMP(3) form fails).
mysql_query "CREATE TABLE _prisma_created_at_probe (created_at DATETIME NOT NULL DEFAULT $CREATED_DEFAULT)"
mysql_query 'INSERT INTO _prisma_created_at_probe VALUES ()'
PRISMA_CREATED_AT="$(mysql_query 'SELECT created_at IS NOT NULL FROM _prisma_created_at_probe')"
[[ "$PRISMA_CREATED_AT" == "1" ]] || { echo 'Prisma-generated created_at default did not populate a value.' >&2; exit 1; }
mysql_query 'DROP TABLE _prisma_created_at_probe'

# Exercise the pre-existing-object compatibility path used by older deployments.
mysql --defaults-extra-file="$MYSQL_CNF" "$DB_NAME" < "$SERVER_DIR/prisma/migrations/20261022000000_m4_vendor_write_jobs/migration.sql"

EXPECTED_TABLES="vendors vendor_accounts vendor_resources vendor_sync_logs vendor_write_jobs origins domains traffic_stats_hourly"
for table in $EXPECTED_TABLES; do
  FOUND="$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '$table'")"
  [[ "$FOUND" == "1" ]] || { echo "Missing expected table: $table" >&2; exit 1; }
done

COLUMN="$(mysql_query "SELECT CONCAT(IS_NULLABLE, '|', COALESCE(COLUMN_DEFAULT, '<NULL>')) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vendor_resources' AND column_name = 'managed_by_panel'")"
[[ "$COLUMN" == "NO|0" || "$COLUMN" == "NO|b'0'" ]] || { echo "Unexpected managed_by_panel definition: $COLUMN" >&2; exit 1; }
DEFAULT="$(mysql_query "SELECT COALESCE(COLUMN_DEFAULT, '<NULL>') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vendors' AND column_name = 'created_at'")"
[[ "$DEFAULT" == *CURRENT_TIMESTAMP* ]] || { echo "Invalid vendors.created_at default: $DEFAULT" >&2; exit 1; }

VENDOR_CODE="ma-$(date +%s)-$$"
mysql_query "INSERT INTO vendors (name, code, driver) VALUES ('migration acceptance', '$VENDOR_CODE', 'test')"
CREATED_AT="$(mysql_query "SELECT created_at IS NOT NULL AND updated_at IS NOT NULL FROM vendors WHERE code = '$VENDOR_CODE'")"
[[ "$CREATED_AT" == "1" ]] || { echo 'Database timestamp defaults did not populate created_at/updated_at.' >&2; exit 1; }

FK_COUNT="$(mysql_query "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = 'vendor_write_jobs'")"
[[ "$FK_COUNT" == "2" ]] || { echo "Expected 2 vendor_write_jobs foreign keys; found $FK_COUNT." >&2; exit 1; }

TRAFFIC_FK_COUNT="$(mysql_query "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = 'traffic_stats_hourly'")"
[[ "$TRAFFIC_FK_COUNT" == "2" ]] || { echo "Expected 2 traffic_stats_hourly foreign keys; found $TRAFFIC_FK_COUNT." >&2; exit 1; }
TRAFFIC_TYPE="$(mysql_query "SELECT column_type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'traffic_stats_hourly' AND column_name = 'traffic'")"
[[ "$TRAFFIC_TYPE" == "bigint unsigned" ]] || { echo "Unexpected traffic counter type: $TRAFFIC_TYPE." >&2; exit 1; }

echo "PASS: Prisma-generated created_at default; clean-database migrate deploy; vendor dependency order; managed_by_panel; created_at/updated_at defaults; write-job and traffic foreign keys; unsigned traffic counters."
