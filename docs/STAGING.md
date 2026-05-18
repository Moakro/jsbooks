# Staging 환경 (stage.jsbooks.wiki)

프로덕션과 코드 100% 동일하게 두 worker (메인 Astro 앱 + comments-worker) 를 별도 이름·도메인으로 띄우는 staging 셋업. 데이터(D1)는 분리.

## 구조

| 영역 | Production | Staging |
|---|---|---|
| 메인 앱 worker | `jsbooks` (`jsbooks.wiki/*`) | `jsbooks-stage` (`stage.jsbooks.wiki/*`) |
| 댓글 API worker | `jsbooks-comments` (`jsbooks.wiki/api/*`) | `jsbooks-comments-stage` (`stage.jsbooks.wiki/api/*`) |
| D1 | `jsbooks-db` | `jsbooks-db-stage` (별도) |
| R2 (이미지) | `jsbooks-uploads` | 공유 |
| OAuth callback | `https://jsbooks.wiki/api/auth/callback/google` | `https://stage.jsbooks.wiki/api/auth/callback/google` |

## 1회 셋업 (수동 단계)

### 1. D1 staging DB 생성

```bash
cd comments-worker
npx wrangler d1 create jsbooks-db-stage
```

출력 마지막의 `database_id = "..."` 값을 [comments-worker/wrangler.toml](../comments-worker/wrangler.toml) 의 `[[env.staging.d1_databases]] database_id = "REPLACE_WITH_STAGING_DB_ID"` 자리에 채워 넣고 커밋.

### 2. D1 마이그레이션 적용

```bash
cd comments-worker
npx wrangler d1 execute jsbooks-db-stage --remote --file=./schema.sql
```

### 3. DNS — stage.jsbooks.wiki

Cloudflare 대시보드 → jsbooks.wiki 도메인 → DNS → Add record:

- Type: A
- Name: `stage`
- IPv4: `192.0.2.1` (placeholder, Workers 가 가로챔)
- Proxy: ✓ (orange cloud)

또는 CNAME → `jsbooks.wiki` (proxied).

### 4. Google OAuth — redirect_uri 추가

Google Cloud Console → OAuth 2.0 Client ID → "Authorized redirect URIs" 에:

```
https://stage.jsbooks.wiki/api/auth/callback/google
```

추가. 기존 production URI 유지.

### 5. 시크릿 등록 (staging worker 용)

```bash
cd comments-worker
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put AUTH_SECRET --env staging
```

프로덕션과 **같은 값** 사용해도 OK (OAuth client는 동일, callback URI 만 다름).

## 배포

### 매번 배포 (코드 변경 후)

```bash
# 메인 앱 (Astro)
pnpm build
npx wrangler deploy --env staging

# 댓글 API
cd comments-worker
npx wrangler deploy --env staging --config ./wrangler.toml
```

### 검증

```bash
curl -sI https://stage.jsbooks.wiki/ | head -1
# HTTP/2 200

curl -s https://stage.jsbooks.wiki/api/comments/recent | head -c 100
# {"items":[],"nextCursor":null}  (staging DB 비어있음)
```

## 안전 메모

- **Staging D1 은 빈 상태로 시작** — 실 사용자 댓글 영향 없음
- **R2 공유** — staging 에서 업로드한 이미지는 프로덕션과 같은 버킷에 저장. 별도 분리하려면 `jsbooks-uploads-stage` 버킷 생성 후 wrangler.toml 변경
- **OAuth client 공유 OK** — Google 측에서 origin/callback 만 매칭. 단 staging 에서 로그인하면 그 세션은 staging 도메인 cookie 라 프로덕션 영향 없음
- **프로덕션 배포 (`wrangler deploy` 인자 없이)** 와 staging 배포 (`--env staging`) 가 서로 다른 worker 라 명령 실수 시 영향 없음. 다만 `--env` 빠뜨리면 프로덕션 배포되니 주의

## CI / 자동 배포

현재 없음. 수동 `wrangler deploy --env staging`. 추후 GitHub Actions 추가 시:
- main 브랜치 push → 프로덕션 자동 배포 (현재 CF Workers Builds 가 이미 수행)
- 다른 브랜치 push → staging 자동 배포 추가 검토
