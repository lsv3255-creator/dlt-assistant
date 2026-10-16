"""Jingcai （竞彩足球） recommendation engine: 胜平负 + 让球胜平负.

Probabilities start from the official fixed odds (SP) published with
the fixtures. The 胜平负 model reuses the traditional-lottery
multi-factor blend (market, ranking, home/away, and — when team
dynamics were fetched — recent form and head-to-head). The 让球 model
judges the handicap on its own terms: an independent-Poisson score
matrix is fitted to the 胜平负 model probabilities, the fixture's
actual handicap line is applied to the resulting goal-margin
distribution (so a model edge concentrated in one-goal wins lands on
让平 for a -1 line instead of 让胜), and the outcome is blended with
the handicap market's own implied probabilities (0.6 model / 0.4
market). Picks are the argmax per market; a value flag marks picks
whose model probability beats the SP price by >3%.

Recommendations freeze per match: once a payload is published, later
runs keep the same picks for the same fixture (code + kickoff +
teams), refreshing only odds/probabilities around them.
"""
from __future__ import annotations

import math

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


_MAX_GOALS = 10
_PMF_CACHE: dict[float, list[float]] = {}


def _poisson_pmf_list(lam: float) -> list[float]:
    if lam not in _PMF_CACHE:
        _PMF_CACHE[lam] = [
            math.exp(-lam) * lam**k / math.factorial(k)
            for k in range(_MAX_GOALS + 1)
        ]
    return _PMF_CACHE[lam]


def _margin_distribution(lam_home: float, lam_away: float) -> dict[int, float]:
    home = _poisson_pmf_list(round(lam_home, 4))
    away = _poisson_pmf_list(round(lam_away, 4))
    margins: dict[int, float] = {}
    for hg, hp in enumerate(home):
        if hp <= 0:
            continue
        for ag, ap in enumerate(away):
            if ap <= 0:
                continue
            margins[hg - ag] = margins.get(hg - ag, 0.0) + hp * ap
    return margins


def _spf_from_margins(margins: dict[int, float]) -> dict[str, float]:
    return {
        "3": sum(p for m, p in margins.items() if m > 0),
        "1": margins.get(0, 0.0),
        "0": sum(p for m, p in margins.items() if m < 0),
    }


def _fit_lambdas(target: dict) -> tuple[float, float]:
    """Fit independent-Poisson expected goals to a 1X2 probability set."""

    def error(lh: float, la: float) -> float:
        probs = _spf_from_margins(_margin_distribution(lh, la))
        return sum((probs[key] - target[key]) ** 2 for key in OUTCOMES)

    grid = [0.2 + 0.1 * i for i in range(41)]  # 0.2 .. 4.2
    best = (1.35, 1.15)
    best_err = float("inf")
    for lh in grid:
        for la in grid:
            err = error(lh, la)
            if err < best_err:
                best_err, best = err, (lh, la)
    step = 0.05
    while step >= 0.006:
        improved = False
        for dlh in (-step, 0.0, step):
            for dla in (-step, 0.0, step):
                cand = (max(0.05, best[0] + dlh), max(0.05, best[1] + dla))
                err = error(*cand)
                if err < best_err - 1e-12:
                    best_err, best, improved = err, cand, True
        if not improved:
            step /= 2
    return best


def _rq_from_margins(margins: dict[int, float], handicap: int) -> dict[str, float]:
    out = {"3": 0.0, "1": 0.0, "0": 0.0}
    for margin, prob in margins.items():
        adjusted = margin + handicap
        out["3" if adjusted > 0 else "1" if adjusted == 0 else "0"] += prob
    total = sum(out.values()) or 1.0
    return {key: out[key] / total for key in OUTCOMES}


def _rq_probabilities(match: dict, spf_probabilities: dict | None) -> tuple[dict | None, dict | None]:
    """Handicap probabilities judged from the goal-margin distribution.

    Returns (blended probabilities, model-only margin probabilities).
    The model part fits a score matrix to the 胜平负 model and applies
    the fixture's real handicap line; blending with the handicap
    market's implied probabilities keeps the market's line knowledge.
    """
    if not match.get("rq_odds"):
        return None, None
    market_rq = _probabilities(match["rq_odds"])
    if spf_probabilities is None:
        return market_rq, None
    lam_home, lam_away = _fit_lambdas(spf_probabilities)
    margins = _margin_distribution(lam_home, lam_away)
    model_rq = _rq_from_margins(margins, int(match.get("handicap") or 0))
    blended = {
        key: 0.6 * model_rq[key] + 0.4 * market_rq[key] for key in OUTCOMES
    }
    total = sum(blended.values())
    return (
        {key: round(blended[key] / total, 4) for key in OUTCOMES},
        {key: round(model_rq[key], 4) for key in OUTCOMES},
    )


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

    rq_probabilities, rq_model = _rq_probabilities(match, spf_probabilities)
    row["rq"] = _market_block(match.get("rq_odds"), rq_probabilities, RQ_LABELS)
    if row["rq"] is not None and rq_model is not None:
        row["rq"]["margin_model"] = rq_model
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
