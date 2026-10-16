"""Generate the public jingcai （竞彩足球） recommendation artifact.

Runs after the traditional football cycle inside the same workflow.
Best-effort throughout: any failure keeps the previously published
payload and never breaks the football pipeline. Published picks are
frozen against the live API payload (the authoritative published
state), so a recommendation never changes while a fixture is on sale.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.football.discovery import BJ
from src.jingcai import engine
from src.jingcai.discovery import (
    JINGCAI_URL,
    discover_finished_scores,
    discover_fixtures,
)

OUTPUT = ROOT / "public/data/jingcai/current.json"
API_URL = "https://dlt-assistant.pages.dev/api/jingcai-current"
ARCHIVE_OUT = ROOT / "public/data/jingcai/archive.json"
ARCHIVE_API_URL = "https://dlt-assistant.pages.dev/api/jingcai-archive"


def _read(path: Path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def _published_payload() -> dict | None:
    """Freeze source: the live API payload, falling back to the file."""
    try:
        request = urllib.request.Request(
            API_URL,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                )
            },
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if isinstance(payload, dict) and payload.get("matches"):
            return payload
    except Exception:
        pass
    return _read(OUTPUT)




def _load_archive() -> dict:
    """Archive of published picks, read back from the live API.

    Mirrors the freeze pattern: the API (D1) is the authoritative
    accumulated state; the committed JSON file is only a fallback.
    """
    try:
        request = urllib.request.Request(
            ARCHIVE_API_URL,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                )
            },
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
        days = {day["sale_date"]: day for day in data.get("days", [])}
        if days:
            return {"days": days}
    except Exception:
        pass
    local = _read(ARCHIVE_OUT, {})
    if isinstance(local, dict) and isinstance(local.get("days"), dict):
        return local
    return {"days": {}}


def _archive_update(archive: dict, payload: dict, now: datetime) -> None:
    """Record today's published picks in the archive.

    Entries are written from the frozen payload, refreshed while the
    fixture has not kicked off (so a re-judged handicap pick lands in
    its final published form), and immutable once settled.
    """
    day = archive["days"].setdefault(
        payload["sale_date"],
        {"sale_date": payload["sale_date"], "matches": {}, "parlays": []},
    )
    for row in payload["matches"]:
        old = day["matches"].get(row["code"])
        if old and old.get("score") is not None:
            continue
        if old and now >= datetime.fromisoformat(row["kickoff"]):
            continue
        day["matches"][row["code"]] = {
            "code": row["code"],
            "mid": row.get("okooo_match_id"),
            "league": row.get("league"),
            "home": row["home"],
            "away": row["away"],
            "kickoff": row["kickoff"],
            "handicap": row.get("handicap"),
            "spf_pick": row["spf"]["pick"] if row.get("spf") else None,
            "spf_label": row["spf"]["pick_label"] if row.get("spf") else None,
            "rq_pick": row["rq"]["pick"] if row.get("rq") else None,
            "rq_label": row["rq"]["pick_label"] if row.get("rq") else None,
            "score": None,
            "spf_result": None,
            "rq_result": None,
            "spf_hit": None,
            "rq_hit": None,
        }
    if not any(p.get("hit") is not None for p in day.get("parlays", [])):
        day["parlays"] = [
            {
                "name": parlay["name"],
                "codes": parlay["codes"],
                "picks": [
                    {"code": leg["code"], "pick_label": leg["pick_label"]}
                    for leg in parlay["picks"]
                ],
                "hit": None,
            }
            for parlay in payload.get("parlays", [])
        ]


def _archive_settle(archive: dict, scores: dict, now: datetime) -> None:
    """Settle archived fixtures whose final scores are available.

    A score is only trusted once the fixture kicked off at least 3
    hours ago — the source page shows a 0:0 placeholder for unplayed
    future fixtures, which the kickoff gate filters out.
    """
    from datetime import timedelta

    for day in archive["days"].values():
        for entry in day["matches"].values():
            if entry.get("score") is not None or not entry.get("mid"):
                continue
            if now < datetime.fromisoformat(entry["kickoff"]) + timedelta(hours=3):
                continue
            score = scores.get(str(entry["mid"]))
            if not score:
                continue
            home_goals, away_goals = score
            entry["score"] = [home_goals, away_goals]
            entry["spf_result"] = (
                "3" if home_goals > away_goals else "1" if home_goals == away_goals else "0"
            )
            margin = home_goals - away_goals + (entry.get("handicap") or 0)
            entry["rq_result"] = "3" if margin > 0 else "1" if margin == 0 else "0"
            entry["spf_hit"] = (
                entry["spf_pick"] == entry["spf_result"] if entry["spf_pick"] else None
            )
            entry["rq_hit"] = (
                entry["rq_pick"] == entry["rq_result"] if entry["rq_pick"] else None
            )
        for parlay in day.get("parlays", []):
            if parlay.get("hit") is not None:
                continue
            legs = [day["matches"].get(code) for code in parlay["codes"]]
            if legs and all(leg and leg.get("spf_result") for leg in legs):
                parlay["hit"] = all(leg["spf_hit"] for leg in legs)


def _run_archive(payload: dict, now: datetime) -> None:
    """Archive + settle step of the cycle (best-effort, isolated)."""
    archive = _load_archive()
    _archive_update(archive, payload, now)
    try:
        scores = discover_finished_scores()
    except Exception as exc:
        scores = {}
        print(f"jingcai_scores_fallback: {type(exc).__name__}: {str(exc)[:120]}")
    _archive_settle(archive, scores, now)
    keep = sorted(archive["days"])[-30:]
    archive["days"] = {date: archive["days"][date] for date in keep}
    ARCHIVE_OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = ARCHIVE_OUT.with_suffix(ARCHIVE_OUT.suffix + ".tmp")
    temp.write_text(
        json.dumps(archive, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temp.replace(ARCHIVE_OUT)
    settled = sum(
        1
        for day in archive["days"].values()
        for entry in day["matches"].values()
        if entry.get("score") is not None
    )
    print(f"jingcai archive: days={len(archive['days'])}, settled_matches={settled}")


def main() -> None:
    now = datetime.now(BJ)
    try:
        matches = discover_fixtures(now)
    except Exception as exc:  # keep the previous payload untouched
        print(f"jingcai_discovery_fallback: {type(exc).__name__}: {str(exc)[:160]}")
        return
    try:
        from src.football.dynamics import enrich_issue

        wrapper = {"matches": matches}
        enriched = enrich_issue(wrapper)
        print(f"jingcai_dynamics: enriched={enriched}/{len(matches)}")
    except Exception as exc:
        print(f"jingcai_dynamics_failed: {type(exc).__name__}: {str(exc)[:120]}")
    source = {
        "name": "澳客网竞彩赛程与固定奖金（与官方同步）",
        "url": JINGCAI_URL,
        "checked_at": now.isoformat(),
    }
    payload = engine.build_payload(matches, now.date().isoformat(), source)
    existing = _published_payload()
    payload["matches"] = engine.freeze_picks(payload["matches"], existing)
    payload["parlays"] = engine.freeze_parlays(payload["parlays"], payload["matches"], existing)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(OUTPUT.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)
    print(
        f"jingcai {payload['sale_date']}: matches={len(payload['matches'])}, "
        f"parlays={len(payload['parlays'])}, output={OUTPUT}"
    )
    try:
        _run_archive(payload, now)
    except Exception as exc:  # the archive must never break publication
        print(f"jingcai_archive_failed: {type(exc).__name__}: {str(exc)[:160]}")


if __name__ == "__main__":
    main()
