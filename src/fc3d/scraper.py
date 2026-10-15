"""Fucai 3D （福彩3D） history scraper — same provider family as DLT/SSQ.

500彩票网 does not expose a datachart history table for 3D, but its
kaijiang static XML feed carries the complete history in one file:
each row has the 7-digit issue (YYYYNNN), the three drawn digits
(opencode) and the draw datetime (opentime). The feed is fetched
whole (about 1 MB) and diffed against what is already stored.

Validation mirrors the other lotteries: issue format, legal date,
digit ranges, no duplicated issues.
"""
from __future__ import annotations

import datetime
import re
import time
from typing import Any

import requests

FEED_URL = "https://kaijiang.500.com/static/info/kaijiang/xml/sd/list.xml"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
ISSUE_RE = re.compile(r"^\d{7}$")
_ROW_RE = re.compile(
    r'expect="(\d{7})"\s+opencode="(\d),(\d),(\d)"\s+opentime="(\d{4}-\d{2}-\d{2})'
)


def _parse_feed(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for issue, d1, d2, d3, date in _ROW_RE.findall(text):
        rows.append(
            {"issue": issue, "date": date, "digits": [int(d1), int(d2), int(d3)]}
        )
    rows.sort(key=lambda r: int(r["issue"]))
    return rows


def fetch_history(timeout: int = 30) -> list[dict[str, Any]]:
    """Fetch the complete 3D history feed with bounded retries."""
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(
                FEED_URL, headers={"User-Agent": USER_AGENT}, timeout=timeout
            )
            resp.raise_for_status()
            rows = _parse_feed(resp.text)
            if not rows:
                raise ValueError("empty 3d feed")
            return rows
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"fc3d feed fetch failed: {last_error}")


def validate(issues: list[dict]) -> list:
    """Validation mirroring the other lottery scrapers."""
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
        digits = it["digits"]
        if len(digits) != 3 or not all(0 <= x <= 9 for x in digits):
            errs.append("号码范围")
        if it["issue"] in seen:
            errs.append("期号重复")
        seen.add(it["issue"])
        if errs:
            bad.append((it["issue"], errs))
    return bad
