"""Generate one transactional D1 snapshot for the current football issue only."""
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


def build_sql(data: dict) -> str:
    if len(data.get("matches", [])) != 14:
        raise ValueError("football snapshot must contain exactly 14 matches")
    issue = str(data["issue"])
    lines = ["BEGIN TRANSACTION;"]
    lines.append(
        "INSERT INTO football_current_snapshot(slot,issue,sale_end,status,public_payload,updated_at) "
        f"VALUES(1,{sql_text(issue)},{sql_text(data['sale_end'])},{sql_text(data['status'])},{sql_text(data)},datetime('now')) "
        "ON CONFLICT(slot) DO UPDATE SET issue=excluded.issue,sale_end=excluded.sale_end,"
        "status=excluded.status,public_payload=excluded.public_payload,updated_at=datetime('now');"
    )
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
    lines.append(
        "INSERT INTO football_current_analysis(slot,issue,plans_json,ai_json,review_json,updated_at) "
        f"VALUES(1,{sql_text(issue)},{sql_text(data['plans'])},{sql_text(data['ai'])},{sql_text(data['review'])},datetime('now')) "
        "ON CONFLICT(slot) DO UPDATE SET issue=excluded.issue,plans_json=excluded.plans_json,"
        "ai_json=excluded.ai_json,review_json=excluded.review_json,updated_at=datetime('now');"
    )
    lines.append("COMMIT;")
    return "\n".join(lines) + "\n"


def main() -> None:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(build_sql(data), encoding="utf-8")
    print(f"football issue {data['issue']}: D1 current snapshot SQL ready")


if __name__ == "__main__":
    main()
