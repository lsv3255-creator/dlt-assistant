-- 足彩只保留当前期快照，不建设长期赛果/比分历史库。
CREATE TABLE IF NOT EXISTS football_current_snapshot (
  slot           INTEGER PRIMARY KEY CHECK(slot = 1),
  issue          TEXT NOT NULL,
  sale_end       TEXT NOT NULL,
  status         TEXT NOT NULL,
  public_payload TEXT NOT NULL,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS football_current_matches (
  issue              TEXT NOT NULL,
  match_order        INTEGER NOT NULL CHECK(match_order BETWEEN 1 AND 14),
  league             TEXT NOT NULL,
  home               TEXT NOT NULL,
  away               TEXT NOT NULL,
  kickoff            TEXT NOT NULL,
  home_rank          INTEGER,
  away_rank          INTEGER,
  odds_json          TEXT NOT NULL,
  probabilities_json TEXT NOT NULL,
  factors_json       TEXT NOT NULL,
  primary_choice     TEXT NOT NULL,
  secondary_choice   TEXT NOT NULL,
  sfc_choices_json   TEXT NOT NULL,
  PRIMARY KEY(issue, match_order)
);

CREATE TABLE IF NOT EXISTS football_current_analysis (
  slot       INTEGER PRIMARY KEY CHECK(slot = 1),
  issue      TEXT NOT NULL,
  plans_json TEXT NOT NULL,
  ai_json    TEXT NOT NULL,
  review_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
