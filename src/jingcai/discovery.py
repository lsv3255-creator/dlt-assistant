"""Discover the 竞彩足球 (jingcai) fixtures currently on sale at okooo.

The official sporttery site blocks automated access (EdgeOne WAF 567),
so fixtures and fixed odds (SP) come from okooo's public jingcai page,
which mirrors the official sale list. Each match block carries the
official match code （周四001), the handicap, per-market SP odds for
胜平负 (data-wf=0) and 让球胜平负 (data-wf=1), and the okooo match id
used for team-dynamics enrichment.

A match is featured only while it is actually on sale: okooo marks
closed matches with data-end="1", and each match's own sale deadline
(the time shown on the block) must still be in the future. Night
matches list a 22:00-style cutoff belonging to the previous day; the
deadline is reconstructed as the latest such time not after kickoff.
Discovery never fabricates: unparseable or closed matches are dropped,
and a page with no on-sale matches raises ``DiscoveryError``.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

from bs4 import BeautifulSoup

from src.football.discovery import BJ, DiscoveryError, _fetch, _full_name

JINGCAI_URL = "https://www.okooo.com/jingcai/"

# Jingcai-specific abbreviations on top of the shared zucai fixes.
JINGCAI_NAME_FIXES = {
    "托林斯": "特温特",
    "贝西克塔": "贝西克塔斯",
    "奥林匹亚": "奥林匹亚科斯",
    "格风暴": "格拉茨风暴",
    "拉普大学": "拉普拉塔大学生",
    "布鲁马波": "布鲁马波卡纳",
    "弗洛西诺": "弗洛西诺内",
    "拉科": "拉科鲁尼亚",
}

_KICKOFF_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})")


def _name(raw: str) -> str:
    name = (raw or "").strip()
    return JINGCAI_NAME_FIXES.get(name) or _full_name(name)


def _odds_by_outcome(block, market_flag: str) -> dict | None:
    """SP odds {3,1,0} for one market (data-wf 0=胜平负, 1=让球胜平负)."""
    found: dict[str, float] = {}
    if block is None:
        return None
    for option in block.select("[data-sp]"):
        if option.get("data-wf") != market_flag:
            continue
        outcome = {"0": "3", "1": "1", "2": "0"}.get(option.get("data-wz") or "")
        raw = (option.get("data-sp") or "").strip()
        if outcome is None or not raw:
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        if value > 1:
            found[outcome] = value
    return found if set(found) == {"3", "1", "0"} else None


def _rank(block, selector: str) -> int | None:
    el = block.select_one(selector) if block else None
    if el is None:
        return None
    match = re.search(r"(\d+)", el.get_text(strip=True))
    return int(match.group(1)) if match else None


def parse_jingcai_page(html: str, now: datetime) -> list[dict]:
    """Parse on-sale jingcai fixtures from an okooo jingcai page."""
    soup = BeautifulSoup(html, "html.parser")
    matches: list[dict] = []
    for block in soup.select("div.touzhu_1"):
        if block.get("data-end") == "1":
            continue
        match_id = block.get("data-mid")
        code = block.get("data-ordercn")
        time_el = block.select_one(".shijian")
        if not match_id or not code or time_el is None:
            continue
        kickoff_match = _KICKOFF_RE.search(time_el.get("title") or "")
        deadline_text = time_el.get_text(strip=True)
        if not kickoff_match or ":" not in deadline_text:
            continue
        kickoff = datetime(
            *(int(g) for g in kickoff_match.groups()), tzinfo=BJ
        )
        hour, minute = (int(p) for p in deadline_text.split(":")[:2])
        deadline = kickoff.replace(hour=hour, minute=minute, second=0)
        if deadline > kickoff:
            deadline -= timedelta(days=1)
        if deadline <= now:
            continue
        spf_block = block.select_one(".shenpf")
        home_el = spf_block.select_one(".zhu .zhum") if spf_block else None
        away_el = spf_block.select_one(".fu .zhum") if spf_block else None
        if home_el is None or away_el is None:
            continue
        league_el = block.select_one(".saiming")
        try:
            handicap = int(block.get("data-rq") or 0)
        except ValueError:
            handicap = 0
        match = {
            "code": code,
            "okooo_match_id": match_id,
            "league": league_el.get_text(strip=True) if league_el else "",
            "home": _name(home_el.get("title") or home_el.get_text(strip=True)),
            "away": _name(away_el.get("title") or away_el.get_text(strip=True)),
            "home_rank": _rank(spf_block, ".zhu .p2"),
            "away_rank": _rank(spf_block, ".fu .p2"),
            "kickoff": kickoff.isoformat(),
            "deadline": deadline.isoformat(),
            "handicap": handicap,
            "spf_odds": _odds_by_outcome(spf_block, "0"),
            "rq_odds": _odds_by_outcome(block.select_one(".rangqiuspf"), "1"),
        }
        if match["spf_odds"] is None and match["rq_odds"] is None:
            continue
        matches.append(match)
    matches.sort(key=lambda m: (m["deadline"], m["kickoff"], m["code"]))
    return matches


def discover_fixtures(now: datetime | None = None) -> list[dict]:
    """Fetch and parse the currently on-sale jingcai fixtures."""
    now = now or datetime.now(BJ)
    html = _fetch(JINGCAI_URL)
    matches = parse_jingcai_page(html, now)
    if not matches:
        raise DiscoveryError("no on-sale jingcai fixtures parsed")
    return matches
