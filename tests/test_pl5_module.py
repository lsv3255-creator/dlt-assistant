"""Phase 18: pailie 5 （排列五） module tests + 排列三共用源派生用例."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.pl5 import scraper, stats  # noqa: E402
from src.pl3 import scraper as pl3_scraper  # noqa: E402

FIXTURE_XML = """<?xml version="1.0" encoding="utf-8"?>
<xml>
   <row expect="26274" opencode="3,6,1,9,5" opentime="2026-10-15 21:25:00" updatetime="2026-10-15 21:29:14"/>
   <row expect="04001" opencode="9,2,8,8,2" opentime="2004-11-14 21:25:00" updatetime="2004-11-14 21:29:00"/>
</xml>
"""


def _rows(count=150):
    return [
        {
            "issue": f"{26001 + i:05d}",
            "date": "2026-06-01",
            "digits": [(i * 3) % 10, (i * 7 + 1) % 10, (i * 9 + 2) % 10, (i * 5 + 3) % 10, (i * 11 + 4) % 10],
        }
        for i in range(count)
    ]


class Pl5ScraperTests(unittest.TestCase):
    def test_parse_feed(self):
        rows = scraper._parse_feed(FIXTURE_XML)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], {"issue": "04001", "date": "2004-11-14", "digits": [9, 2, 8, 8, 2]})
        self.assertEqual(rows[1]["digits"], [3, 6, 1, 9, 5])
        self.assertEqual(scraper.validate(rows), [])

    def test_pl3_derivation_matches_shared_era(self):
        # Plan B: for issues >= 04021 the pl3 row is pl5's first three.
        rows5 = scraper._parse_feed(FIXTURE_XML)
        derived = [
            {"issue": r["issue"], "date": r["date"], "digits": r["digits"][:3]}
            for r in rows5 if int(r["issue"]) >= 4021
        ]
        self.assertEqual(len(derived), 1)
        self.assertEqual(derived[0]["digits"], [3, 6, 1])
        self.assertEqual(pl3_scraper.validate(derived), [])


class Pl5StatsTests(unittest.TestCase):
    def test_next_target(self):
        self.assertEqual(
            stats.next_target({"issue": "26274", "date": "2026-10-15"}),
            {"issue": "26275", "date": "2026-10-16"},
        )
        self.assertEqual(
            stats.next_target({"issue": "26365", "date": "2026-12-31"}),
            {"issue": "27001", "date": "2027-01-01"},
        )

    def test_picks_deterministic_and_legal(self):
        rows = _rows()
        first = stats.generate_picks("26275", rows)
        second = stats.generate_picks("26275", rows)
        self.assertEqual(first, second)
        for pick in first:
            self.assertEqual(len(pick["digits"]), 5)
            self.assertTrue(all(0 <= d <= 9 for d in pick["digits"]))

    def test_summarize(self):
        summary = stats.summarize(_rows(120))
        self.assertEqual(summary["total_draws"], 120)
        self.assertEqual(len(summary["hot"]), 5)
        for pos in range(5):
            self.assertEqual(
                sum(summary["frequency_100"]["per_position"][pos].values()), 100
            )
        self.assertTrue(0 <= summary["common_sum_100"] <= 45)


if __name__ == "__main__":
    unittest.main()
