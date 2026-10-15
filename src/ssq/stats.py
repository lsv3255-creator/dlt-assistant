"""Shuangseqiu statistics and entertainment picks (mirrors DLT mode).

Statistics are computed from the stored draw history: all-time and
last-100 frequency, current omission (draws since last appearance),
and hot/cold tags. Picks follow the DLT three-strategy pattern and
are deterministic per target issue, then locked in D1 with
INSERT OR IGNORE (first write wins, exactly like dlt_recommendations):

- A-均衡统计型： balanced scores (last-100 frequency + moderate omission)
  spread across the three red zones.
- B-冷热组合型： hot numbers mixed with high-omission cold numbers.
- C-纯随机娱乐型： seeded RNG sample (seed = target issue).
"""
from __future__ import annotations

import datetime
import random

RED_RANGE = range(1, 34)
BLUE_RANGE = range(1, 17)
DRAW_WEEKDAYS = {1, 3, 6}  # Tue / Thu / Sun


def frequency(rows: list[dict], window: int | None = None) -> dict:
    """Ball frequency over the latest ``window`` draws (None = all)."""
    sample = rows[-window:] if window else rows
    red = {n: 0 for n in RED_RANGE}
    blue = {n: 0 for n in BLUE_RANGE}
    for row in sample:
        for n in row["red"]:
            red[n] += 1
        blue[row["blue"]] += 1
    return {"red": red, "blue": blue, "sample": len(sample)}


def omission(rows: list[dict]) -> dict:
    """Draws since each ball last appeared (len(rows) if never)."""
    red = {n: len(rows) for n in RED_RANGE}
    blue = {n: len(rows) for n in BLUE_RANGE}
    for idx, row in enumerate(reversed(rows)):
        for n in row["red"]:
            if red[n] == len(rows):
                red[n] = idx
        if blue[row["blue"]] == len(rows):
            blue[row["blue"]] = idx
    return {"red": red, "blue": blue}


def summarize(rows: list[dict]) -> dict:
    """Compact statistics bundle used by the API and the page."""
    freq_all = frequency(rows)
    freq_100 = frequency(rows, 100)
    omit = omission(rows)
    hot_red = sorted(RED_RANGE, key=lambda n: (-freq_100["red"][n], n))[:6]
    cold_red = sorted(RED_RANGE, key=lambda n: (-omit["red"][n], n))[:6]
    hot_blue = sorted(BLUE_RANGE, key=lambda n: (-freq_100["blue"][n], n))[:3]
    cold_blue = sorted(BLUE_RANGE, key=lambda n: (-omit["blue"][n], n))[:3]
    return {
        "total_draws": len(rows),
        "frequency_all": freq_all,
        "frequency_100": freq_100,
        "omission": omit,
        "hot": {"red": hot_red, "blue": hot_blue},
        "cold": {"red": cold_red, "blue": cold_blue},
    }


def next_target(latest: dict) -> dict:
    """Next draw's issue and date after ``latest`` (Tue/Thu/Sun)."""
    day = datetime.date.fromisoformat(latest["date"]) + datetime.timedelta(days=1)
    while day.weekday() not in DRAW_WEEKDAYS:
        day += datetime.timedelta(days=1)
    if day.year != int(latest["date"][:4]):
        issue = f"{day.year % 100:02d}001"
    else:
        issue = f"{int(latest['issue']) + 1:05d}"
    return {"issue": issue, "date": day.isoformat()}


def _zone(number: int) -> int:
    return 0 if number <= 11 else (1 if number <= 22 else 2)


def generate_picks(target_issue: str, rows: list[dict]) -> list[dict]:
    """Three deterministic strategy picks for ``target_issue``."""
    if len(rows) < 100:
        raise ValueError("need at least 100 draws for statistics picks")
    freq_100 = frequency(rows, 100)
    omit = omission(rows)

    # A-均衡统计型： score = freq100 + omission bonus, two per zone.
    scored = {
        n: freq_100["red"][n] + min(omit["red"][n], 20) * 0.3 for n in RED_RANGE
    }
    reds_a: list[int] = []
    for zone in range(3):
        in_zone = [n for n in RED_RANGE if _zone(n) == zone]
        in_zone.sort(key=lambda n: (-scored[n], n))
        reds_a.extend(in_zone[:2])
    blue_a = max(BLUE_RANGE, key=lambda n: (freq_100["blue"][n], -n))

    # B-冷热组合型： 3 hot + 2 cold + 1 best-omission blue pairing.
    hot = sorted(RED_RANGE, key=lambda n: (-freq_100["red"][n], n))[:3]
    cold = [
        n
        for n in sorted(RED_RANGE, key=lambda n: (-omit["red"][n], n))
        if n not in hot
    ][:2]
    mid = [
        n
        for n in sorted(RED_RANGE, key=lambda n: (-scored[n], n))
        if n not in hot and n not in cold
    ][:1]
    reds_b = hot + cold + mid
    blue_b = max(
        (n for n in BLUE_RANGE if n != blue_a),
        key=lambda n: (omit["blue"][n], -n),
    )

    # C-纯随机娱乐型： seeded by target issue (reproducible).
    rng = random.Random(f"ssq-{target_issue}")
    reds_c = sorted(rng.sample(list(RED_RANGE), 6))
    blue_c = rng.choice(list(BLUE_RANGE))

    return [
        {"strategy": "A-均衡统计型", "red": sorted(reds_a), "blue": blue_a},
        {"strategy": "B-冷热组合型", "red": sorted(reds_b), "blue": blue_b},
        {"strategy": "C-纯随机娱乐型", "red": reds_c, "blue": blue_c},
    ]
