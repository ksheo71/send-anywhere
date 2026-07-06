#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/stack/services/public/myazit.kr/send-anywhere"
cd "$APP_DIR"

git -C repo fetch --prune origin
git -C repo reset --hard origin/main

docker compose --env-file .env -f repo/docker-compose.yml up -d --build --force-recreate --remove-orphans
docker image prune -f

# health check (최대 60초)
for i in $(seq 1 30); do
  if docker exec send-anywhere wget -q --spider http://localhost:4500/api/health; then
    echo "healthy"; exit 0
  fi
  sleep 2
done
echo "health check 실패"; exit 1
