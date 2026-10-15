-- Football team archive (Phase 13 Task #48, step 2).
--
-- Scope decision (user, 2026-10-15): football *draw/result* history is
-- NOT archived long-term, but team profiles and team history ARE,
-- because match forecasting depends on them. One snapshot per team per
-- issue accumulates recent form (all competitions), rest days and the
-- team's last match date at analysis time. Snapshots are never deleted
-- by the current-issue writers.
--
-- Note: the Pages workflow executes migrations/0002 plus the generated
-- snapshot SQL; the generated SQL carries the same CREATE TABLE IF NOT
-- EXISTS statements, so these tables also appear on deployments where
-- this file has not been run manually.

CREATE TABLE IF NOT EXISTS football_teams (
    team_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    league TEXT,
    first_seen_issue TEXT,
    last_seen_issue TEXT
);

CREATE TABLE IF NOT EXISTS football_team_snapshots (
    team_key TEXT NOT NULL,
    issue TEXT NOT NULL,
    league TEXT,
    rank INTEGER,
    form_json TEXT,
    rest_days INTEGER,
    last_match_date TEXT,
    PRIMARY KEY (team_key, issue)
);
