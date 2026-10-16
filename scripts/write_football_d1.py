"""Generate a D1 current snapshot, publishing the customer payload last.

Also appends the four lottery games' evening draw updates (see
``_append_lottery_updates``) so daily-draw games land the same night
instead of waiting for the next morning's DLT run.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public/data/football/current.json"
JINGCAI_SOURCE = ROOT / "public/data/jingcai/current.json"
JINGCAI_ARCHIVE_SOURCE = ROOT / "public/data/jingcai/archive.json"
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


JINGCAI_SCHEMA = [
    "CREATE TABLE IF NOT EXISTS jingcai_current_snapshot("
    "slot INTEGER PRIMARY KEY, sale_date TEXT, public_payload TEXT, updated_at TEXT);",
]


JINGCAI_ARCHIVE_SCHEMA = [
    "CREATE TABLE IF NOT EXISTS jingcai_archive_days("
    "sale_date TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);",
]


def build_jingcai_archive_sql(archive: dict) -> str:
    """Archive day rows: published picks plus their settlement state."""
    lines = list(JINGCAI_ARCHIVE_SCHEMA)
    for sale_date in sorted(archive.get("days", {})):
        day = archive["days"][sale_date]
        lines.append(
            "INSERT INTO jingcai_archive_days(sale_date,payload,updated_at) "
            f"VALUES({sql_text(sale_date)},{sql_text(day)},datetime('now')) "
            "ON CONFLICT(sale_date) DO UPDATE SET payload=excluded.payload,"
            "updated_at=datetime('now');"
        )
    return "\n".join(lines) + "\n"


def build_jingcai_sql(payload: dict) -> str:
    """Jingcai lines appended after the football block (best-effort).

    The jingcai snapshot is a single current row, published last in
    its block; jingcai fixtures also feed the shared team archive
    under a JC<date> issue label.
    """
    lines = list(JINGCAI_SCHEMA)
    archive_view = {
        "issue": f"JC{payload['sale_date']}",
        "matches": payload["matches"],
    }
    lines.extend(build_team_sql(archive_view))
    lines.append(
        "INSERT INTO jingcai_current_snapshot(slot,sale_date,public_payload,updated_at) "
        f"VALUES(1,{sql_text(payload['sale_date'])},{sql_text(payload)},datetime('now')) "
        "ON CONFLICT(slot) DO UPDATE SET sale_date=excluded.sale_date,"
        "public_payload=excluded.public_payload,updated_at=datetime('now');"
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    import os

    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    sql = build_sql(data)
    if JINGCAI_SOURCE.exists():
        original = JINGCAI_SOURCE.read_bytes()
        try:
            payload = json.loads(original.decode("utf-8"))
            if payload.get("matches"):
                sql += build_jingcai_sql(payload)
                print(f"jingcai {payload['sale_date']}: D1 current snapshot SQL ready")
        except Exception as exc:  # jingcai must never break football D1
            print(f"jingcai_d1_skipped: {type(exc).__name__}: {str(exc)[:120]}")
        if os.environ.get("CI"):
            # The jingcai payload was consumed above; restore the
            # checked-out bytes so the workflow's bot-commit step
            # (git pull --rebase) does not trip over a dirty tree.
            # The committed copy is only the static fallback — D1,
            # written from the fresh payload, is the primary channel.
            try:
                committed = _committed_bytes(JINGCAI_SOURCE)
                if committed is not None and JINGCAI_SOURCE.read_bytes() != committed:
                    JINGCAI_SOURCE.write_bytes(committed)
            except Exception:
                pass
    if JINGCAI_ARCHIVE_SOURCE.exists():
        try:
            archive = json.loads(JINGCAI_ARCHIVE_SOURCE.read_text(encoding="utf-8"))
            if archive.get("days"):
                sql += build_jingcai_archive_sql(archive)
                print(f"jingcai archive: D1 rows for {len(archive['days'])} sale days")
        except Exception as exc:  # archive must never break football D1
            print(f"jingcai_archive_d1_skipped: {type(exc).__name__}: {str(exc)[:120]}")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(sql, encoding="utf-8")
    print(f"football issue {data['issue']}: D1 current snapshot SQL ready")
    _append_lottery_updates()


def _append_lottery_updates() -> None:
    """Append the four lottery games' D1 updates to the football SQL file.

    Draw ingestion for 双色球/福彩3D/排列三/排列五 normally rides the
    DLT workflow, which runs at 10:00 daily (plus 21:45 on DLT draw
    days) — so evening draws （排列 20:30 / 福彩3D 21:15 / 双色球
    21:15 on its days) stayed stale until the next morning and their
    reviews could not be computed. The football workflow runs every
    evening at 21:45, after those draws, inside a step that already
    holds the Cloudflare token and executes this very SQL file — so
    the same fault-isolated hooks run here too and the draws land the
    same night. The 10:00 DLT run remains as the backstop; every
    statement is INSERT OR IGNORE, so double execution is harmless.
    """
    import importlib
    import sys

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    hooks = [
        ("ssq", "scripts.update_ssq_d1", "append_ssq_updates"),
        ("fc3d", "scripts.update_fc3d_d1", "append_fc3d_updates"),
        ("pl3", "scripts.update_pl3_d1", "append_pl3_updates"),
        ("pl5", "scripts.update_pl5_d1", "append_pl5_updates"),
    ]
    for name, module_name, func_name in hooks:
        try:
            module = importlib.import_module(module_name)
            getattr(module, func_name)(str(OUTPUT))
            print(f"lottery hook {name}: appended evening updates")
        except Exception as exc:  # games must never break football D1
            print(f"lottery hook {name} failed: {type(exc).__name__}: {str(exc)[:160]}")


def _committed_bytes(path: Path) -> bytes | None:
    """Bytes of ``path`` as committed at HEAD, via git (CI checkout)."""
    import subprocess

    relative = path.relative_to(ROOT).as_posix()
    result = subprocess.run(
        ["git", "show", f"HEAD:{relative}"],
        cwd=ROOT,
        capture_output=True,
        timeout=30,
    )
    return result.stdout if result.returncode == 0 else None


if __name__ == "__main__":
    main()

