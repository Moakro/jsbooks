-- Add admin pin flag + note-promotion hook + per-user photo dedup index.
--
-- Apply locally:
--   pnpm exec wrangler d1 migrations apply jsbooks-db --local
-- Apply remotely (run by maintainer after merge):
--   pnpm exec wrangler d1 migrations apply jsbooks-db --remote

ALTER TABLE comments ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN promoted_to_note_id TEXT;
CREATE INDEX IF NOT EXISTS idx_comments_pinned
  ON comments(target_type, target_id, is_pinned, created_at);

-- 사용자별 사진 dedup. 동일 사용자가 같은 sha256을 다시 올리면
-- 기존 r2_key·url을 반환하여 재업로드를 막는다. orphan cleanup은 별도 트랙.
CREATE TABLE IF NOT EXISTS user_uploaded_photos (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash         TEXT NOT NULL,
  url          TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  size_bytes   INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, hash)
);
