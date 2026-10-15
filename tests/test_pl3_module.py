"""Phase 17: pailie 3 （排列三） module tests."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.pl3 import scraper, stats  # noqa: E402

FIXTURE_XML = """<?xml version="1.0" encoding="utf-8"?>
<xml>
   <row expect="26274" opencode="3,6,1" opentime="2026-10-15 21:25:00" updatetime="2026-10-15 21:29:14"/>
   <row expect="04001" opencode="1,9,2" opentime="2004-11-14 21:25:00" updatetime="2004-11-14 21:29:00"/>
</xml>
"""


def _rows(count=150):
    return [
        {
            "issue": f"{26001 + i:05d}",
            "date": "2026-06-01",
            "digits": [(i * 3) % 10, (i * 7 + 1) % 10, (i * 9 + 2) % 10],
        }
        for i in range(count)
    ]


class Pl3ScraperTests(unittest.TestCase):
    def test_parse_feed(self):
        rows = scraper._parse_feed(FIXTURE_XML)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], {"issue": "04001", "date": "2004-11-14", "digits": [1, 9, 2]})
        self.assertEqual(rows[1]["digits"], [3, 6, 1])
        self.assertEqual(scraper.validate(rows), [])

    def test_validate_rejects_bad(self):
        bad = [{"issue": "26274", "date": "2026-10-15", "digits": [1, 2, 10]}]
        errors = scraper.validate(bad)
        self.assertTrue(errors and "号码范围" in errors[0][1])


class Pl3StatsTests(unittest.TestCase):
    def test_next_target_daily_and_rollover(self):
        target = stats.next_target({"issue": "26274", "date": "2026-10-15"})
        self.assertEqual(target, {"issue": "26275", "date": "2026-10-16"})
        rollover = stats.next_target({"issue": "26365", "date": "2026-12-31"})
        self.assertEqual(rollover, {"issue": "27001", "date": "2027-01-01"})

    def test_picks_deterministic_and_legal(self):
        rows = _rows()
        first = stats.generate_picks("26275", rows)
        second = stats.generate_picks("26275", rows)
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
