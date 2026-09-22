-- 门户库 schema v1（真源：specs/web-portal/web-design.md §4.4 + §12.6）
--
-- 纪律：
--  - `keys` 只存 `key_hash` + `key_prefix`，**没有明文列**（§4.1 / AC2.2 / TC-P-L0-04）
--  - `audit.detail_json` 不得含令牌明文或记忆正文（§12.6 / T8）—— 写入侧经 shared/redact.ts 兜底
--  - 门户库落在独立卷（`admin_portal_data` → `/srv/portal`），**不在 /data 下**（AC9.4）
--  - 时间一律 ISO 8601 UTC 字符串（TEXT）

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  handle        TEXT    NOT NULL UNIQUE,
  display_name  TEXT,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    TEXT    NOT NULL,
  revoked_at    TEXT
);

CREATE TABLE keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key_hash      BLOB    NOT NULL,
  key_prefix    TEXT    NOT NULL,
  label         TEXT,
  created_at    TEXT    NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);

-- 认证热路径：一次唯一索引命中（§12.6）
CREATE UNIQUE INDEX idx_keys_key_hash ON keys (key_hash);
CREATE INDEX idx_keys_user_id ON keys (user_id);

CREATE TABLE audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  target       TEXT,
  detail_json  TEXT NOT NULL DEFAULT '{}',
  source_ip    TEXT
);

CREATE INDEX idx_audit_ts ON audit (ts);
CREATE INDEX idx_audit_actor ON audit (actor);
