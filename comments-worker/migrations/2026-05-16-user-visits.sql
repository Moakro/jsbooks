-- user_visits — 회원별 (경전, 장) 마지막 방문 시각.
-- "새 댓글 수" 계산에 사용: created_at > last_visited.
-- 비로그인 사용자는 클라이언트 localStorage로 동일 형식 fallback.

CREATE TABLE IF NOT EXISTS user_visits (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scripture_slug TEXT NOT NULL,
  chapter_anchor TEXT NOT NULL,   -- "vol-chap" (예: "2-3") · 평면 경전은 "0"
  last_visited   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, scripture_slug, chapter_anchor)
);

CREATE INDEX IF NOT EXISTS idx_user_visits_user
  ON user_visits(user_id, scripture_slug);
