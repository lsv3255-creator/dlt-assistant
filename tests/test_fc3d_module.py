"""Phase 16: fucai 3D （福彩3D） module tests."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.fc3d import scraper, stats  # noqa: E402

FIXTURE_XML = """<?xml version="1.0" encoding="utf-8"?>
<xml>
   <row expect="2026274" opencode="8,2,3" opentime="2026-10-15 21:15:00" trycode="8,8,6" tryinfo="" updatetime="2026-10-15 21:30:46"/>
   <row expect="2004001" opencode="0,7,0" opentime="2004-10-18 21:15:00" trycode="1,2,3" tryinfo="" updatetime="2004-10-18 21:30:00"/>
</xml>
"""


def _rows(count=150):
    return [
        {
            "issue": f"{2026001 + i:07d}",
            "date": "2026-06-01",
            "digits": [(i * 3) % 10, (i * 7 + 1) % 10, (i * 9 + 2) % 10],
        }
        for i in range(count)
    ]


class Fc3dScraperTests(unittest.TestCase):
    def test_parse_feed(self):
        rows = scraper._parse_feed(FIXTURE_XML)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], {"issue": "2004001", "date": "2004-10-18", "digits": [0, 7, 0], "trycode": [1, 2, 3]})
        self.assertEqual(rows[1]["digits"], [8, 2, 3])
        self.assertEqual(scraper.validate(rows), [])

    def test_validate_rejects_bad(self):
        bad = [{"issue": "2026274", "date": "2026-10-15", "digits": [1, 2, 10]}]
        errors = scraper.validate(bad)
        self.assertTrue(errors and "号码范围" in errors[0][1])


class Fc3dStatsTests(unittest.TestCase):
    def test_next_target_daily_and_rollover(self):
        target = stats.next_target({"issue": "2026274", "date": "2026-10-15"})
        self.assertEqual(target, {"issue": "2026275", "date": "2026-10-16"})
        rollover = stats.next_target({"issue": "2026359", "date": "2026-12-31"})
        self.assertEqual(rollover, {"issue": "2027001", "date": "2027-01-01"})

    def test_picks_deterministic_and_legal(self):
        rows = _rows()
        first = stats.generate_picks("2026275", rows)
        second = stats.generate_picks("2026275", rows)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 3)
        for pick in first:
            self.assertEqual(len(pick["digits"]), 3)
            self.assertTrue(all(0 <= d <= 9 for d in pick["digits"]))

    def test_summarize(self):
        rows = _rows(120)
        summary = stats.summarize(rows)
        self.assertEqual(summary["total_draws"], 120)
        for pos in range(3):
            self.assertEqual(
                sum(summary["frequency_100"]["per_position"][pos].values()), 100
            )
        self.assertTrue(0 <= summary["common_sum_100"] <= 27)


if __name__ == "__main__":
    unittest.main()


class Fc3dPlansAnalysisTests(unittest.TestCase):
    def test_plans_and_analysis(self):
        from src.fc3d import analysis

        rows = _rows()
        picks = stats.generate_picks("2026275", rows)
        plans = stats.generate_plans("2026275", rows, picks)
        by_kind = {p["kind"]: p["payload"] for p in plans}
        self.assertEqual(by_kind["single"]["digits"], picks[0]["digits"])
        self.assertEqual(by_kind["combo"]["bets"], 27)
        self.assertEqual(by_kind["combo"]["cost_yuan"], 54)
        self.assertIn(by_kind["combo"]["group_play"]["type"], ("组三", "组六", "豹子"))
        report = analysis.build_analysis(
            rows, picks, {"issue": "2026275", "date": "2026-10-16"}
        )
        self.assertEqual(
            set(report["sections"]),
            {"trend", "hot_cold", "structure", "basis", "risk"},
        )
        self.assertEqual(analysis.draw_form([5, 5, 5]), "豹子")
        self.assertEqual(analysis.draw_form([5, 5, 2]), "组三")
        self.assertEqual(analysis.draw_form([5, 4, 2]), "组六")
