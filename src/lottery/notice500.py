"""Draw-notice details （销售额 / 中奖注数 / 单注奖金） from 500 datachart.

The kaijiang XML feeds carry only the drawn numbers; the announcement
figures live on 500's datachart history tables — the same page family
that supplies SSQ's details. Layouts (verified against live pages,
Oct 2026):

- pls / sd (12 cells): set, issue, numbers, sum, sales,
  direct count, direct prize, group3 count, group3 prize,
  group6 count, group6 prize, date. Absent groups are ``&nbsp;``.
  For 福彩3D the count cells read 0 (500 does not publish them
  there); zero counts are omitted, never stored as fact.
- plw (6 cells): set, issue, numbers, sum, sales, date — 排列五's
  table publishes sales only; its prize is the fixed 100000.
"""
from __future__ import annotations

import re
import time
from typing import Any

import requests

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
_URLS = {
    "pl3": "https://datachart.500.com/pls/history/inc/history.php",
    "fc3d": "https://datachart.500.com/sd/history/inc/history.php",
    "pl5": "https://datachart.500.com/plw/history/inc/history.php",
}
_TR_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
_TAG_RE = re.compile(r"<[^>]+>")


def _cells(row_html: str) -> list[str]:
    out = []
    for cell in _TD_RE.findall(row_html):
        text = _TAG_RE.sub("", cell).replace("&nbsp;", " ").replace("&nbsp", " ")
        out.append(text.strip())
    return out


def _num(text: str) -> int | None:
    cleaned = text.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None


def _parse(game: str, html: str) -> dict[str, dict[str, Any]]:
    notices: dict[str, dict[str, Any]] = {}
    for row in _TR_RE.findall(html):
        cells = _cells(row)
        if len(cells) < 6 or not re.fullmatch(r"\d{5,7}", cells[1] or ""):
            continue
        issue = cells[1]
        sales = _num(cells[4])
        if game == "pl5":
            detail: dict[str, Any] = {"first_prize": 100000}
            if sales is not None:
                detail["sales"] = sales
            notices[issue] = detail
            continue
        if len(cells) < 12:
            continue
        detail = {}
        if sales is not None:
            detail["sales"] = sales
        direct_count = _num(cells[5])
        if direct_count:
            detail["direct_count"] = direct_count
        detail["direct_prize"] = _num(cells[6]) or 1040
        group3_count = _num(cells[7])
        if group3_count:
            detail["group3_count"] = group3_count
            detail["group3_prize"] = _num(cells[8]) or 346
        group6_count = _num(cells[9])
        if group6_count:
            detail["group6_count"] = group6_count
            detail["group6_prize"] = _num(cells[10]) or 173
        if detail:
            notices[issue] = detail
    return notices


def fetch_notice(
    game: str, start_issue: int, end_issue: int, timeout: int = 30
) -> dict[str, dict[str, Any]]:
    """Announcement details keyed by issue for an inclusive range."""
    url = _URLS[game]
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(
                url,
                params={"start": start_issue, "end": end_issue},
                headers={"User-Agent": USER_AGENT},
                timeout=timeout,
            )
            resp.raise_for_status()
            return _parse(game, resp.content.decode("gb18030", errors="replace"))
        except Exception as exc:  # best-effort enrichment
            last_error = exc
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"notice fetch failed for {game}: {last_error}")
