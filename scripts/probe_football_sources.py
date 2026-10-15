"""Probe candidate football-lottery data sources from the Actions runner.

Writes reports/football_source_probe.json with per-URL status so the
auto-discovery data source can be chosen on evidence, not guesses.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

CANDIDATES = [
    ("sporttery_list_mobile", "https://m.sporttery.cn/mctzc/zcgg/"),
    ("sporttery_announcement_26143", "https://m.sporttery.cn/mctzc/zcgg/20261013/10055964.html"),
    ("sporttery_webapi_sale_status", "https://webapi.sporttery.cn/gateway/jc/common/getLotterySaleStatus.qry?lotteryCode=SFC"),
    ("okooo_zucai_26143", "https://www.okooo.com/zucai/26143/"),
    ("okooo_zucai_home", "https://www.okooo.com/zucai/"),
    ("500_zc", "https://zx.500.com/zc/"),
    ("500_sfc_trade", "https://trade.500.com/sfc/"),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept": "text/html,application/json,*/*",
}


def probe(name: str, url: str) -> dict:
    row = {"name": name, "url": url}
    try:
        resp = requests.get(url, headers=HEADERS, timeout=25, allow_redirects=True)
        body = resp.content
        text = ""
        for enc in ("utf-8", "gbk"):
            try:
                text = body.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        row.update({
            "status": resp.status_code,
            "final_url": resp.url,
            "bytes": len(body),
            "contains_26143": "26143" in text,
            "contains_sfc": "胜负彩" in text,
            "issue_like": sorted(set(re.findall(r"\b2[56]\d{3}\b", text)))[:10],
        })
    except Exception as exc:  # probe must record, never crash the batch
        row.update({"status": None, "error": type(exc).__name__ + ": " + str(exc)[:200]})
    return row


def main() -> None:
    results = [probe(name, url) for name, url in CANDIDATES]
    try:
        ip = requests.get("https://api.ipify.org", timeout=10).text.strip()
    except Exception:
        ip = "unknown"
    payload = {
        "probed_at_bj": datetime.now(timezone(timedelta(hours=8))).isoformat(),
        "runner_ip": ip,
        "results": results,
    }
    out = Path("reports/football_source_probe.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
