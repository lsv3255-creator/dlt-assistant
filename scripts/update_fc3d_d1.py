"""福彩3D D1 同步（Phase 16，仿双色球 update_ssq_d1 模式）。

由 scripts/update_dlt_d1.py 在其主流程结束后调用，语句追加到同一份
.verify_tmp/update_d1.sql，由大乐透工作流的 D1 步骤统一执行：

- 查询 D1 fc3d_draws 最新期号；表不存在 → 全量回填（2004 年至今）。
- 数据源为 500彩票网 kaijiang 静态 XML 全量 feed（单请求），按期号差分增量。
- 维护 data/fc3d_history.json 与 public/data/fc3d_history.json（最新 1000 期）。
- 为下一期生成三组娱乐推荐并 INSERT OR IGNORE 首写锁定。

全程尽力而为：异常只打印，不抛给大乐透主流程。
"""
from __future__ import annotations

import datetime
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.fc3d import analysis, scraper, stats  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, "data", "fc3d_history.json")
PUBLIC_JSON = os.path.join(ROOT, "public", "data", "fc3d_history.json")
BJ = datetime.timezone(datetime.timedelta(hours=8))

SCHEMA = [
    "CREATE TABLE IF NOT EXISTS fc3d_draws ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT, issue TEXT NOT NULL UNIQUE, "
    "issue_num INTEGER NOT NULL UNIQUE, date TEXT NOT NULL, "
    "d1 INTEGER NOT NULL, d2 INTEGER NOT NULL, d3 INTEGER NOT NULL, "
    "source TEXT NOT NULL DEFAULT '500xml', verified INTEGER NOT NULL DEFAULT 1, "
    "created_at TEXT NOT NULL DEFAULT (datetime('now')), "
    "updated_at TEXT NOT NULL DEFAULT (datetime('now')));",
    "CREATE TABLE IF NOT EXISTS fc3d_recommendations ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT, target_issue TEXT NOT NULL, "
    "target_date TEXT NOT NULL, strategy TEXT NOT NULL, digits TEXT NOT NULL, "
    "date TEXT NOT NULL, UNIQUE(target_issue, strategy));",
    # 开奖详情（试机号，来自同一 feed）
    "CREATE TABLE IF NOT EXISTS fc3d_details ("
    "issue TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS fc3d_plans ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT, target_issue TEXT NOT NULL, "
    "target_date TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, "
    "date TEXT NOT NULL, UNIQUE(target_issue, kind));",
    "CREATE TABLE IF NOT EXISTS fc3d_analysis ("
    "target_issue TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, "
    "date TEXT NOT NULL);",
]


def _sql_text(value) -> str:
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return "'" + value.replace("'", "''") + "'"


def fc3d_d1_latest() -> int | None:
    """MAX(issue_num) in D1; None when the table does not exist yet."""
    cmd = (
        "npx --yes wrangler@latest d1 execute dlt-draws --remote "
        '--command "SELECT MAX(issue_num) AS m FROM fc3d_draws;"'
    )
    try:
        proc = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=120
        )
    except Exception:
        return 0
    blob = (proc.stdout or "") + (proc.stderr or "")
    if "no such table" in blob:
        return None
    match = re.search(r'"m":\s*(\d+)', proc.stdout or "")
    return int(match.group(1)) if match else 0


def _load_repo_history() -> list[dict]:
    try:
        with open(DATA_JSON, encoding="utf-8") as fh:
            return json.load(fh).get("issues", [])
    except Exception:
        return []


def _write_repo_history(rows: list[dict]) -> None:
    payload = {
        "updated_at": datetime.datetime.now(BJ).isoformat(),
        "source": "500彩票网福彩3D历史开奖（与官方开奖同步）",
        "count": len(rows),
        "issues": rows,
    }
    for path in (DATA_JSON, PUBLIC_JSON):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
            fh.write("\n")


def _draw_sql(rows: list[dict]) -> list[str]:
    lines = []
    for it in rows:
        d = it["digits"]
        lines.append(
            "INSERT OR IGNORE INTO fc3d_draws "
            "(issue, issue_num, date, d1, d2, d3, source, verified) VALUES ("
            f"{_sql_text(it['issue'])}, {int(it['issue'])}, {_sql_text(it['date'])}, "
            f"{d[0]}, {d[1]}, {d[2]}, '500xml', 1);"
        )
    return lines


def _details_sql(rows: list[dict]) -> list[str]:
    lines = []
    for it in rows:
        if "trycode" not in it:
            continue
        payload = {"trycode": it["trycode"]}
        lines.append(
            "INSERT OR IGNORE INTO fc3d_details (issue, payload) VALUES ("
            f"{_sql_text(it['issue'])}, {_sql_text(payload)});"
        )
    return lines


def _plans_analysis_sql(history: list[dict]) -> list[str]:
    latest = history[-1]
    target = stats.next_target(latest)
    picks = stats.generate_picks(target["issue"], history)
    today = datetime.datetime.now(BJ).date().isoformat()
    lines = []
    for plan in stats.generate_plans(target["issue"], history, picks):
        lines.append(
            "INSERT OR IGNORE INTO fc3d_plans "
            "(target_issue, target_date, kind, payload, date) VALUES ("
            f"{_sql_text(target['issue'])}, {_sql_text(target['date'])}, "
            f"{_sql_text(plan['kind'])}, {_sql_text(plan['payload'])}, "
            f"{_sql_text(today)});"
        )
    report = analysis.build_analysis(history, picks, target)
    lines.append(
        "INSERT OR IGNORE INTO fc3d_analysis (target_issue, payload, date) VALUES ("
        f"{_sql_text(target['issue'])}, {_sql_text(report)}, {_sql_text(today)});"
    )
    return lines


def _recommendation_sql(history: list[dict]) -> list[str]:
    latest = history[-1]
    target = stats.next_target(latest)
    picks = stats.generate_picks(target["issue"], history)
    today = datetime.datetime.now(BJ).date().isoformat()
    lines = []
    for pick in picks:
        lines.append(
            "INSERT OR IGNORE INTO fc3d_recommendations "
            "(target_issue, target_date, strategy, digits, date) VALUES ("
            f"{_sql_text(target['issue'])}, {_sql_text(target['date'])}, "
            f"{_sql_text(pick['strategy'])}, {_sql_text(pick['digits'])}, "
            f"{_sql_text(today)});"
        )
    return lines


def append_fc3d_updates(out_path: str) -> None:
    """Append fc3d D1 statements to ``out_path`` (created if needed)."""
    try:
        latest = fc3d_d1_latest()
        feed = scraper.fetch_history()
        if latest is None or latest == 0:
            rows = feed
            mode = "全量回填"
        else:
            rows = [r for r in feed if int(r["issue"]) > latest]
            mode = "增量"
        if rows:
            bad = scraper.validate(rows)
            if bad:
                print(f"fc3d: 校验失败 {bad[:5]}，本轮不写入")
                return
        merged = {r["issue"]: r for r in _load_repo_history()}
        for row in rows:
            merged[row["issue"]] = row
        history = [merged[key] for key in sorted(merged, key=int)][-1000:]
        if rows or not os.path.exists(DATA_JSON):
            _write_repo_history(history)
        lines = list(SCHEMA)
        lines.extend(_draw_sql(rows))
        lines.extend(_details_sql(rows))
        # One-time trycode backfill for the existing history (the feed
        # is fetched whole every run, so this costs nothing extra).
        try:
            probe = subprocess.run(
                "npx --yes wrangler@latest d1 execute dlt-draws --remote "
                '--command "SELECT MAX(issue) AS m FROM fc3d_details;"',
                shell=True, capture_output=True, text=True, timeout=120,
            )
            blob = (probe.stdout or "") + (probe.stderr or "")
            if "no such table" in blob or not re.search(r'"m":\s*\d', probe.stdout or ""):
                lines.extend(_details_sql(feed))
                print("fc3d: 试机号一次性回填全史")
        except Exception:
            pass
        if len(history) >= 100:
            lines.extend(_recommendation_sql(history))
            lines.extend(_plans_analysis_sql(history))
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as fh:
            fh.write(f"-- 福彩3D{mode}（新增 {len(rows)} 期）\n")
            fh.write("\n".join(lines) + "\n")
        print(
            f"fc3d: {mode}完成，新增 {len(rows)} 期 -> {out_path}；"
            f"仓库历史 {len(history)} 期，最新 {history[-1]['issue'] if history else '无'}"
        )
    except Exception as exc:  # never break the DLT pipeline
        print(f"fc3d_d1_skipped: {type(exc).__name__}: {str(exc)[:160]}")
