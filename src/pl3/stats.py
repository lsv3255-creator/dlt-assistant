"""Pailie 3 statistics and entertainment picks (mirrors the SSQ mode).

3D is a positional game: statistics are per position （百/十/个位） —
frequency and omission for digits 0-9 — plus the sum （和值）
distribution. Picks follow the same three deterministic strategies
as the other lotteries and are locked with INSERT OR IGNORE:

- A-均衡统计型： per-position balanced score (freq100 + omission bonus).
- B-冷热组合型： hottest digit, coldest digit, balanced digit by position.
- C-纯随机娱乐型： seeded RNG (seed = target issue).
"""
from __future__ import annotations

import datetime
import random

DIGITS = range(10)
POSITIONS = 3


def _empty() -> list[dict[int, int]]:
    return [{d: 0 for d in DIGITS} for _ in range(POSITIONS)]


def frequency(rows: list[dict], window: int | None = None) -> dict:
    """Per-position digit frequency over the latest ``window`` draws."""
    sample = rows[-window:] if window else rows
    per_position = _empty()
    for row in sample:
        for pos, digit in enumerate(row["digits"]):
            per_position[pos][digit] += 1
    return {"per_position": per_position, "sample": len(sample)}


def omission(rows: list[dict]) -> list[dict[int, int]]:
    """Draws since each digit last appeared, per position."""
    result = [{d: len(rows) for d in DIGITS} for _ in range(POSITIONS)]
    for idx, row in enumerate(reversed(rows)):
        for pos, digit in enumerate(row["digits"]):
            if result[pos][digit] == len(rows):
                result[pos][digit] = idx
    return result


def sum_distribution(rows: list[dict], window: int | None = None) -> dict[int, int]:
    sample = rows[-window:] if window else rows
    dist = {total: 0 for total in range(28)}
    for row in sample:
        dist[sum(row["digits"])] += 1
    return dist


def summarize(rows: list[dict]) -> dict:
    freq_100 = frequency(rows, 100)
    omit = omission(rows)
    hot, cold = [], []
    for pos in range(POSITIONS):
        hot.append(max(DIGITS, key=lambda d: (freq_100["per_position"][pos][d], -d)))
        cold.append(max(DIGITS, key=lambda d: (omit[pos][d], -d)))
    dist = sum_distribution(rows, 100)
    common_sum = max(range(28), key=lambda t: (dist[t], -t))
    return {
        "total_draws": len(rows),
        "frequency_100": freq_100,
        "omission": omit,
        "hot": hot,
        "cold": cold,
        "common_sum_100": common_sum,
    }


def next_target(latest: dict) -> dict:
    """Next draw (daily): next calendar day, issue +1 or year rollover."""
    day = datetime.date.fromisoformat(latest["date"]) + datetime.timedelta(days=1)
    if day.year != int(latest["date"][:4]):
        issue = f"{day.year % 100:02d}001"
    else:
        issue = f"{int(latest['issue']) + 1:05d}"
    return {"issue": issue, "date": day.isoformat()}


def generate_picks(target_issue: str, rows: list[dict]) -> list[dict]:
    """Three deterministic strategy picks for ``target_issue``."""
    if len(rows) < 100:
        raise ValueError("need at least 100 draws for statistics picks")
    freq_100 = frequency(rows, 100)
    omit = omission(rows)

    def balanced(pos: int) -> int:
        return max(
            DIGITS,
            key=lambda d: (
                freq_100["per_position"][pos][d] + min(omit[pos][d], 20) * 0.3,
                -d,
            ),
        )

    def hottest(pos: int) -> int:
        return max(DIGITS, key=lambda d: (freq_100["per_position"][pos][d], -d))

    def coldest(pos: int) -> int:
        return max(DIGITS, key=lambda d: (omit[pos][d], -d))

    picks_a = [balanced(pos) for pos in range(POSITIONS)]
    picks_b = [hottest(0), coldest(1), balanced(2)]
    rng = random.Random(f"pl3-{target_issue}")
    picks_c = [rng.choice(list(DIGITS)) for _ in range(POSITIONS)]
    return [
        {"strategy": "A-均衡统计型", "digits": picks_a},
        {"strategy": "B-冷热组合型", "digits": picks_b},
        {"strategy": "C-纯随机娱乐型", "digits": picks_c},
    ]


def position_scores(rows: list[dict]) -> list[dict]:
    """Balanced score per digit for each position."""
    freq_100 = frequency(rows, 100)
    omit = omission(rows)
    return [
        {
            d: freq_100["per_position"][pos][d] + min(omit[pos][d], 20) * 0.3
            for d in DIGITS
        }
        for pos in range(POSITIONS)
    ]


def generate_plans(target_issue: str, rows: list[dict], picks: list[dict]) -> list[dict]:
    """Single + compound plans (DLT homepage parity).

    - single: the A-strategy direct pick with per-position score basis.
    - combo: top-3 scored digits per position as a direct compound
      (3^3 = 27 bets, 54 yuan), plus the group-play reading of A.
    """
    scores = position_scores(rows)
    freq_100 = frequency(rows, 100)
    omit = omission(rows)
    pick_a = picks[0]
    single = {
        "digits": pick_a["digits"],
        "basis": [
            {
                "position": pos,
                "digit": pick_a["digits"][pos],
                "freq100": freq_100["per_position"][pos][pick_a["digits"][pos]],
                "omission": omit[pos][pick_a["digits"][pos]],
                "score": round(scores[pos][pick_a["digits"][pos]], 1),
            }
            for pos in range(POSITIONS)
        ],
    }
    pools = [
        sorted(
            sorted(DIGITS, key=lambda d: (-scores[pos][d], d))[:3]
        )
        for pos in range(POSITIONS)
    ]
    bets = 1
    for pool in pools:
        bets *= len(pool)
    unique = sorted(set(pick_a["digits"]))
    group_type = "组三" if len(unique) == 2 else ("豹子" if len(unique) == 1 else "组六")
    combo = {
        "pools": pools,
        "bets": bets,
        "cost_yuan": bets * 2,
        "group_play": {"type": group_type, "digits": unique},
    }
    return [
        {"kind": "single", "payload": single},
        {"kind": "combo", "payload": combo},
    ]
