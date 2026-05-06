# jsbooks — Claude 컨텍스트

증산계열 경전 디지털화 프로젝트. 옵시디언 vault → Astro 빌드 → Cloudflare Pages 정적 호스팅. 댓글·사용자 데이터는 Cloudflare D1.

## 핵심 위치

```
~/Vault-jsbooks/                       # 옵시디언 vault (markdown source mirror)
~/Dev/svelte/jsbooks/                  # repo (이 디렉토리)
  content/scripture/                   # 빌드 입력 (vault에서 sync)
  content/_data/correspondences.{yml,json}  # cross-scripture 매칭 데이터
  src/pages/library/<slug>/            # 경전별 라우트
  src/pages/admin/canonical-mapping/   # 관리자 매핑 도구 (dev only)
  scripts/vite-canonical-mapping.mjs   # dev-only Vite plugin (vault 쓰기 API)
```

## 등록된 경전 (slug → URL)

- `cheonjigaebyeokgyeong` (천지개벽경) — 정식판, 한자 + 한글 매핑
- `cheonjigaebyeokgyeong-hangeul` — 임시 한글본 백업 (admin only)
- `donggokbiseo` (동곡비서) — 단일 한글본 평면 시퀀스
- `hwaeundang-silgi` (화은당실기) — 8장 + 서문 + 부록

## 절 anchor 형식

- 천지개벽경: `편-장-절` (예: `1-1-3`), 서문은 `preface-N`
- 동곡비서: 평면 N (예: `42`)
- 화은당실기: `장-절` (예: `3-7`), 서문/부록은 단락 본문 (anchor 없음)

## 일상 명령

```bash
pnpm sync:vault         # ~/Vault-jsbooks → content/ rsync
pnpm dev                # 로컬 dev (port 4321)
pnpm build              # 정적 빌드
pnpm build:correspondences  # AI 임베딩 기반 cross-ref 재생성
git push                # → CF Pages 자동 배포
git commit -m "... [skip ci]"  # 빌드 스킵 (백업 push 등)
```

## 데이터 흐름

| 데이터 | 저장 위치 | 사이트 영향 |
|---|---|---|
| 경전 본문 | vault → content/ → 빌드 정적 자원 | 정적 |
| 매핑 JSON | vault `_mappings/` + content/ mirror | 정적 |
| correspondences yml/json | content/_data/ (vault 밖) | 정적 |
| 댓글·사용자 | Cloudflare D1 | 동적 |

## 메모리

자세한 결정·진행 상황은 `~/.claude/projects/-home-azgian-Vault/memory/MEMORY.md`에 인덱싱되어 있음. 특히:

- `project_jsbooks.md` — 프로젝트 개요
- `project_jsbooks_canonical_scripture_model.md` — 천지개벽경 한자/한글 모델
- `project_jsbooks_canonical_mapping_tool.md` — 매핑 도구 진행상태
- `feedback_jsbooks_*` — UI·톤·작업 규칙

## 안전 규칙 (요약)

- vault markdown 변경 시 `~/Vault-jsbooks/.bak/<timestamp>/` 자동 백업 (admin 도구)
- 사용자 매핑 작업 중 파일 임의 수정 금지 (`feedback_jsbooks_dont_touch_user_work.md`)
- AI 1차 매칭 결과는 vault 안 건드림 (correspondences.yml만)
