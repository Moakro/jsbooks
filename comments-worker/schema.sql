-- jsbooks comments schema (D1 / SQLite)
-- All timestamps are ISO-8601 strings stored in UTC.

-- ──────────────── users ────────────────
-- google_name (legal name from OAuth) is stored ONCE for audit trail but MUST
-- never be returned in any client-facing API response.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                 -- internal UUID
  google_id     TEXT NOT NULL UNIQUE,             -- google "sub" claim
  email         TEXT NOT NULL,                    -- google email (private)
  google_name   TEXT NOT NULL,                    -- legal name (NEVER expose)
  display_name  TEXT,                             -- nickname, NULL until set
  avatar_url    TEXT,
  affiliation   TEXT,                             -- 단체 자가 표시 (선택)
  level         INTEGER NOT NULL DEFAULT 0,       -- 0=대기, 1=일반, 2=검증, 3=큐레이터, 4=운영자
  is_seed       INTEGER NOT NULL DEFAULT 0,       -- 1=운영자 시드 계정 (콘텐츠 누적용 가짜 회원)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);

-- 닉네임 변경 이력 — 도주 방지
CREATE TABLE IF NOT EXISTS display_name_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  old_name    TEXT,
  new_name    TEXT NOT NULL,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dnh_user ON display_name_history(user_id);

-- ──────────────── comments ────────────────
-- target_type / target_id 형태로 절·카드 모두 수용:
--   target_type='verse'   → target_id = "2-2-1" 같은 절 anchor
--   target_type='card'    → target_id = "people:이마두"
--   target_type='chapter' → target_id = "2:2" (권:장)
CREATE TABLE IF NOT EXISTS comments (
  id           TEXT PRIMARY KEY,                  -- UUID
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id),
  parent_id    TEXT REFERENCES comments(id),      -- 답글 (NULL 이면 루트)
  body         TEXT NOT NULL,                     -- 마크다운 원본
  body_html    TEXT NOT NULL,                     -- 서버 sanitized HTML
  type         TEXT NOT NULL,                     -- memo|question|cross|cite
  status       TEXT NOT NULL DEFAULT 'published', -- published|hidden|deleted
  attachments  TEXT,                              -- JSON: [{type:'image',url,width?,height?},{type:'map',lat,lng,zoom?,label?}]
  promoted_to_note_id TEXT,                       -- footnote id (`uc-YYYY-MM-DD-N`) when 운영자가 자료 주석으로 승격함
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_promoted ON comments(promoted_to_note_id);

-- ──────────────── reactions (도움됨) ────────────────
CREATE TABLE IF NOT EXISTS reactions (
  comment_id  TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                     -- helpful (확장 여지)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comment_id, user_id, type)
);
CREATE INDEX IF NOT EXISTS idx_reactions_comment ON reactions(comment_id, type);

-- ──────────────── flags (신고) ────────────────
CREATE TABLE IF NOT EXISTS flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id  TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',      -- open|reviewing|resolved|rejected
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_flags_comment ON flags(comment_id);
CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status);

-- ──────────────── nickname review queue (Phase 2 hook) ────────────────
CREATE TABLE IF NOT EXISTS nickname_review_queue (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id),
  nickname       TEXT NOT NULL,
  ai_risk_score  INTEGER,                        -- 0..10 (Phase 2)
  ai_reason      TEXT,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  decided_by     TEXT REFERENCES users(id),
  decided_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nickname_queue_status ON nickname_review_queue(status, created_at);

-- ──────────────── sessions ────────────────
-- Auth.js 세션 (JWT 사용 시엔 비워둠. DB 세션 모드 대비)
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
