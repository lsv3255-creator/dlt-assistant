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
    # Featured-issue pages (e.g. 26142) abbreviate harder; expansions
    # verified against okooo's own match-history page titles and the
    # standard Chinese names used in official lottery announcements.
    "勒沃": "勒沃库森",
    "布拉格": "布拉格斯巴达",
    "利勒斯": "利勒斯特罗姆",
    "托林斯": "特温特",
    "圣吉联": "圣吉罗斯",
    "社会": "皇家社会",
    "凯尔特": "凯尔特人",
    "伯恩茅": "伯恩茅斯",
    "格拉茨": "格拉茨风暴",
    "尤文": "尤文图斯",
    "萨格勒": "萨格勒布迪纳摩",
    "安德莱": "安德莱赫特",
    "霍芬海": "霍芬海姆",
    "贝西克": "贝西克塔斯",
    "奥林匹": "奥林匹亚科斯",
    "索斯基": "索菲亚列夫斯基",
    "伊普斯": "伊普斯维奇",
    "斯图加": "斯图加特",
    "纽卡斯": "纽卡斯尔",
    "维拉": "阿斯顿维拉",
    "柏林联": "柏林联合",
    "多特": "多特蒙德",
    "埃沃斯": "艾禾斯堡",
    "奥格斯": "奥格斯堡",
    "国米": "国际米兰",
    "比利亚": "比利亚雷亚尔",
    "巴伦西": "巴伦西亚",
    "毕尔巴": "毕尔巴鄂竞技",
    "布伦特": "布伦特福德",
    "佛罗伦": "佛罗伦萨",
    "亚特兰": "亚特兰大",
    "阿拉维": "阿拉维斯",
    "塞维利": "塞维利亚",
    "利兹": "利兹联",
    "诺丁汉": "诺丁汉森林",
    "门兴": "门兴格拉德巴赫",
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
# Real okooo row texts come in two shapes: the plain one
# "1 英冠 10-17 03:00 [21] 2.90 伯恩利 3.45 [10] 2.28 伍尔弗 ..." and the
# featured-issue one with a league tag before each rank bracket:
# "1 欧罗巴 10-16 00:45 波甲 [2] 4.86 波兹南 4.48 德甲 [4] 1.58 勒沃 ..."
_ROW_RE = re.compile(
    r"(?:\S+\s+)?\[(\d+)\]\s*(\d+\.\d{1,2})\s*(\S+)\s*(\d+\.\d{1,2})\s*"
    r"(?:\S+\s+)?\[(\d+)\]\s*(\d+\.\d{1,2})\s*(\S+)"
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
    """Return ``(issue, html)`` for the on-sale issue closing soonest.

    Several issues are usually on sale at once with staggered
    deadlines; the featured one is the issue whose deadline comes
    first, whether its number is below or above the repository's
    current issue. Candidates come from the okooo index tabs and the
    tabs on the repository issue's own page, within a small window
    around the current issue. A candidate counts only when its page
    shows a sale deadline still in the future.
    """
    candidates: set[int] = set(range(current - 3, current + 9))
    pages: dict[int, str] = {}
    for url in (INDEX_URL, ISSUE_URL.format(issue=current)):
        try:
            html = _fetch(url)
        except Exception:
            continue  # candidate gathering is best-effort
        candidates.update(tabulated_issues(html))
        if url != INDEX_URL:
            pages[current] = html
    best: tuple[datetime, int, str] | None = None
    for number in sorted(candidates):
        # Look a little behind (a still-open earlier issue) and further
        # ahead, so a lagging repository file cannot strand discovery.
        if not (current - 3 <= number <= current + 8):
            continue
        try:
            html = pages.get(number) or _fetch(ISSUE_URL.format(issue=number))
        except Exception:
            continue
        text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
        try:
            deadline = _sale_end(text, now)
        except DiscoveryError:
            continue
        if deadline > now and (best is None or (deadline, number) < best[:2]):
            best = (deadline, number, html)
    if best is None:
        raise DiscoveryError("no tabulated issue has a future sale deadline")
    return best[1], best[2]


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
    # than the two-day estimate. Forward switches only: when discovery
    # moves back to an earlier still-open issue, its own estimated
    # opening stands.
    previous_end = datetime.fromisoformat(existing["sale_end"])
    if target > current and previous_end >= datetime.fromisoformat(
        candidate["sale_start"]
    ):
        candidate["sale_start"] = existing["sale_end"]
    validate_issue(candidate)
    _atomic_write(path, candidate)
    return "switched", str(target)
