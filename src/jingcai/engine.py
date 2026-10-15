"""Jingcai （竞彩足球） recommendation engine: 胜平负 + 让球胜平负.

Probabilities start from the official fixed odds (SP) published with
the fixtures. The 胜平负 model reuses the traditional-lottery
multi-factor blend (market, ranking, home/away, and — when team
dynamics were fetched — recent form and head-to-head). The 让球 model
starts from the handicap market's own implied probabilities and tilts
them by the same model edge the 胜平负 blend found over its market
(an approximation, kept deliberately small by construction since the
tilt ratios stay near 1). Picks are the argmax per market; a value
flag marks picks whose model probability beats the SP price by >3%.

Recommendations freeze per match: once a payload is published, later
runs keep the same picks for the same fixture (code + kickoff +
teams), refreshing only odds/probabilities around them.
"""
from __future__ import annotations

from src.football.engine import _multi_factor_probabilities, _probabilities

OUTCOMES = ("3", "1", "0")
SPF_LABELS = {"3": "主胜", "1": "平局", "0": "客胜"}
RQ_LABELS = {"3": "让胜", "1": "让平", "0": "让负"}


def _pick(probabilities: dict) -> str:
    return max(OUTCOMES, key=lambda key: (probabilities[key], -OUTCOMES.index(key)))


def _market_block(odds: dict | None, probabilities: dict | None, labels: dict) -> dict | None:
    if odds is None or probabilities is None:
        return None
    pick = _pick(probabilities)
    return {
        "odds": odds,
        "probabilities": probabilities,
        "pick": pick,
        "pick_label": labels[pick],
        "confidence": probabilities[pick],
        "value_edge": round(probabilities[pick] * odds[pick] - 1, 4),
    }


def analyze_match(match: dict) -> dict:
    """Attach model probabilities and picks to one parsed fixture."""
    row = dict(match)
    factors = None
    spf_probabilities = None
    if match.get("spf_odds"):
        pseudo = {
            "odds": match["spf_odds"],
            "home_rank": match.get("home_rank"),
            "away_rank": match.get("away_rank"),
            "dynamics": match.get("dynamics"),
        }
        spf_probabilities, full_factors = _multi_factor_probabilities(pseudo)
        factors = {
            "available": full_factors["available"],
            "data_completeness": full_factors["data_completeness"],
        }
    row["spf"] = _market_block(match.get("spf_odds"), spf_probabilities, SPF_LABELS)

    rq_probabilities = None
    if match.get("rq_odds"):
        rq_probabilities = _probabilities(match["rq_odds"])
        if spf_probabilities is not None and match.get("spf_odds"):
            market_spf = _probabilities(match["spf_odds"])
            tilted = {
                key: rq_probabilities[key]
                * (spf_probabilities[key] / market_spf[key])
                for key in OUTCOMES
            }
            total = sum(tilted.values())
            rq_probabilities = {key: round(tilted[key] / total, 4) for key in OUTCOMES}
    row["rq"] = _market_block(match.get("rq_odds"), rq_probabilities, RQ_LABELS)
    row["factors"] = factors
    dynamics = match.get("dynamics")
    if dynamics:
        row["dynamics"] = {
            "home": {
                "form_last10": dynamics["home"]["form_last10"],
                "rest_days": dynamics["home"].get("rest_days"),
                "last_match_date": dynamics["home"].get("last_match_date"),
            },
            "away": {
                "form_last10": dynamics["away"]["form_last10"],
                "rest_days": dynamics["away"].get("rest_days"),
                "last_match_date": dynamics["away"].get("last_match_date"),
            },
            "head_to_head": dynamics.get("head_to_head"),
        }
    return row


def build_parlays(rows: list[dict]) -> list[dict]:
    """Suggested SPF parlays from the most confident picks of the day."""
    candidates = [
        row
        for row in rows
        if row.get("spf") and row["spf"]["confidence"] >= 0.50
    ]
    candidates.sort(key=lambda row: -row["spf"]["confidence"])
    parlays = []
    for size, name, minimum in ((2, "稳健2串1", 0.55), (3, "进取3串1", 0.50)):
        legs = [row for row in candidates if row["spf"]["confidence"] >= minimum][:size]
        if len(legs) < size:
            continue
        combined_odds = 1.0
        combined_probability = 1.0
        for leg in legs:
            combined_odds *= leg["spf"]["odds"][leg["spf"]["pick"]]
            combined_probability *= leg["spf"]["confidence"]
        parlays.append(
            {
                "name": name,
                "codes": [leg["code"] for leg in legs],
                "picks": [
                    {
                        "code": leg["code"],
                        "home": leg["home"],
                        "away": leg["away"],
                        "pick_label": leg["spf"]["pick_label"],
                        "odds": leg["spf"]["odds"][leg["spf"]["pick"]],
                    }
                    for leg in legs
                ],
                "combined_odds": round(combined_odds, 2),
                "combined_probability": round(combined_probability, 4),
            }
        )
    return parlays


def _freeze_key(row: dict) -> tuple:
    return (row.get("code"), row.get("kickoff"), row.get("home"), row.get("away"))


def freeze_picks(rows: list[dict], existing: dict | None) -> list[dict]:
    """Keep previously published picks for fixtures still on sale."""
    if not existing:
        return rows
    previous = {_freeze_key(row): row for row in existing.get("matches", [])}
    for row in rows:
        old = previous.get(_freeze_key(row))
        if not old:
            continue
        for market in ("spf", "rq"):
            if row.get(market) and old.get(market):
                row[market]["pick"] = old[market]["pick"]
                row[market]["pick_label"] = old[market]["pick_label"]
                row[market]["confidence"] = row[market]["probabilities"][row[market]["pick"]]
                row[market]["value_edge"] = round(
                    row[market]["confidence"] * row[market]["odds"][row[market]["pick"]] - 1, 4
                )
    return rows


def freeze_parlays(parlays: list[dict], rows: list[dict], existing: dict | None) -> list[dict]:
    """Keep previously published parlay selections while their legs last."""
    if not existing:
        return parlays
    live_codes = {row["code"] for row in rows}
    previous = {p["name"]: p for p in existing.get("parlays", [])}
    kept = []
    for parlay in parlays:
        old = previous.get(parlay["name"])
        if old and all(code in live_codes for code in old.get("codes", [])):
            kept.append(old)
        else:
            kept.append(parlay)
    return kept


def build_payload(matches: list[dict], sale_date: str, source: dict) -> dict:
    rows = [analyze_match(match) for match in matches]
    return {
        "sale_date": sale_date,
        "matches": rows,
        "parlays": build_parlays(rows),
        "source": source,
    }
