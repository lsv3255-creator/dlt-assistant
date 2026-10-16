"""Shuangseqiu （双色球） history scraper — mirrors the DLT scraper.

Source: 500彩票网 datachart history page (same provider and page
family as the DLT pipeline), issue-range query (?start=&end=) over
5-digit issues (YYNNN). Each row carries the issue, six red balls
(1-33), one blue ball (1-16) and the draw date. Very old rows add a
legacy promotional column after the blue ball; only the first blue
cell is read.

Validation mirrors the DLT five-fold checks: issue format, legal
date, ball ranges, no duplicated balls, no duplicated issues.
"""
from __future__ import annotations

import datetime
import re
import time
from typing import Any

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://datachart.500.com/ssq/history/newinc/history.php"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
ISSUE_RE = re.compile(r"^\d{5}$")
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_PROMO_RE = re.compile(r"^\d{1,2},\d{1,2},\d{1,2}$")
FIRST_YEAR = 3  # 双色球 launched in 2003 (first draw 03001, 2003-02-23)


def _parse_detail(cells: list, blue_idx: int) -> dict | None:
    """Announcement cells after the blue ball: pool, 1st-prize count,
    1st prize, 2nd-prize count, 2nd prize, total sales. Legacy rows
    carry an extra promotional cell (e.g. '04,12,15'); skip it."""
    tail: list[str] = []
    for td in cells[blue_idx + 1 : -1]:
        text = td.get_text(strip=True)
        if not text or _PROMO_RE.fullmatch(text):
            continue
        tail.append(text)
    # Some eras carry a placeholder '0' cell right after the blue ball.
    if len(tail) == 7 and tail[0] == "0":
        tail = tail[1:]
    if len(tail) != 6:
        return None
    try:
        values = [int(t.replace(",", "")) for t in tail]
    except ValueError:
        return None
    return {
        "pool": values[0],
        "first_count": values[1],
        "first_prize": values[2],
        "second_count": values[3],
        "second_prize": values[4],
        "sales": values[5],
    }


def _parse_rows(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    tbody = soup.find("tbody", id="tdata") or soup.find(id="tdata")
    if tbody is None:
        return []
    rows: list[dict[str, Any]] = []
    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 9:
            continue
        issue = cells[0].get_text(strip=True)
        if not ISSUE_RE.fullmatch(issue):
            continue
        reds = []
        for td in tr.find_all("td", class_="t_cfont2"):
            text = td.get_text(strip=True)
            if text.isdigit():
                reds.append(int(text))
        blue_td = tr.find("td", class_="t_cfont4")
        date_match = _DATE_RE.search(cells[-1].get_text(strip=True))
        if len(reds) != 6 or blue_td is None or date_match is None:
            continue
        blue_text = blue_td.get_text(strip=True)
        if not blue_text.isdigit():
            continue
        row = {
            "issue": issue,
            "date": date_match.group(0),
            "red": reds,
            "blue": int(blue_text),
        }
        detail = _parse_detail(cells, cells.index(blue_td))
        if detail:
            row["detail"] = detail
        rows.append(row)
    return rows


def fetch_range(start: str, end: str, timeout: int = 30) -> list[dict[str, Any]]:
    """Fetch one issue range with bounded retries (DLT pattern)."""
    url = f"{BASE_URL}?start={start}&end={end}"
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(
                url, headers={"User-Agent": USER_AGENT}, timeout=timeout
            )
            resp.raise_for_status()
            html = resp.content.decode("gb18030", errors="replace")
            return _parse_rows(html)
        except requests.RequestException as exc:
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"ssq fetch failed for {start}~{end}: {last_error}")


def year_end_issue(latest: int) -> str:
    """Upper bound for incremental fetches (mirrors DLT helper)."""
    yy = latest // 1000
    return f"{(yy + 1) % 100:02d}365"


def fetch_all_history(current_yy: int | None = None) -> list[dict[str, Any]]:
    """Fetch the complete history, one request per year."""
    if current_yy is None:
        current_yy = datetime.date.today().year % 100
    rows: list[dict[str, Any]] = []
    for yy in range(FIRST_YEAR, current_yy + 1):
        rows.extend(fetch_range(f"{yy:02d}001", f"{yy:02d}365"))
    rows.sort(key=lambda r: int(r["issue"]))
    return rows


def validate(issues: list[dict]) -> list:
    """Five-fold validation, mirroring scripts/update_dlt_d1.validate."""
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
        red, blue = it["red"], it["blue"]
        if len(red) != 6 or not all(1 <= x <= 33 for x in red):
            errs.append("红球范围")
        if len(set(red)) != 6:
            errs.append("红球重复")
        if not (1 <= blue <= 16):
            errs.append("蓝球范围")
        if it["issue"] in seen:
            errs.append("期号重复")
        seen.add(it["issue"])
        if errs:
            bad.append((it["issue"], errs))
    return bad
