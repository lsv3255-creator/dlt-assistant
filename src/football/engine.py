"""Deterministic, evidence-first engine for 14-match and Renxuan-9 plans."""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime

OUTCOMES = ("3", "1", "0")
FACTOR_WEIGHTS = {"market": 0.75, "ranking": 0.20, "home_away": 0.05}


def _probabilities(odds: dict[str, float]) -> dict[str, float]:
    values = {key: 1 / float(odds[key]) for key in OUTCOMES}
    total = sum(values.values())
    return {key: round(values[key] / total, 4) for key in OUTCOMES}


def _rounded_probabilities(values: dict[str, float]) -> dict[str, float]:
    total = sum(values.values())
    result = {key: round(values[key] / total, 4) for key in OUTCOMES}
    result["0"] = round(result["0"] + (1 - sum(result.values())), 4)
    return result


def _ranking_probabilities(home_rank: int, away_rank: int) -> dict[str, float]:
    """Convert same-league table positions to a deliberately conservative prior."""
    rank_edge = max(-18, min(18, away_rank - home_rank))
    home_share = 1 / (1 + math.exp(-rank_edge / 6))
    return _rounded_probabilities({"3": 0.70 * home_share, "1": 0.30, "0": 0.70 * (1 - home_share)})


def _multi_factor_probabilities(match: dict) -> tuple[dict[str, float], dict]:
    market = _probabilities(match["odds"])
    available = ["market", "home_away"]
    unavailable = ["recent_form", "injuries", "rest_days", "head_to_head"]
    components = {
        "market": market,
        "home_away": {"3": 0.37, "1": 0.30, "0": 0.33},
    }
    weights = {"market": FACTOR_WEIGHTS["market"], "home_away": FACTOR_WEIGHTS["home_away"]}
    if isinstance(match.get("home_rank"), int) and isinstance(match.get("away_rank"), int):
        available.append("ranking")
        components["ranking"] = _ranking_probabilities(match["home_rank"], match["away_rank"])
        weights["ranking"] = FACTOR_WEIGHTS["ranking"]
    else:
        unavailable.append("ranking")

    weight_total = sum(weights.values())
    combined = {
        outcome: sum(components[name][outcome] * weight for name, weight in weights.items()) / weight_total
        for outcome in OUTCOMES
    }
    probabilities = _rounded_probabilities(combined)
    ranked = sorted(OUTCOMES, key=lambda key: (-probabilities[key], OUTCOMES.index(key)))
    uncertainty = round(1 - (probabilities[ranked[0]] - probabilities[ranked[1]]), 4)
    factors = {
        "available": available,
        "unavailable": unavailable,
        "weights": {name: round(weight / weight_total, 4) for name, weight in weights.items()},
        "components": components,
        "uncertainty": uncertainty,
        "data_completeness": round(len(available) / (len(available) + len(unavailable)), 4),
    }
    return probabilities, factors


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
        for key in ("home_rank", "away_rank"):
            if key in match and (not isinstance(match[key], int) or match[key] < 1):
                raise ValueError("rank must be a positive integer")
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
        probs, factors = _multi_factor_probabilities(match)
        ranked = sorted(OUTCOMES, key=lambda key: (-probs[key], OUTCOMES.index(key)))
        confidence = round(probs[ranked[0]] - probs[ranked[1]], 4)
        rows.append({
            "order": match["order"],
            "league": match["league"],
            "home": match["home"],
            "away": match["away"],
            "kickoff": match["kickoff"],
            "odds": {key: float(match["odds"][key]) for key in OUTCOMES},
            "home_rank": match.get("home_rank"),
            "away_rank": match.get("away_rank"),
            "probabilities": probs,
            "factors": factors,
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


def freeze_existing_recommendation(plan: dict, existing: dict) -> dict:
    """Never change a same-issue recommendation after it has been published."""
    if existing.get("issue") != plan.get("issue") or len(existing.get("matches", [])) != 14:
        return plan
    old_by_order = {row.get("order"): row for row in existing["matches"]}
    for row in plan["matches"]:
        old = old_by_order.get(row["order"], {})
        if (old.get("home"), old.get("away"), old.get("kickoff")) != (row["home"], row["away"], row["kickoff"]):
            return plan
    for row in plan["matches"]:
        old = old_by_order[row["order"]]
        row["primary"] = old["primary"]
        row["secondary"] = old["secondary"]
        row["sfc_choices"] = old["sfc_choices"]
    plan["plans"] = existing["plans"]
    return plan


def settle(plan: dict, results: list[str]) -> dict:
    if len(results) != 14 or any(value not in OUTCOMES for value in results):
        raise ValueError("results must contain 14 values from 3/1/0")
    hits = sum(results[row["order"] - 1] in row["sfc_choices"] for row in plan["matches"])
    r9_orders = plan["plans"]["ren9"]["orders"]
    r9_hits = sum(results[order - 1] == plan["matches"][order - 1]["primary"] for order in r9_orders)
    return {"sfc_hits": hits, "sfc_total": 14, "ren9_hits": r9_hits, "ren9_total": 9}

