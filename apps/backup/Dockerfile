# The nightly backup's image (C6b, C8). pg_dump must match the server's major version, 17, so the
# base is postgres:17-alpine, pinned by digest; age encrypts and curl uploads.
FROM postgres:17-alpine@sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0

RUN apk add --no-cache bash age curl

COPY apps/backup/backup.sh /usr/local/bin/injurysub-backup

USER postgres

# The whole run is bounded: a hung dump or upload ends in a failed run, not a stuck one.
CMD ["timeout", "1800", "/usr/local/bin/injurysub-backup"]
