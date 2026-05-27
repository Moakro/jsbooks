-- 이미 닉네임(display_name) 을 등록했지만 level=0(대기) 로 남아 있는
-- 기존 사용자를 일괄 일반(1) 으로 승급. 닉네임=자동승급 합의의 코드 누락 보정.
-- (이후 가입자는 worker 의 닉네임 PATCH 핸들러가 level=MAX(level,1) 로 자동 승급.)
UPDATE users
   SET level = 1,
       updated_at = datetime('now')
 WHERE level = 0
   AND display_name IS NOT NULL
   AND TRIM(display_name) <> '';
