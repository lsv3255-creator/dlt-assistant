"""Generate a D1 current snapshot, publishing the customer payload last."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public/data/football/current.json"
OUTPUT = ROOT / ".verify_tmp/football_current_d1.sql"


def sql_text(value) -> str:
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return "'" + value.replace("'", "''") + "'"


TEAM_SCHEMA = [
    "CREATE TABLE IF NOT EXISTS football_teams("
    "team_key TEXT PRIMARY KEY, name TEXT NOT NULL, league TEXT, "
    "first_seen_issue TEXT, last_seen_issue TEXT);",
    "CREATE TABLE IF NOT EXISTS football_team_snapshots("
    "team_key TEXT NOT NULL, issue TEXT NOT NULL, league TEXT, "
    "rank INTEGER, form_json TEXT, rest_days INTEGER, last_match_date TEXT, "
    "PRIMARY KEY(team_key, issue));",
]


def build_team_sql(data: dict) -> list[str]:
    """Team archive lines: profiles upserted, one snapshot per team+issue.

    Unlike the current-issue tables, team snapshots are never deleted:
    team history accumulates across issues because forecasting uses it.
    """
    issue = str(data["issue"])
    lines = list(TEAM_SCHEMA)
    seen: set[str] = set()
    for row in data["matches"]:
        dynamics = row.get("dynamics") or {}
        for slot, rank_key in (("home", "home_rank"), ("away", "away_rank")):
            name = row[slot]
            if name in seen:
                continue
            seen.add(name)
            lines.append(
                "INSERT INTO football_teams(team_key,name,league,first_seen_issue,last_seen_issue) "
                f"VALUES({sql_text(name)},{sql_text(name)},{sql_text(row['league'])},{sql_text(issue)},{sql_text(issue)}) "
                "ON CONFLICT(team_key) DO UPDATE SET league=excluded.league,"
                "last_seen_issue=excluded.last_seen_issue;"
            )
            dyn = dynamics.get(slot) or {}
            if dyn.get("form_last10"):
                rank = row.get(rank_key)
                rank_sql = "NULL" if rank is None else str(int(rank))
                rest = dyn.get("rest_days")
                rest_sql = "NULL" if rest is None else str(int(rest))
                lines.append(
                    "INSERT OR REPLACE INTO football_team_snapshots"
                    "(team_key,issue,league,rank,form_json,rest_days,last_match_date) "
                    f"VALUES({sql_text(name)},{sql_text(issue)},{sql_text(row['league'])},{rank_sql},"
                    f"{sql_text(dyn['form_last10'])},{rest_sql},{sql_text(dyn.get('last_match_date'))});"
                )
    return lines


def build_sql(data: dict) -> str:
    if len(data.get("matches", [])) != 14:
        raise ValueError("football snapshot must contain exactly 14 matches")
    issue = str(data["issue"])
    lines = []
    # This table is intentionally current-only; old match rows are not retained.
    lines.append("DELETE FROM football_current_matches;")
    for row in data["matches"]:
        rank_home = "NULL" if row.get("home_rank") is None else str(int(row["home_rank"]))
        rank_away = "NULL" if row.get("away_rank") is None else str(int(row["away_rank"]))
        values = [
            sql_text(issue), str(int(row["order"])), sql_text(row["league"]), sql_text(row["home"]),
            sql_text(row["away"]), sql_text(row["kickoff"]), rank_home, rank_away,
            sql_text(row["odds"]), sql_text(row["probabilities"]), sql_text(row["factors"]),
            sql_text(row["primary"]), sql_text(row["secondary"]), sql_text(row["sfc_choices"]),
        ]
        lines.append(
            "INSERT INTO football_current_matches(issue,match_order,league,home,away,kickoff,home_rank,away_rank,"
            "odds_json,probabilities_json,factors_json,primary_choice,secondary_choice,sfc_choices_json) VALUES(" +
            ",".join(values) + ");"
        )
    # Team archive accumulates before the public snapshot is published.
    lines.extend(build_team_sql(data))
    lines.append(
        "INSERT INTO football_current_analysis(slot,issue,plans_json,ai_json,review_json,updated_at) "
        f"VALUES(1,{sql_text(issue)},{sql_text(data['plans'])},{sql_text(data['ai'])},{sql_text(data['review'])},datetime('now')) "
        "ON CONFLICT(slot) DO UPDATE SET issue=excluded.issue,plans_json=excluded.plans_json,"
        "ai_json=excluded.ai_json,review_json=excluded.review_json,updated_at=datetime('now');"
    )
    # Publish last: the API never exposes newly written detail rows before the
    # complete customer-safe payload is ready.
    lines.append(
        "INSERT INTO football_current_snapshot(slot,issue,sale_end,status,public_payload,updated_at) "
        f"VALUES(1,{sql_text(issue)},{sql_text(data['sale_end'])},{sql_text(data['status'])},{sql_text(data)},datetime('now')) "
        "ON CONFLICT(slot) DO UPDATE SET issue=excluded.issue,sale_end=excluded.sale_end,"
        "status=excluded.status,public_payload=excluded.public_payload,updated_at=datetime('now');"
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(build_sql(data), encoding="utf-8")
    print(f"football issue {data['issue']}: D1 current snapshot SQL ready")


if __name__ == "__main__":
    main()

