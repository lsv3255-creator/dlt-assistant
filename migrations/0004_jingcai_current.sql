-- Jingcai （竞彩足球） current snapshot (Phase 14).
--
-- One current row holds the customer-safe payload for the fixtures on
-- sale right now (daily slate: 胜平负 + 让球胜平负 recommendations and
-- suggested parlays). The snapshot is replaced on every cycle; team
-- history from jingcai fixtures accumulates in the shared football
-- team archive (football_teams / football_team_snapshots) under a
-- JC<sale_date> issue label, never in this table.
--
-- Note: the Pages workflow executes migrations/0002 plus the generated
-- snapshot SQL; the generated SQL carries the same CREATE TABLE IF NOT
-- EXISTS statement, so this table also appears on deployments where
-- this file has not been run manually.

CREATE TABLE IF NOT EXISTS jingcai_current_snapshot (
    slot INTEGER PRIMARY KEY,
    sale_date TEXT,
    public_payload TEXT,
    updated_at TEXT
);
