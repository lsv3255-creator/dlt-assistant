"""Phase 15: shuangseqiu （双色球） module tests."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.ssq import scraper, stats  # noqa: E402

FIXTURE_HTML = """
<table><tbody id="tdata">
<tr class="t_tr1"><td>26118</td><td class="t_cfont2">05</td><td class="t_cfont2">21</td>
<td class="t_cfont2">22</td><td class="t_cfont2">23</td><td class="t_cfont2">28</td>
<td class="t_cfont2">31</td><td class="t_cfont4">14</td><td class="t_cfont4">&nbsp;</td>
<td>958,655,708</td><td>5</td><td>8,783,740</td><td>80</td><td>295,604</td>
<td>340,890,776</td><td>2026-10-15</td></tr>
<tr class="t_tr1"><td>03001</td><td class="t_cfont2">10</td><td class="t_cfont2">11</td>
<td class="t_cfont2">12</td><td class="t_cfont2">13</td><td class="t_cfont2">26</td>
<td class="t_cfont2">28</td><td class="t_cfont4">11</td><td class="t_cfont4">10&nbsp;</td>
<td>2,097,070</td><td>0</td><td>0</td><td>1</td><td>898,744</td>
<td>10,307,806</td><td>2003-02-23</td></tr>
</tbody></table>
"""


def _rows(count=150):
    rows = []
    for i in range(count):
        reds = sorted(((i * 7 + j * 3) % 33) + 1 for j in range(6))
        while len(set(reds)) != 6:
            reds = sorted(set(reds) | {(reds[0] + 1) % 33 + 1})
        rows.append(
            {
                "issue": f"{10001 + i:05d}",
                "date": "2026-01-01",
                "red": reds,
                "blue": (i % 16) + 1,
            }
        )
    return rows


class SsqScraperTests(unittest.TestCase):
    def test_parse_rows_including_legacy_layout(self):
        rows = scraper._parse_rows(FIXTURE_HTML)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["issue"], "26118")
        self.assertEqual(rows[0]["red"], [5, 21, 22, 23, 28, 31])
        self.assertEqual(rows[0]["blue"], 14)
        self.assertEqual(rows[0]["date"], "2026-10-15")
        # Legacy row: the second blue cell is a promotional column and
        # must not replace the real blue ball.
        self.assertEqual(rows[1]["blue"], 11)
        self.assertEqual(scraper.validate(rows), [])

    def test_validate_rejects_bad_balls(self):
        bad = [{"issue": "26118", "date": "2026-10-15", "red": [1, 2, 3, 4, 5, 34], "blue": 17}]
        errors = scraper.validate(bad)
        self.assertTrue(errors and "红球范围" in errors[0][1])


    def test_detail_announcement_parsed(self):
        rows = scraper._parse_rows(FIXTURE_HTML)
        self.assertEqual(
            rows[0]["detail"],
            {
                "pool": 958655708,
                "first_count": 5,
                "first_prize": 8783740,
                "second_count": 80,
                "second_prize": 295604,
                "sales": 340890776,
            },
        )
        # Legacy 2003 row layout: no reliable detail, must not fake one.
        self.assertNotIn("detail", rows[1])


class SsqStatsTests(unittest.TestCase):
    def test_next_target_draw_days(self):
        # 2026-10-15 is a Thursday draw; next is Sunday 2026-10-18.
        target = stats.next_target({"issue": "26118", "date": "2026-10-15"})
        self.assertEqual(target, {"issue": "26119", "date": "2026-10-18"})

    def test_next_target_year_rollover(self):
        target = stats.next_target({"issue": "25154", "date": "2025-12-30"})
        self.assertEqual(target["issue"], "26001")
        self.assertEqual(target["date"], "2026-01-01")

    def test_picks_are_deterministic_and_legal(self):
        rows = _rows()
        first = stats.generate_picks("26119", rows)
        second = stats.generate_picks("26119", rows)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 3)
        for pick in first:
            self.assertEqual(len(pick["red"]), 6)
            self.assertEqual(len(set(pick["red"])), 6)
            self.assertTrue(all(1 <= n <= 33 for n in pick["red"]))
            self.assertTrue(1 <= pick["blue"] <= 16)

    def test_summarize_counts(self):
        rows = _rows(120)
        summary = stats.summarize(rows)
        self.assertEqual(summary["total_draws"], 120)
        self.assertEqual(summary["frequency_100"]["sample"], 100)
        self.assertEqual(sum(summary["frequency_all"]["red"].values()), 120 * 6)

    def test_plans_single_matches_strategy_a(self):
        from src.ssq import analysis

        rows = _rows()
        picks = stats.generate_picks("26119", rows)
        plans = stats.generate_plans("26119", rows, picks)
        by_kind = {p["kind"]: p["payload"] for p in plans}
        self.assertEqual(by_kind["single"]["red"], picks[0]["red"])
        self.assertEqual(by_kind["single"]["blue"], picks[0]["blue"])
        self.assertEqual(len(by_kind["combo"]["red_pool"]), 8)
        self.assertEqual(len(by_kind["combo"]["blue_pool"]), 2)
        self.assertEqual(by_kind["combo"]["bets"], 56)
        self.assertEqual(by_kind["combo"]["cost_yuan"], 112)
        report = analysis.build_analysis(
            rows, picks, {"issue": "26119", "date": "2026-10-18"}
        )
        self.assertEqual(
            set(report["sections"]),
            {"trend", "hot_cold", "structure", "basis", "risk"},
        )
        self.assertIn(rows[-1]["issue"], report["sections"]["trend"])


if __name__ == "__main__":
    unittest.main()
