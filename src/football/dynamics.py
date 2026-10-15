"""Per-issue team dynamics from okooo match history pages.

For every fixture, okooo's history page carries both teams' recent
match lists (dates + scores), their head-to-head list and season
summaries. This module turns that into structured, auditable dynamics:
last-10 form, rest days before kickoff and head-to-head record. These
records are also the raw material for the long-lived team archive
(``football_teams`` / ``football_team_snapshots`` in D1): team history
is kept precisely because forecasting needs it, unlike lottery draw
history.

Injury/news pages are unstructured and unreliable to parse, so the
``injuries`` factor stays unavailable until a structured source exists;
nothing here invents it.
"""
from __future__ import annotations

import re
from datetime import datetime

from bs4 import BeautifulSoup

from src.football.discovery import BJ, DiscoveryError, _fetch

HISTORY_URL = "https://www.okooo.com/soccer/match/{match_id}/history/"
_SCORE_RE = re.compile(r"^(\d{1,2})-(\d{1,2})$")
_DATE_RE = re.compile(r"(20\d{2})-(\d{2})-(\d{2})")
FORM_LIMIT = 10


def _row_cells(row) -> list[str]:
    return [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]


def _completed_rows(table) -> list[dict]:
    """Extract completed matches (date, home, score, away) from a table."""
    out: list[dict] = []
    for row in table.find_all("tr"):
        cells = _row_cells(row)
        if len(cells) < 5:
            continue
        date_match = _DATE_RE.search(cells[1]) if len(cells) > 1 else None
        score_match = _SCORE_RE.match(cells[3]) if len(cells) > 3 else None
        if not date_match or not score_match:
            continue
        out.append({
            "date": date_match.group(0),
            "home": cells[2],
            "away": cells[4],
            "home_goals": int(score_match.group(1)),
            "away_goals": int(score_match.group(2)),
        })
    return out


def _classify_tables(soup: BeautifulSoup) -> tuple[list, object | None]:
    """Return (team tables in fixture order, head-to-head table)."""
    team_tables: list = []
    h2h_table = None
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        head = rows[0].get_text(" ", strip=True)
        colhead = rows[1].get_text(" ", strip=True) if len(rows) > 1 else ""
        if "比分" not in colhead or "时间" not in colhead:
            continue
        if "未来" in head:
            continue
        if "两队交锋" in head:
            h2h_table = table
        else:
            team_tables.append(table)
    return team_tables, h2h_table


def team_name_of(table) -> str:
    """The okooo-soccer display name heading a team history table."""
    rows = table.find_all("tr")
    if not rows:
        return ""
    head = rows[0].get_text(" ", strip=True)
    return head.split(" ")[0] if head else ""


def _team_form(rows: list[dict], team: str, kickoff_date: str) -> dict | None:
    played = [r for r in rows if r["date"] < kickoff_date]
    recent = played[:FORM_LIMIT]
    if not recent:
        return None
    wins = draws = losses = goals_for = goals_against = 0
    for r in recent:
        if r["home"] == team:
            gf, ga = r["home_goals"], r["away_goals"]
        elif r["away"] == team:
            gf, ga = r["away_goals"], r["home_goals"]
        else:
            continue
        goals_for += gf
        goals_against += ga
        if gf > ga:
            wins += 1
        elif gf == ga:
            draws += 1
        else:
            losses += 1
    counted = wins + draws + losses
    if not counted:
        return None
    last_date = recent[0]["date"]
    rest_days = (
        datetime.fromisoformat(kickoff_date) - datetime.fromisoformat(last_date)
    ).days
    return {
        "played": counted,
        "w": wins,
        "d": draws,
        "l": losses,
        "points": wins * 3 + draws,
        "gf": goals_for,
        "ga": goals_against,
        "last_match_date": last_date,
        "rest_days": rest_days,
    }


def _head_to_head(rows: list[dict], home_team: str, kickoff_date: str) -> dict | None:
    meetings = [r for r in rows if r["date"] < kickoff_date]
    if not meetings:
        return None
    home_wins = draws = away_wins = 0
    for r in meetings:
        if r["home"] == home_team:
            gf, ga = r["home_goals"], r["away_goals"]
        elif r["away"] == home_team:
            gf, ga = r["away_goals"], r["home_goals"]
        else:
            continue
        if gf > ga:
            home_wins += 1
        elif gf == ga:
            draws += 1
        else:
            away_wins += 1
    total = home_wins + draws + away_wins
    if not total:
        return None
    return {
        "meetings": total,
        "home_wins": home_wins,
        "draws": draws,
        "away_wins": away_wins,
    }


def parse_history_page(html: str, kickoff: str) -> dict:
    """Parse one okooo history page into a dynamics record.

    ``kickoff`` is the fixture kickoff ISO timestamp; only matches
    completed before its date count toward form and head-to-head.
    """
    soup = BeautifulSoup(html, "html.parser")
    team_tables, h2h_table = _classify_tables(soup)
    if len(team_tables) < 2:
        raise DiscoveryError("team history tables not found")
    kickoff_date = kickoff[:10]
    dynamics: dict = {}
    for slot, table in zip(("home", "away"), team_tables[:2]):
        team = team_name_of(table)
        form = _team_form(_completed_rows(table), team, kickoff_date)
        if form is None:
            raise DiscoveryError(f"no completed matches for {slot} team")
        dynamics[slot] = {
            "source_name": team,
            "form_last10": {
                key: form[key]
                for key in ("played", "w", "d", "l", "points", "gf", "ga")
            },
            "rest_days": form["rest_days"],
            "last_match_date": form["last_match_date"],
        }
    home_source_name = dynamics["home"]["source_name"]
    if h2h_table is not None:
        dynamics["head_to_head"] = _head_to_head(
            _completed_rows(h2h_table), home_source_name, kickoff_date
        )
    else:
        dynamics["head_to_head"] = None
    return dynamics


def enrich_issue(issue: dict, fetch=_fetch) -> int:
    """Fetch dynamics for every match that carries an okooo match id.

    Returns how many matches were enriched. Per-match failures degrade
    silently (that match simply keeps its previous factor coverage);
    this function never raises.
    """
    enriched = 0
    for match in issue.get("matches", []):
        match_id = match.get("okooo_match_id")
        if not match_id:
            continue
        try:
            html = fetch(HISTORY_URL.format(match_id=match_id))
            match["dynamics"] = parse_history_page(html, match["kickoff"])
            enriched += 1
        except Exception:
            continue
    return enriched
