-- events v2: 폼 재설계 — 카테고리·기념일·연례·음력·공개 옵션
-- 추가 컬럼:
--   is_annual : 매년 반복(기념일 + 연례)
--   is_lunar  : 음력 기준(기념일 + 음력). start_date 자체를 음력 'YYYY-MM-DD' 로 저장
--   is_public : 사이트 전체 공개(일정/기타 + 공개)
-- BEGIN TRANSACTION 금지(원격 D1 제약). 개별 statement 만.
-- all_day 컬럼은 호환을 위해 남기고 신규 row 는 무시(폼에서 제거).

ALTER TABLE events ADD COLUMN is_annual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN is_lunar  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;

-- 기존 row 의 category 호환 매핑 (구 enum → 신 enum).
-- 업무/개인 → 일정,  교단 → 기념일,  기타 → 기타,  NULL → 기념일(기본값).
UPDATE events SET category = '일정'   WHERE category IN ('업무', '개인');
UPDATE events SET category = '기념일' WHERE category = '교단';
UPDATE events SET category = '기념일' WHERE category IS NULL OR category = '';

-- 공개 일정 조회용 인덱스 (월 범위 + 공개 여부)
CREATE INDEX IF NOT EXISTS idx_events_public_month ON events(is_public, start_date) WHERE is_public = 1;
-- 연례/음력 일정 빠른 조회용 (월 무시, 모두 가져와 클라이언트·서버에서 매년 발생일 계산)
CREATE INDEX IF NOT EXISTS idx_events_user_annual ON events(user_id, is_annual) WHERE is_annual = 1;
