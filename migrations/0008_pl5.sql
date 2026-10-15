-- =========================================================
-- 排列五历史数据 · D1 初始化（Phase 18，排列家族共用开奖库）
-- 0008_pl5.sql
-- 排列五是排列家族的权威开奖：排列三 = 其前三位（04021 期起
-- 同一次开奖，实测 7727 期完全一致）；排列三 2004 年最初 20 期
-- 与仅其独有的 04006/04007 保留在 pl3_draws 中（方案 B）。
-- 全量历史由 scripts/update_pl5_d1.py 在每日大乐透工作流的
-- D1 增量步骤中生成 INSERT OR IGNORE 并写入。
-- ⚠️ 执行必须带 --remote：
--   wrangler d1 execute dlt-draws --remote --file=migrations/0008_pl5.sql
-- =========================================================

-- ① pl5_draws：排列五全历史开奖（2004 年至今，权威库）
CREATE TABLE IF NOT EXISTS pl5_draws (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue      TEXT    NOT NULL UNIQUE,            -- 5 位期号 YYNNN
  issue_num  INTEGER NOT NULL UNIQUE,            -- 数字排序字段
  date       TEXT    NOT NULL,                   -- 开奖日期 YYYY-MM-DD
  d1         INTEGER NOT NULL CHECK(d1 BETWEEN 0 AND 9),   -- 万位
  d2         INTEGER NOT NULL CHECK(d2 BETWEEN 0 AND 9),   -- 千位
  d3         INTEGER NOT NULL CHECK(d3 BETWEEN 0 AND 9),   -- 百位
  d4         INTEGER NOT NULL CHECK(d4 BETWEEN 0 AND 9),   -- 十位
  d5         INTEGER NOT NULL CHECK(d5 BETWEEN 0 AND 9),   -- 个位
  source     TEXT    NOT NULL DEFAULT '500xml',
  verified   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ② pl5_recommendations：本期推荐（首写锁定）
CREATE TABLE IF NOT EXISTS pl5_recommendations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_issue TEXT    NOT NULL,
  target_date  TEXT    NOT NULL,
  strategy     TEXT    NOT NULL,
  digits       TEXT    NOT NULL,                 -- JSON [万,千,百,十,个]
  date         TEXT    NOT NULL,
  UNIQUE(target_issue, strategy)
);
