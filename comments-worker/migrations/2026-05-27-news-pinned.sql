-- news.pinned — 운영자가 본문 페이지에서 토글, 1=리스트 상단 고정.
-- (worker listNews 가 ORDER BY pinned DESC 로 정렬, NewsList 가 📌 뱃지 표시.)
ALTER TABLE news ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_news_pinned ON news(pinned DESC, published_at DESC);
