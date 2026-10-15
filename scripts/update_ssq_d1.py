"""双色球 D1 同步（Phase 15，仿大乐透 update_dlt_d1 模式）。

由 scripts/update_dlt_d1.py 在其主流程结束后调用（大乐透工作流的
「同步 D1 历史数据库」步骤会执行 .verify_tmp/update_d1.sql，本脚本把
双色球语句追加到同一文件）：

- 查询 D1 ssq_draws 最新期号；表不存在 → 全量回填（2003 年至今）。
- 增量抓取 500彩票网双色球历史页，五重校验后生成 INSERT OR IGNORE。
- 维护仓库副本 data/ssq_history.json 与 public/data/ssq_history.json
  （最新 1000 期，仿 dlt_history.json）。
- 为下一期生成三组娱乐推荐（统计策略，确定性），INSERT OR IGNORE
  首写锁定，仿 dlt_recommendations。

本脚本全程尽力而为：任何异常只打印，不抛给大乐透主流程。
"""
from __future__ import annotations

import datetime
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.ssq import scraper, stats  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, "data", "ssq_history.json")
PUBLIC_JSON = os.path.join(ROOT, "public", "data", "ssq_history.json")
BJ = datetime.timezone(datetime.timedelta(hours=8))

SCHEMA = [
    "CREATE TABLE IF NOT EXISTS ssq_draws ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT, issue TEXT NOT NULL UNIQUE, "
    "issue_num INTEGER NOT NULL UNIQUE, date TEXT NOT NULL, "
    "red1 INTEGER NOT NULL, red2 INTEGER NOT NULL, red3 INTEGER NOT NULL, "
    "red4 INTEGER NOT NULL, red5 INTEGER NOT NULL, red6 INTEGER NOT NULL, "
    "blue INTEGER NOT NULL, source TEXT NOT NULL DEFAULT '500', "
    "verified INTEGER NOT NULL DEFAULT 1, "
    "created_at TEXT NOT NULL DEFAULT (datetime('now')), "
    "updated_at TEXT NOT NULL DEFAULT (datetime('now')));",
    "CREATE TABLE IF NOT EXISTS ssq_recommendations ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT, target_issue TEXT NOT NULL, "
    "target_date TEXT NOT NULL, strategy TEXT NOT NULL, red TEXT NOT NULL, "
    "blue INTEGER NOT NULL, date TEXT NOT NULL, "
    "UNIQUE(target_issue, strategy));",
]


def _sql_text(value) -> str:
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return "'" + value.replace("'", "''") + "'"


def ssq_d1_latest() -> int | None:
    """MAX(issue_num) in D1; None when the table does not exist yet."""
    cmd = (
        "npx --yes wrangler@latest d1 execute dlt-draws --remote "
        '--command "SELECT MAX(issue_num) AS m FROM ssq_draws;"'
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
        "source": "500彩票网双色球历史数据（与官方开奖同步）",
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
        red = it["red"]
        lines.append(
            "INSERT OR IGNORE INTO ssq_draws "
            "(issue, issue_num, date, red1, red2, red3, red4, red5, red6, "
            "blue, source, verified) VALUES ("
            f"{_sql_text(it['issue'])}, {int(it['issue'])}, {_sql_text(it['date'])}, "
            f"{red[0]}, {red[1]}, {red[2]}, {red[3]}, {red[4]}, {red[5]}, "
            f"{int(it['blue'])}, '500', 1);"
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
            "INSERT OR IGNORE INTO ssq_recommendations "
            "(target_issue, target_date, strategy, red, blue, date) VALUES ("
            f"{_sql_text(target['issue'])}, {_sql_text(target['date'])}, "
            f"{_sql_text(pick['strategy'])}, {_sql_text(pick['red'])}, "
            f"{int(pick['blue'])}, {_sql_text(today)});"
        )
    return lines


def append_ssq_updates(out_path: str) -> None:
    """Append ssq D1 statements to ``out_path`` (created if needed)."""
    try:
        latest = ssq_d1_latest()
        if latest is None or latest == 0:
            rows = scraper.fetch_all_history()
            mode = "全量回填"
        else:
            fetched = scraper.fetch_range(
                str(latest), scraper.year_end_issue(latest)
            )
            rows = [r for r in fetched if int(r["issue"]) > latest]
            mode = "增量"
        if rows:
            bad = scraper.validate(rows)
            if bad:
                print(f"ssq: 校验失败 {bad[:5]}，本轮不写入")
                return
            rows.sort(key=lambda r: int(r["issue"]))
        merged = {r["issue"]: r for r in _load_repo_history()}
        for row in rows:
            merged[row["issue"]] = row
        history = [merged[key] for key in sorted(merged, key=int)][-1000:]
        if rows or not os.path.exists(DATA_JSON):
            _write_repo_history(history)
        lines = list(SCHEMA)
        lines.extend(_draw_sql(rows))
        if len(history) >= 100:
            lines.extend(_recommendation_sql(history))
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as fh:
            fh.write(f"-- 双色球{mode}（新增 {len(rows)} 期）\n")
            fh.write("\n".join(lines) + "\n")
        print(
            f"ssq: {mode}完成，新增 {len(rows)} 期 -> {out_path}；"
            f"仓库历史 {len(history)} 期，最新 {history[-1]['issue'] if history else '无'}"
        )
    except Exception as exc:  # never break the DLT pipeline
        print(f"ssq_d1_skipped: {type(exc).__name__}: {str(exc)[:160]}")
