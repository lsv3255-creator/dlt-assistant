"""阶段 14 Task 6.3：D1 每日增量写入脚本。

职责：
  - 查询 D1 当前最新期号（MAX(issue_num)）
  - 抓取该期之后的增量（复用 src.scraper._fetch_range）
  - 五重校验
  - 仅生成新增期的 INSERT OR IGNORE SQL（幂等，可重复执行）

用法：
  python scripts/update_dlt_d1.py                # 真实增量：查 D1 最新 → 抓取 → 生成 SQL
  python scripts/update_dlt_d1.py --simulate 3   # 模拟模式：生成最新期之后 N 期合法测试数据（26093 起）
生成后执行（必须 --remote）：
  wrangler d1 execute dlt-draws --remote --file=.verify_tmp/update_d1.sql
"""
import datetime
import json
import os
import random
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import yaml  # noqa: E402
from src.scraper import _fetch_range, _year_end_issue  # noqa: E402

OUT = ".verify_tmp/update_d1.sql"
ISSUE_RE = re.compile(r"^\d{5}$")


def d1_latest() -> int:
    """查询 D1 MAX(issue_num)，返回最新期号数值（无数据返回 0）。"""
    # Windows 下 npx 为 .cmd 脚本，需 shell=True
    cmd = ('npx --yes wrangler@latest d1 execute dlt-draws --remote '
           '--command "SELECT MAX(issue_num) AS m FROM dlt_draws;"')
    out = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=120).stdout
    m = re.search(r'"m":\s*(\d+)', out)
    return int(m.group(1)) if m else 0


def validate(issues: list[dict]) -> list:
    """五重校验，返回异常列表。"""
    seen: set = set()
    bad: list = []
    for it in issues:
        errs: list = []
        if not ISSUE_RE.fullmatch(str(it["issue"])):
            errs.append("期号格式")
        try:
            datetime.date.fromisoformat(it["date"])
        except (ValueError, TypeError):
            errs.append("日期非法")
        f, b = it["front"], it["back"]
        if len(f) != 5 or not all(1 <= x <= 35 for x in f):
            errs.append("前区范围")
        if len(b) != 2 or not all(1 <= x <= 12 for x in b):
            errs.append("后区范围")
        if len(set(f)) != 5 or len(set(b)) != 2:
            errs.append("号码重复")
        if it["issue"] in seen:
            errs.append("期号重复")
        seen.add(it["issue"])
        if errs:
            bad.append((it["issue"], errs))
    return bad


def gen_sql(issues: list[dict], path: str) -> None:
    lines = [f"-- 每日增量 D1 更新（{issues[0]['issue']} ~ {issues[-1]['issue']}，{len(issues)} 期）"]
    for it in issues:
        f, b = it["front"], it["back"]
        lines.append(
            "INSERT OR IGNORE INTO dlt_draws "
            "(issue, issue_num, date, front1, front2, front3, front4, front5, "
            "back1, back2, source, verified) "
            f"VALUES ('{it['issue']}', {int(it['issue'])}, '{it['date']}', "
            f"{f[0]}, {f[1]}, {f[2]}, {f[3]}, {f[4]}, {b[0]}, {b[1]}, '500', 1);"
        )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def simulate(n: int) -> list[dict]:
    """模拟模式：生成 latest+1..latest+n 的合法测试数据（固定种子可复现）。"""
    latest = d1_latest()
    rng = random.Random(20260816)
    out = []
    d = datetime.date(2026, 8, 16)
    for i in range(1, n + 1):
        num = latest + i
        issue = f"{num // 1000:02d}{num % 1000:03d}"
        d += datetime.timedelta(days=3)  # 模拟开奖节奏
        front = sorted(rng.sample(range(1, 36), 5))
        back = sorted(rng.sample(range(1, 13), 2))
        out.append({"issue": issue, "date": d.isoformat(), "front": front, "back": back})
    return out


def main() -> int:
    args = sys.argv[1:]
    simulate_n = 0
    if "--simulate" in args:
        simulate_n = int(args[args.index("--simulate") + 1])

    if simulate_n:
        issues = simulate(simulate_n)
        src_desc = f"模拟 {simulate_n} 期（自 D1 最新期号后生成）"
    else:
        cfg = yaml.safe_load(open("config/settings.yaml", encoding="utf-8"))
        sc = cfg["scrape"]
        latest = d1_latest()
        if latest == 0:
            raise SystemExit("D1 为空，请先执行全历史导入")
        start = str(latest)
        end = _year_end_issue(latest)
        print(f"D1 最新期号：{latest}，抓取 {start} ~ {end} ...")
        issues = _fetch_range(sc["base_url"], start, end, sc["timeout"], sc["user_agent"])
        issues = [it for it in issues if int(it["issue"]) > latest]
        src_desc = f"真实增量（D1 最新 {latest} 之后，抓到 {len(issues)} 期）"

    if not issues:
        print("无新增期，跳过（幂等）")
        return 0

    bad = validate(issues)
    if bad:
        for iss, errs in bad[:10]:
            print(f"校验失败 {iss}: {errs}")
        return 1

    gen_sql(issues, OUT)
    print(f"[{src_desc}] 校验通过 {len(issues)} 期 -> {OUT}")
    print("执行：")
    print(f"  wrangler d1 execute dlt-draws --remote --file={OUT}")
    return 0


if __name__ == "__main__":
    _rc = main()
    # 双色球同步（Phase 15）：追加到同一份 update_d1.sql，全程尽力而为。
    try:
        from scripts.update_ssq_d1 import append_ssq_updates

        append_ssq_updates(OUT)
    except Exception as _exc:  # never break the DLT pipeline
        print(f"ssq hook failed: {type(_exc).__name__}: {str(_exc)[:160]}")
    # 福彩3D同步（Phase 16）：同上。
    try:
        from scripts.update_fc3d_d1 import append_fc3d_updates

        append_fc3d_updates(OUT)
    except Exception as _exc:  # never break the DLT pipeline
        print(f"fc3d hook failed: {type(_exc).__name__}: {str(_exc)[:160]}")
    # 排列三同步（Phase 17）：同上。
    try:
        from scripts.update_pl3_d1 import append_pl3_updates

        append_pl3_updates(OUT)
    except Exception as _exc:  # never break the DLT pipeline
        print(f"pl3 hook failed: {type(_exc).__name__}: {str(_exc)[:160]}")
    # 排列五同步（Phase 18）：同上；排列家族的权威开奖库。
    try:
        from scripts.update_pl5_d1 import append_pl5_updates

        append_pl5_updates(OUT)
    except Exception as _exc:  # never break the DLT pipeline
        print(f"pl5 hook failed: {type(_exc).__name__}: {str(_exc)[:160]}")
    sys.exit(_rc)
