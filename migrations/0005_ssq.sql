-- =========================================================
-- 双色球历史数据 · D1 初始化（Phase 15，仿大乐透 0001 模式）
-- 0005_ssq.sql
-- 说明：仅建表结构；全量历史由 scripts/update_ssq_d1.py 在每日
-- 大乐透工作流的 D1 增量步骤中生成 INSERT OR IGNORE 并写入。
-- ⚠️ 执行必须带 --remote（wrangler v4 默认 local）：
--   wrangler d1 execute dlt-draws --remote --file=migrations/0005_ssq.sql
-- =========================================================

-- ① ssq_draws：双色球全历史开奖（2003 年至今，权威库）
CREATE TABLE IF NOT EXISTS ssq_draws (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue      TEXT    NOT NULL UNIQUE,            -- 5 位期号 YYNNN
  issue_num  INTEGER NOT NULL UNIQUE,            -- 数字排序字段
  date       TEXT    NOT NULL,                   -- 开奖日期 YYYY-MM-DD
  red1       INTEGER NOT NULL CHECK(red1 BETWEEN 1 AND 33),
  red2       INTEGER NOT NULL CHECK(red2 BETWEEN 1 AND 33),
  red3       INTEGER NOT NULL CHECK(red3 BETWEEN 1 AND 33),
  red4       INTEGER NOT NULL CHECK(red4 BETWEEN 1 AND 33),
  red5       INTEGER NOT NULL CHECK(red5 BETWEEN 1 AND 33),
  red6       INTEGER NOT NULL CHECK(red6 BETWEEN 1 AND 33),
  blue       INTEGER NOT NULL CHECK(blue BETWEEN 1 AND 16),
  source     TEXT    NOT NULL DEFAULT '500',
  verified   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ② ssq_recommendations：本期推荐（首写锁定，仿 dlt_recommendations）
CREATE TABLE IF NOT EXISTS ssq_recommendations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_issue TEXT    NOT NULL,                 -- 目标期号
  target_date  TEXT    NOT NULL,                 -- 目标开奖日期
  strategy     TEXT    NOT NULL,                 -- A-均衡统计型 / B-冷热组合型 / C-纯随机娱乐型
  red          TEXT    NOT NULL,                 -- JSON [6]
  blue         INTEGER NOT NULL,
  date         TEXT    NOT NULL,                 -- 生成日期
  UNIQUE(target_issue, strategy)
);
