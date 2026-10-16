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

from src.ssq import analysis, scraper, stats  # noqa: E402

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
    # 详细开奖公告（奖池/一二等奖注数奖金/销售额，随开奖行一并抓取）
    "CREATE TABLE IF NOT EXISTS ssq_details ("
    "issue TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);",
    # 本期方案：single=唯一推荐 / combo=组合推荐（首写锁定）
    "CREATE TABLE IF NOT EXISTS ssq_plans ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT, target_issue TEXT NOT NULL, "
    "target_date TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, "
    "date TEXT NOT NULL, UNIQUE(target_issue, kind));",
    # 综合分析（统计引擎生成的结构化解读，首写锁定）
    "CREATE TABLE IF NOT EXISTS ssq_analysis ("
    "target_issue TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, "
    "date TEXT NOT NULL);",
]


def _sql_text(value) -> str:
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return "'" + value.replace("'", "''") + "'"


def _d1_max_issue(table: str, column: str) -> int | None:
    """MAX(column) in a D1 table; None when the table does not exist."""
    cmd = (
        "npx --yes wrangler@latest d1 execute dlt-draws --remote "
        f'--command "SELECT MAX({column}) AS m FROM {table};"'
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


def ssq_d1_latest() -> int | None:
    return _d1_max_issue("ssq_draws", "issue_num")


def _details_sql(rows: list[dict]) -> list[str]:
    lines = []
    for it in rows:
        if "detail" not in it:
            continue
        lines.append(
            "INSERT OR IGNORE INTO ssq_details (issue, payload) VALUES ("
            f"{_sql_text(it['issue'])}, {_sql_text(it['detail'])});"
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
            "INSERT OR IGNORE INTO ssq_plans "
            "(target_issue, target_date, kind, payload, date) VALUES ("
            f"{_sql_text(target['issue'])}, {_sql_text(target['date'])}, "
            f"{_sql_text(plan['kind'])}, {_sql_text(plan['payload'])}, "
            f"{_sql_text(today)});"
        )
    report = analysis.build_analysis(history, picks, target)
    lines.append(
        "INSERT OR IGNORE INTO ssq_analysis (target_issue, payload, date) VALUES ("
        f"{_sql_text(target['issue'])}, {_sql_text(report)}, {_sql_text(today)});"
    )
    return lines


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


def _append_lines(out_path: str, header: str, lines: list) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "a", encoding="utf-8") as fh:
        fh.write(header + "\n")
        fh.write("\n".join(lines) + "\n")


def append_ssq_updates(out_path: str) -> None:
    """Append ssq D1 statements to ``out_path`` (created if needed).

    Phase B 先行：抓取增量并维护仓库历史；若仓库历史缺失/过短（例如文件
    被误写为空），用官网全量历史自愈回填并强制写回仓库文件。
    Phase A 在后：用当前可得的最完整历史生成推荐/方案/综合分析并独立
    落盘——Phase B 失败时退回仓库历史，互不拖累。
    """
    history = _load_repo_history()

    # ---- Phase B: draw increments + announcement details (network) ----
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
        bad = scraper.validate(rows) if rows else []
        if bad:
            print(f"ssq: 校验失败 {bad[:5]}，本轮不写入开奖增量")
            rows = []
        rows.sort(key=lambda r: int(r["issue"]))
        merged = {r["issue"]: r for r in history}
        for row in rows:
            merged[row["issue"]] = row
        healed = False
        if len(merged) < 100:
            # 仓库历史缺失/过短：官网全量自愈（否则统计与推荐无从生成）。
            full = scraper.fetch_all_history()
            base = {r["issue"]: r for r in full}
            base.update(merged)
            merged = base
            healed = True
            print(
                "::warning title=ssq深度诊断::"
                f"repo_history_healed rows={len(merged)}"
            )
        history = [merged[key] for key in sorted(merged, key=int)][-1000:]
        if rows or healed or not os.path.exists(DATA_JSON):
            _write_repo_history(history)
        if not bad:
            lines = list(SCHEMA)
            lines.extend(_draw_sql(rows))
            lines.extend(_details_sql(rows))
            # One-time announcement backfill: draws exist but details empty.
            details_latest = _d1_max_issue("ssq_details", "issue")
            if (details_latest is None or details_latest == 0) and latest:
                full = scraper.fetch_all_history()
                lines.extend(_details_sql(full))
                print(f"ssq: 详细公告一次性回填 {len(full)} 期")
            _append_lines(out_path, f"-- 双色球{mode}（新增 {len(rows)} 期）", lines)
        print(
            f"ssq: {mode}完成，新增 {len(rows)} 期；"
            f"仓库历史 {len(history)} 期，最新 {history[-1]['issue'] if history else '无'}"
        )
    except Exception as exc:  # never break the DLT pipeline
        print(
            "::warning title=ssq深度诊断::"
            f"phaseB_failed {type(exc).__name__}: {str(exc)[:120]}"
        )
        print(f"ssq_d1_skipped: {type(exc).__name__}: {str(exc)[:160]}")

    # ---- Phase A: recommendations/plans/analysis (best available history) ----
    try:
        if len(history) >= 100:
            plan_lines = _plans_analysis_sql(history)
            plan_bytes = sum(len(x.encode("utf-8")) for x in plan_lines)
            print(
                "::warning title=ssq深度诊断::"
                f"phaseA plans_statements={len(plan_lines)} plans_bytes={plan_bytes}"
            )
            lines = list(SCHEMA)
            lines.extend(_recommendation_sql(history))
            lines.extend(plan_lines)
            _append_lines(out_path, "-- 双色球方案/分析（无网络依赖）", lines)
        else:
            print(
                "::warning title=ssq深度诊断::"
                f"phaseA_skipped history_short rows={len(history)}"
            )
    except Exception as exc:  # never break the DLT pipeline
        print(
            "::warning title=ssq深度诊断::"
            f"phaseA_failed {type(exc).__name__}: {str(exc)[:120]}"
        )
        print(f"ssq phaseA skipped: {type(exc).__name__}: {str(exc)[:160]}")
