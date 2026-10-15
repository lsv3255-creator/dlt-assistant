import json
import sqlite3
import unittest
from pathlib import Path

from scripts.write_football_d1 import build_sql
from src.football.engine import build_plan, freeze_existing_recommendation, issue_fingerprint, settle, validate_issue

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
            self.assertAlmostEqual(sum(match["probabilities"].values()), 1, places=4)

    def test_multi_factor_evidence_is_complete_and_auditable(self):
        for match in self.plan["matches"]:
            self.assertEqual(match["factors"]["available"], ["market", "home_away", "ranking"])
            self.assertIn("injuries", match["factors"]["unavailable"])
            self.assertIn("uncertainty", match["factors"])
            self.assertGreater(match["home_rank"], 0)
            self.assertGreater(match["away_rank"], 0)

    def test_ranking_factor_changes_market_only_probability(self):
        first = self.plan["matches"][0]
        market = first["factors"]["components"]["market"]
        self.assertNotEqual(first["probabilities"], market)

    def test_missing_optional_rank_degrades_without_inventing_it(self):
        issue = json.loads(json.dumps(self.issue))
        issue["matches"][0].pop("home_rank")
        issue["matches"][0].pop("away_rank")
        row = build_plan(issue)["matches"][0]
        self.assertNotIn("ranking", row["factors"]["available"])
        self.assertIn("ranking", row["factors"]["unavailable"])

    def test_settlement_uses_frozen_choices(self):
        results = [row["primary"] for row in self.plan["matches"]]
        review = settle(self.plan, results)
        self.assertEqual(review["sfc_hits"], 14)
        self.assertEqual(review["ren9_hits"], 9)

    def test_review_surface_prefers_ai_narrative(self):
        script = (ROOT / "public/football.js").read_text()
        self.assertIn("sections.review ||", script)

    def test_same_issue_published_recommendation_remains_frozen(self):
        existing = json.loads((ROOT / "public/data/football/current.json").read_text())
        upgraded = freeze_existing_recommendation(json.loads(json.dumps(self.plan)), existing)
        self.assertEqual(
            [row["sfc_choices"] for row in upgraded["matches"]],
            [row["sfc_choices"] for row in existing["matches"]],
        )
        self.assertEqual(upgraded["plans"], existing["plans"])

    def test_public_page_hides_backend_metadata(self):
        page = (ROOT / "public/football.html").read_text()
        script = (ROOT / "public/football.js").read_text()
        for forbidden in ("DLT_AI_MODEL", "generated_at", "identity_hash", "checked_at"):
            self.assertNotIn(forbidden, page + script)

    def test_frontend_prefers_d1_api_and_keeps_static_fallback(self):
        script = (ROOT / "public/football.js").read_text()
        self.assertIn("/api/football-current", script)
        self.assertIn("./data/football/current.json", script)

    def test_current_only_d1_snapshot_executes(self):
        public_plan = json.loads(json.dumps(self.plan))
        public_plan.pop("identity_hash")
        public_plan["ai"] = {"status": "pending", "title": "待更新", "sections": {}}
        public_plan["review"] = {"status": "pending"}
        migration = (ROOT / "migrations/0002_football_current.sql").read_text()
        connection = sqlite3.connect(":memory:")
        connection.executescript(migration)
        connection.executescript(build_sql(public_plan))
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM football_current_matches").fetchone()[0], 14)
        self.assertEqual(connection.execute("SELECT issue FROM football_current_snapshot").fetchone()[0], "26143")

        next_plan = json.loads(json.dumps(public_plan))
        next_plan["issue"] = "26144"
        connection.executescript(build_sql(next_plan))
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM football_current_matches").fetchone()[0], 14)
        self.assertEqual(connection.execute("SELECT DISTINCT issue FROM football_current_matches").fetchone()[0], "26144")

    def test_no_football_results_history_table_is_created(self):
        migration = (ROOT / "migrations/0002_football_current.sql").read_text().lower()
        self.assertNotIn("football_results", migration)
        self.assertNotIn("score_history", migration)

    def test_api_only_returns_customer_safe_snapshot(self):
        api = (ROOT / "functions/api/football-current.ts").read_text()
        self.assertIn("SELECT public_payload", api)
        self.assertNotIn("updated_at FROM", api)
        self.assertNotIn("identity_hash", api)

    def test_dlt_workflow_is_not_modified_by_football_workflow(self):
        football = (ROOT / ".github/workflows/football-analysis.yml").read_text()
        self.assertNotIn("src.scheduler", football)
        self.assertNotIn("published_recommendations.json", football)
        self.assertIn("migrations/0002_football_current.sql", football)
        self.assertIn("scripts/write_football_d1.py", football)


if __name__ == "__main__":
    unittest.main()

