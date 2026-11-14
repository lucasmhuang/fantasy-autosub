#!/usr/bin/env bash
# The nightly backup (C6b; Railway runs it as a cron service, C8): dumps the database, encrypts
# the dump to the owner's age key, and uploads it once to the bucket as <UTC time>.dump.age. Any
# failure exits non-zero with nothing uploaded. It prints no address, password or key.

set -euo pipefail

# Every setting is checked before anything runs.
for name in BACKUP_DATABASE_URL BACKUP_AGE_RECIPIENT BACKUP_BUCKET BACKUP_S3_ENDPOINT \
  BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
  if [ -z "${!name:-}" ]; then
    echo "backup: ${name} is not set" >&2
    exit 2
  fi
done

region="${BACKUP_S3_REGION:-auto}"
key="$(date -u +%Y-%m-%dT%H-%M-%SZ).dump.age"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
# A database that doesn't answer fails the connect, not the whole run's time limit.
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

echo "backup: dumping the database"
pg_dump --format=custom --no-owner --file="${work}/dump" "${BACKUP_DATABASE_URL}"

echo "backup: encrypting the dump"
age -r "${BACKUP_AGE_RECIPIENT}" -o "${work}/dump.age" "${work}/dump"
rm -f "${work}/dump"

# The keys reach curl on its standard input, never its command line. S3 keeps an object only
# once its upload completes, so a failed upload leaves none.
echo "backup: uploading ${key}"
printf 'user = "%s:%s"\n' "${BACKUP_S3_ACCESS_KEY_ID}" "${BACKUP_S3_SECRET_ACCESS_KEY}" |
  curl --config - --silent --show-error --fail \
    --aws-sigv4 "aws:amz:${region}:s3" \
    -T "${work}/dump.age" "${BACKUP_S3_ENDPOINT%/}/${BACKUP_BUCKET}/${key}"

echo "backup: done"
