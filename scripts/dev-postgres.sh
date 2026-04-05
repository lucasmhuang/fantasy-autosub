#!/usr/bin/env bash

set -euo pipefail

if [ -f ./.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -f ./.env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

readonly CONTAINER_NAME="injurysub-postgres"
readonly IMAGE_NAME="postgres:17-alpine"
readonly VOLUME_NAME="injurysub-postgres-data"
readonly DATABASE_NAME="injurysub"
readonly DATABASE_USER="postgres"
readonly DATABASE_PASSWORD="postgres"
readonly HOST_PORT="${INJURYSUB_DB_PORT:-5432}"
readonly HEALTH_RETRIES="30"

has_docker_compose_plugin() {
  docker compose version >/dev/null 2>&1
}

container_exists() {
  docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1
}

wait_for_postgres() {
  local attempt=1

  while [ "$attempt" -le "$HEALTH_RETRIES" ]; do
    if docker exec "$CONTAINER_NAME" pg_isready -U "$DATABASE_USER" -d "$DATABASE_NAME" >/dev/null 2>&1; then
      echo "postgres is ready"
      return 0
    fi

    sleep 1
    attempt=$((attempt + 1))
  done

  echo "postgres did not become ready in time" >&2
  return 1
}

start_without_compose() {
  if container_exists; then
    docker start "$CONTAINER_NAME" >/dev/null
  else
    docker volume create "$VOLUME_NAME" >/dev/null
    docker run \
      --detach \
      --name "$CONTAINER_NAME" \
      --restart unless-stopped \
      --env "POSTGRES_DB=$DATABASE_NAME" \
      --env "POSTGRES_USER=$DATABASE_USER" \
      --env "POSTGRES_PASSWORD=$DATABASE_PASSWORD" \
      --publish "$HOST_PORT:5432" \
      --volume "$VOLUME_NAME:/var/lib/postgresql/data" \
      "$IMAGE_NAME" >/dev/null
  fi
}

stop_without_compose() {
  if container_exists; then
    docker stop "$CONTAINER_NAME" >/dev/null
  fi
}

down_without_compose() {
  if container_exists; then
    docker rm --force "$CONTAINER_NAME" >/dev/null
  fi
}

logs_without_compose() {
  docker logs --follow "$CONTAINER_NAME"
}

case "${1:-}" in
  start)
    if has_docker_compose_plugin; then
      docker compose up -d postgres
    else
      start_without_compose
    fi
    wait_for_postgres
    ;;
  stop)
    if has_docker_compose_plugin; then
      docker compose stop postgres
    else
      stop_without_compose
    fi
    ;;
  down)
    if has_docker_compose_plugin; then
      docker compose down
    else
      down_without_compose
    fi
    ;;
  logs)
    if has_docker_compose_plugin; then
      docker compose logs -f postgres
    else
      logs_without_compose
    fi
    ;;
  *)
    echo "usage: $0 {start|stop|down|logs}" >&2
    exit 1
    ;;
esac
