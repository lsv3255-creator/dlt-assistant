"""Deterministic, evidence-first engine for 14-match and Renxuan-9 plans."""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime

OUTCOMES = ("3", "1", "0")


def _probabilities(odds: dict[str, float]) -> dict[str, float]:
    values = {key: 1 / float(odds[key]) for key in OUTCOMES}
    total = sum(values.values())
    return {key: round(values[key] / total, 4) for key in OUTCOMES}


def validate_issue(issue: dict) -> None:
    required = {"issue", "sale_start", "sale_end", "draw_date", "sources", "matches"}
    if not required <= set(issue):
        raise ValueError("football issue fields missing")
    if len(issue["matches"]) != 14:
        raise ValueError("traditional football lottery requires exactly 14 matches")
    if [m.get("order") for m in issue["matches"]] != list(range(1, 15)):
        raise ValueError("match order must be 1..14")
    for match in issue["matches"]:
        if not all(str(match.get(key, "")).strip() for key in ("league", "home", "away", "kickoff")):
            raise ValueError("match identity incomplete")
        odds = match.get("odds") or {}
        if set(odds) != set(OUTCOMES) or any(float(v) <= 1 for v in odds.values()):
            raise ValueError("valid decimal odds for 3/1/0 are required")
    datetime.fromisoformat(issue["sale_end"])


def issue_fingerprint(issue: dict) -> str:
    identity = {
        "issue": str(issue["issue"]),
        "sale_end": issue["sale_end"],
        "matches": [
            [m["order"], m["league"], m["home"], m["away"], m["kickoff"]]
            for m in issue["matches"]
        ],
    }
    raw = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def build_plan(issue: dict) -> dict:
    """Build one stable 14-match plan and one exactly-nine-match R9 plan."""
    validate_issue(issue)
    rows = []
    for match in issue["matches"]:
        probs = _probabilities(match["odds"])
        ranked = sorted(OUTCOMES, key=lambda key: (-probs[key], OUTCOMES.index(key)))
        confidence = round(probs[ranked[0]] - probs[ranked[1]], 4)
        rows.append({
            "order": match["order"],
            "league": match["league"],
            "home": match["home"],
            "away": match["away"],
            "kickoff": match["kickoff"],
            "odds": {key: float(match["odds"][key]) for key in OUTCOMES},
            "probabilities": probs,
            "primary": ranked[0],
            "secondary": ranked[1],
            "confidence": confidence,
        })

    # Five closest matches receive a second outcome. Cost stays explicit and bounded.
    uncertain = {row["order"] for row in sorted(rows, key=lambda row: (row["confidence"], row["order"]))[:5]}
    for row in rows:
        row["sfc_choices"] = [row["primary"], row["secondary"]] if row["order"] in uncertain else [row["primary"]]

    r9_orders = {
        row["order"] for row in sorted(rows, key=lambda row: (-row["confidence"], row["order"]))[:9]
    }
    sfc_lines = math.prod(len(row["sfc_choices"]) for row in rows)
    return {
        "issue": str(issue["issue"]),
        "sale_start": issue["sale_start"],
        "sale_end": issue["sale_end"],
        "draw_date": issue["draw_date"],
        "status": "on_sale",
        "identity_hash": issue_fingerprint(issue),
        "matches": rows,
        "plans": {
            "sfc14": {"lines": sfc_lines, "cost_yuan": sfc_lines * 2},
            "ren9": {"orders": sorted(r9_orders), "lines": 1, "cost_yuan": 2},
        },
        "sources": issue["sources"],
    }


def settle(plan: dict, results: list[str]) -> dict:
    if len(results) != 14 or any(value not in OUTCOMES for value in results):
        raise ValueError("results must contain 14 values from 3/1/0")
    hits = sum(results[row["order"] - 1] in row["sfc_choices"] for row in plan["matches"])
    r9_orders = plan["plans"]["ren9"]["orders"]
    r9_hits = sum(results[order - 1] == plan["matches"][order - 1]["primary"] for order in r9_orders)
    return {"sfc_hits": hits, "sfc_total": 14, "ren9_hits": r9_hits, "ren9_total": 9}

