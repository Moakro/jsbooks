-- news — 사이트 공지/업데이트/릴리스/로드맵. 운영자(level>=4) 가 CMS 에서 작성·수정·발행.
-- 일반 회원·비회원은 발행된(draft=0) 글만 조회. body_md = 마크다운 원문,
-- body_html = 워커에서 렌더한 캐시(생성·수정 시 갱신).
-- D1 remote 는 트랜잭션 문(begin/savepoint) 거부 — 개별 statement 만 사용.

CREATE TABLE IF NOT EXISTS news (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,                              -- notice|update|release|roadmap
  body_md      TEXT NOT NULL,
  body_html    TEXT NOT NULL DEFAULT '',
  summary      TEXT,
  draft        INTEGER NOT NULL DEFAULT 0,                 -- 0=published, 1=draft
  published_at TEXT,                                       -- ISO 'YYYY-MM-DDTHH:MM:SSZ' (draft 면 NULL)
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_news_published
  ON news(draft, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_category
  ON news(category, published_at DESC);

-- Seed: vault 의 첫 뉴스 1건. 운영자 계정이 존재할 때만 INSERT (없으면 skip).
-- 운영자 부재 환경(테스트·신규 DB) 에서는 admin UI 첫 글 작성 시 자연스럽게 채워짐.
INSERT INTO news (id, slug, title, category, body_md, body_html, summary, draft, published_at, author_id, created_at, updated_at)
SELECT
  'seed-2026-05-20-news-start',
  '2026-05-20_사이트-소식-시작',
  '사이트 소식을 시작합니다',
  'notice',
  '증산계열 경전을 디지털로 보존하고 공개하는 **jsbooks**의 소식을 이곳에서 전합니다.

앞으로 다음과 같은 소식을 카테고리별로 정리해 알려드립니다.

- **공지** — 서비스 운영과 관련한 안내
- **업데이트** — 경전·자료 추가 및 개선
- **릴리스** — 새 기능 공개
- **로드맵** — 앞으로의 계획

새 경전이 추가되거나 기능이 개선되면 이 뉴스에서 가장 먼저 알려드리겠습니다.',
  '<p>증산계열 경전을 디지털로 보존하고 공개하는 <strong>jsbooks</strong>의 소식을 이곳에서 전합니다.</p>
<p>앞으로 다음과 같은 소식을 카테고리별로 정리해 알려드립니다.</p>
<ul><li><strong>공지</strong> — 서비스 운영과 관련한 안내</li><li><strong>업데이트</strong> — 경전·자료 추가 및 개선</li><li><strong>릴리스</strong> — 새 기능 공개</li><li><strong>로드맵</strong> — 앞으로의 계획</li></ul>
<p>새 경전이 추가되거나 기능이 개선되면 이 뉴스에서 가장 먼저 알려드리겠습니다.</p>',
  'jsbooks의 공지·업데이트·릴리스·로드맵을 이곳 뉴스에서 전합니다.',
  0,
  '2026-05-20T00:00:00Z',
  u.id,
  '2026-05-20T00:00:00Z',
  '2026-05-20T00:00:00Z'
FROM users u
WHERE u.level >= 4
ORDER BY u.created_at ASC
LIMIT 1;
