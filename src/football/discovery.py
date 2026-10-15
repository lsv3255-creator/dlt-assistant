"""Auto-discover the traditional football-lottery issue currently on sale.

The official sporttery site blocks automated access (EdgeOne WAF 567),
so the schedule/market source is okooo's public zucai pages. okooo lists
recent and upcoming issues as tabs on every issue page; the issue on
sale is the earliest tabulated issue whose sale deadline is still in
the future (earlier ones are already closed, later ones are previews).

Discovery never fabricates: a candidate issue is accepted only when it
parses completely (exactly 14 matches with valid odds) and passes
``engine.validate_issue``. Any failure raises ``DiscoveryError`` and the
caller falls back to the existing curated issue file unchanged.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from src.football.engine import validate_issue

BJ = timezone(timedelta(hours=8))
INDEX_URL = "https://www.okooo.com/zucai/"
ISSUE_URL = "https://www.okooo.com/zucai/{issue}/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://www.okooo.com/",
}
WAF_MARKERS = ("访问被阻断", "请求已被拦截", "安全威胁")

# okooo prints abbreviated club names; full names verified against the
# officially announced issue 26143 fixtures curated in this repository.
TEAM_NAME_FIXES = {
    "伍尔弗": "伍尔弗汉普顿",
    "法兰克": "法兰克福",
    "科特布": "科特布斯",
    "赫塔": "柏林赫塔",
    "弗洛西": "弗洛西诺内",
    "拉科鲁": "拉科鲁尼亚",
    "格勒诺": "格勒诺布尔",
    "精英": "SBV精英",
    "布鲁马": "布鲁马波卡纳",
    "佐加顿": "佐加顿斯",
}


class DiscoveryError(RuntimeError):
    pass


def _decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("gb18030")


def _fetch(url: str, attempts: int = 3, timeout: int = 25) -> str:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=timeout)
            if resp.status_code != 200:
                raise DiscoveryError(f"{url} -> HTTP {resp.status_code}")
            text = _decode(resp.content)
            if any(marker in text for marker in WAF_MARKERS):
                raise DiscoveryError(f"{url} -> WAF block page")
            if len(text) < 2000:
                raise DiscoveryError(f"{url} -> suspiciously short page")
            return text
        except (requests.RequestException, DiscoveryError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2 * (attempt + 1))
    raise DiscoveryError(f"fetch failed for {url}: {last_error}")


def _full_name(name: str) -> str:
    return TEAM_NAME_FIXES.get(name, name)


def _with_year(month: int, day: int, hour: int, minute: int, now: datetime) -> datetime:
    candidate = datetime(now.year, month, day, hour, minute, tzinfo=BJ)
    if candidate < now - timedelta(days=30):
        candidate = candidate.replace(year=now.year + 1)
    elif candidate > now + timedelta(days=300):
        candidate = candidate.replace(year=now.year - 1)
    return candidate


_TIME_RE = re.compile(r"(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})")
# Real okooo row text: "1 英冠 10-17 03:00 [21] 2.90 伯恩利 3.45 [10] 2.28 伍尔弗 ..."
_ROW_RE = re.compile(
    r"\[(\d+)\]\s*(\d+\.\d{1,2})\s*(\S+)\s*(\d+\.\d{1,2})\s*"
    r"\[(\d+)\]\s*(\d+\.\d{1,2})\s*(\S+)"
)
_SALE_END_RE = re.compile(
    r"(?:截止时间|停售时间)[^0-9]*(\d{1,2})-(\d{1,2})[^0-9:]{0,12}?(\d{1,2}):(\d{2})"
)
_TAB_RE = re.compile(r'href="/zucai/(\d{5})/"')


def tabulated_issues(html: str) -> list[int]:
    """All issue numbers linked as tabs on an okooo issue page."""
    return sorted({int(n) for n in _TAB_RE.findall(html)})


def _sale_end(page_text: str, now: datetime) -> datetime:
    sale_match = _SALE_END_RE.search(page_text)
    if not sale_match:
        raise DiscoveryError("sale deadline not found on okooo page")
    month, day, hour, minute = (int(g) for g in sale_match.groups())
    return _with_year(month, day, hour, minute, now)


def _parse_matches(soup: BeautifulSoup, now: datetime) -> list[dict]:
    matches: list[dict] = []
    for row in soup.find_all("tr"):
        text = row.get_text(" ", strip=True)
        time_match = _TIME_RE.search(text)
        row_match = _ROW_RE.search(text)
        if not time_match or not row_match:
            continue
        month, day, hour, minute = (int(g) for g in time_match.groups())
        kickoff = _with_year(month, day, hour, minute, now)
        before = text[: time_match.start()].split()
        league = before[-1] if before else ""
        if not league or len(league) > 6:
            continue
        home_rank, odds3, home, odds1, away_rank, odds0, away = row_match.groups()
        parsed_match = {
            "order": len(matches) + 1,
            "league": league,
            "home": _full_name(home),
            "away": _full_name(away),
            "home_rank": int(home_rank),
            "away_rank": int(away_rank),
            "kickoff": kickoff.isoformat(),
            "odds": {"3": float(odds3), "1": float(odds1), "0": float(odds0)},
        }
        history_link = row.find(
            "a", href=re.compile(r"/soccer/match/\d+/history/")
        )
        if history_link is not None:
            id_match = re.search(r"/soccer/match/(\d+)/", history_link["href"])
            if id_match:
                parsed_match["okooo_match_id"] = id_match.group(1)
        matches.append(parsed_match)
    if len(matches) != 14:
        raise DiscoveryError(f"expected 14 matches, parsed {len(matches)}")
    return matches


def parse_issue_page(html: str, issue: int, now: datetime) -> dict:
    """Parse one okooo issue page into the repository issue schema."""
    soup = BeautifulSoup(html, "html.parser")
    page_text = soup.get_text(" ", strip=True)
    sale_end = _sale_end(page_text, now)
    matches = _parse_matches(soup, now)
    draw_date = max(m["kickoff"][:10] for m in matches)
    url = ISSUE_URL.format(issue=issue)
    checked = now.isoformat()
    return {
        "issue": str(issue),
        "sale_start": (sale_end - timedelta(days=2)).replace(
            hour=20, minute=0, second=0
        ).isoformat(),
        "sale_start_estimated": True,
        "sale_end": sale_end.isoformat(),
        "draw_date": draw_date,
        "sources": {
            "schedule": {
                "name": "澳客网足彩赛程（与官方公告同步）",
                "url": url,
                "checked_at": checked,
            },
            "market": {
                "name": "澳客平均欧指及页面联赛排名",
                "url": url,
                "checked_at": checked,
            },
        },
        "matches": matches,
    }


def _atomic_write(path: Path, value: dict) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temp.replace(path)


def find_on_sale_issue(current: int, now: datetime) -> tuple[int, str]:
    """Return ``(issue, html)`` for the issue currently on sale.

    Starts from the repository's current issue page, walks its issue
    tabs in ascending order and picks the first issue whose sale
    deadline is still in the future.
    """
    landing = _fetch(ISSUE_URL.format(issue=current))
    tabs = [n for n in tabulated_issues(landing) if current - 1 <= n <= current + 3]
    if current not in tabs:
        raise DiscoveryError("repository issue not present in okooo tabs")
    pages: dict[int, str] = {current: landing}
    for number in sorted(tabs):
        if number < current:
            continue
        html = pages.get(number) or _fetch(ISSUE_URL.format(issue=number))
        pages[number] = html
        text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
        try:
            deadline = _sale_end(text, now)
        except DiscoveryError:
            continue
        if deadline > now:
            return number, html
    raise DiscoveryError("no tabulated issue has a future sale deadline")


def refresh_issue_file(path: Path, now: datetime | None = None) -> tuple[str, str]:
    """Refresh ``current_issue.json`` from okooo.

    Returns ``(status, issue)`` where status is ``switched``, ``refreshed``
    or ``unchanged``. Raises ``DiscoveryError`` on any problem; the file is
    left untouched in that case so the caller can fall back safely.
    """
    now = now or datetime.now(BJ)
    existing = json.loads(path.read_text(encoding="utf-8"))
    current = int(existing["issue"])

    target, html = find_on_sale_issue(current, now)
    candidate = parse_issue_page(html, target, now)

    if target == current:
        candidate["sale_start"] = existing["sale_start"]
        candidate.pop("sale_start_estimated", None)
        if existing.get("results"):
            candidate["results"] = existing["results"]
        if candidate["matches"] == existing["matches"] and candidate[
            "sale_end"
        ] == existing["sale_end"]:
            return "unchanged", str(current)
        validate_issue(candidate)
        _atomic_write(path, candidate)
        return "refreshed", str(current)

    # The next issue normally opens when the previous one closes; chain
    # the opening time from the previous deadline when that is later
    # than the two-day estimate.
    previous_end = datetime.fromisoformat(existing["sale_end"])
    if previous_end >= datetime.fromisoformat(candidate["sale_start"]):
        candidate["sale_start"] = existing["sale_end"]
    validate_issue(candidate)
    _atomic_write(path, candidate)
    return "switched", str(target)
