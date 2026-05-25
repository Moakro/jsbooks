-- events — 회원별 개인 일정. 달력 사이드바 "N월 일정" 섹션 데이터 소스.
-- start_date / end_date 는 ISO 'YYYY-MM-DD'. end_date NULL 이면 단일 일자.
-- all_day=1 기본. category 는 자유 텍스트(클라이언트 enum: 업무·개인·교단·기타).

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  start_date  TEXT NOT NULL,                        -- 'YYYY-MM-DD'
  end_date    TEXT,                                 -- NULL → 단일 일자
  all_day     INTEGER NOT NULL DEFAULT 1,
  category    TEXT,
  memo        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_user_month
  ON events(user_id, start_date);
