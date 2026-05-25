#!/usr/bin/env bash
# comments-worker (Cloudflare Worker) 운영 배포.
# 부모 `.wrangler/deploy/config.json` 이 Astro Pages 빌드를 가리켜 wrangler 가 그걸 잡아가는 문제 우회 — 임시 백업 후 복원.
# 사용: CLOUDFLARE_API_TOKEN=... bash scripts/deploy-comments-worker.sh
set -e
ROOT="/home/azgian/Dev/svelte/jsbooks"
# CLOUDFLARE_API_TOKEN 이 미설정이면 .env 에서 가져온다 (azgianlab 전담 머신).
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$ROOT/.env" ]; then
  set -a; . "$ROOT/.env"; set +a
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN 미설정. $ROOT/.env 또는 환경변수 확인." >&2
  exit 1
fi
BAK="$ROOT/.wrangler/deploy/config.json"
if [ -f "$BAK" ]; then mv "$BAK" "$BAK.tmpbak"; fi
trap '[ -f "$BAK.tmpbak" ] && mv "$BAK.tmpbak" "$BAK"' EXIT
cd "$ROOT/comments-worker"
exec npx wrangler deploy -c wrangler.toml --env=""
