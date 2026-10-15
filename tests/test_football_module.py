import json
import unittest
from pathlib import Path

from src.football.engine import build_plan, issue_fingerprint, settle, validate_issue

ROOT = Path(__file__).resolve().parent.parent


class FootballModuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.issue = json.loads((ROOT / "data/football/current_issue.json").read_text())
        cls.plan = build_plan(cls.issue)

    def test_issue_contract(self):
        validate_issue(self.issue)
        self.assertEqual(len(self.issue["matches"]), 14)

    def test_identity_is_stable(self):
        self.assertEqual(issue_fingerprint(self.issue), issue_fingerprint(self.issue))
        self.assertEqual(len(issue_fingerprint(self.issue)), 64)

    def test_sfc_plan_has_bounded_five_doubles(self):
        doubles = [m for m in self.plan["matches"] if len(m["sfc_choices"]) == 2]
        self.assertEqual(len(doubles), 5)
        self.assertEqual(self.plan["plans"]["sfc14"], {"lines": 32, "cost_yuan": 64})

    def test_ren9_is_exactly_nine_single_choices(self):
        orders = self.plan["plans"]["ren9"]["orders"]
        self.assertEqual(len(orders), 9)
        self.assertEqual(len(set(orders)), 9)

    def test_probabilities_are_normalized(self):
        for match in self.plan["matches"]:
            self.assertAlmostEqual(sum(match["probabilities"].values()), 1, places=3)

    def test_settlement_uses_frozen_choices(self):
        results = [row["primary"] for row in self.plan["matches"]]
        review = settle(self.plan, results)
        self.assertEqual(review["sfc_hits"], 14)
        self.assertEqual(review["ren9_hits"], 9)

    def test_public_page_hides_backend_metadata(self):
        page = (ROOT / "public/football.html").read_text()
        script = (ROOT / "public/football.js").read_text()
        for forbidden in ("DLT_AI_MODEL", "generated_at", "identity_hash", "checked_at"):
            self.assertNotIn(forbidden, page + script)

    def test_dlt_workflow_is_not_modified_by_football_workflow(self):
        football = (ROOT / ".github/workflows/football-analysis.yml").read_text()
        self.assertNotIn("src.scheduler", football)
        self.assertNotIn("published_recommendations.json", football)


if __name__ == "__main__":
    unittest.main()

