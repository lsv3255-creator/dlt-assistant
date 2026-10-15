-- =========================================================
-- 排列三历史数据 · D1 初始化（Phase 17，仿大乐透/双色球模式）
-- 0006_pl3.sql
-- 说明：仅建表结构；全量历史由 scripts/update_pl3_d1.py 在每日
-- 大乐透工作流的 D1 增量步骤中生成 INSERT OR IGNORE 并写入。
-- ⚠️ 执行必须带 --remote（wrangler v4 默认 local）：
--   wrangler d1 execute dlt-draws --remote --file=migrations/0006_pl3.sql
-- =========================================================

-- ① pl3_draws：排列三全历史开奖（2004 年至今，权威库）
CREATE TABLE IF NOT EXISTS pl3_draws (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue      TEXT    NOT NULL UNIQUE,            -- 7 位期号 YYYYNNN
  issue_num  INTEGER NOT NULL UNIQUE,            -- 数字排序字段
  date       TEXT    NOT NULL,                   -- 开奖日期 YYYY-MM-DD
  d1         INTEGER NOT NULL CHECK(d1 BETWEEN 0 AND 9),   -- 百位
  d2         INTEGER NOT NULL CHECK(d2 BETWEEN 0 AND 9),   -- 十位
  d3         INTEGER NOT NULL CHECK(d3 BETWEEN 0 AND 9),   -- 个位
  source     TEXT    NOT NULL DEFAULT '500xml',
  verified   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ② pl3_recommendations：本期推荐（首写锁定）
CREATE TABLE IF NOT EXISTS pl3_recommendations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_issue TEXT    NOT NULL,                 -- 目标期号
  target_date  TEXT    NOT NULL,                 -- 目标开奖日期
  strategy     TEXT    NOT NULL,                 -- A-均衡统计型 / B-冷热组合型 / C-纯随机娱乐型
  digits       TEXT    NOT NULL,                 -- JSON [百,十,个]
  date         TEXT    NOT NULL,                 -- 生成日期
  UNIQUE(target_issue, strategy)
);
