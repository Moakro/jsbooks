-- Add attachments column to comments table.
-- JSON array, each item: { type: "image", url, width?, height? } or { type: "map", lat, lng, zoom?, label? }.
-- Apply once against the live D1 DB:
--   wrangler d1 execute jsbooks-db --remote --file=comments-worker/migrations/2026-05-06-comments-attachments.sql
ALTER TABLE comments ADD COLUMN attachments TEXT;
