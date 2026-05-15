-- Add promoted_to_note_id column to comments table.
-- Tracks comments that have been promoted into a markdown note (footnote with
-- `[^uc-YYYY-MM-DD-N]` identifier) in the vault. Value = the footnote id.
--
-- Apply once against the live D1 DB:
--   wrangler d1 execute jsbooks-db --remote --file=comments-worker/migrations/2026-05-15-comments-promoted-to-note.sql
ALTER TABLE comments ADD COLUMN promoted_to_note_id TEXT;
CREATE INDEX IF NOT EXISTS idx_comments_promoted ON comments(promoted_to_note_id);
