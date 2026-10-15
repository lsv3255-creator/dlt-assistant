import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.write_football_d1 import build_sql
from scripts.check_football_production import validate_football_payload
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

    def test_d1_sql_uses_remote_compatible_publish_last_order(self):
        public_plan = json.loads(json.dumps(self.plan))
        public_plan.pop("identity_hash")
        public_plan["ai"] = {"status": "pending", "title": "待更新", "sections": {}}
        public_plan["review"] = {"status": "pending"}
        sql = build_sql(public_plan)
        self.assertNotIn("BEGIN TRANSACTION", sql)
        self.assertNotIn("COMMIT;", sql)
        self.assertLess(sql.index("INSERT INTO football_current_matches"), sql.index("INSERT INTO football_current_snapshot"))

    def test_no_football_results_history_table_is_created(self):
        migration = (ROOT / "migrations/0002_football_current.sql").read_text().lower()
        self.assertNotIn("football_results", migration)
        self.assertNotIn("score_history", migration)

    def test_api_only_returns_customer_safe_snapshot(self):
        api = (ROOT / "functions/api/football-current.ts").read_text()
        self.assertIn("SELECT public_payload", api)
        self.assertNotIn("updated_at FROM", api)
        self.assertNotIn("identity_hash", api)

    def test_production_smoke_contract_accepts_public_snapshot(self):
        public = json.loads((ROOT / "public/data/football/current.json").read_text())
        public["ai"]["status"] = "completed"
        validate_football_payload(public)

    def test_production_smoke_rejects_backend_metadata(self):
        public = json.loads((ROOT / "public/data/football/current.json").read_text())
        public["ai"]["status"] = "completed"
        public["identity_hash"] = "hidden"
        with self.assertRaises(ValueError):
            validate_football_payload(public)

    def test_dlt_workflow_is_not_modified_by_football_workflow(self):
        football = (ROOT / ".github/workflows/football-analysis.yml").read_text()
        self.assertNotIn("src.scheduler", football)
        self.assertNotIn("published_recommendations.json", football)
        self.assertIn("migrations/0002_football_current.sql", football)
        self.assertIn("scripts/write_football_d1.py", football)


if __name__ == "__main__":
    unittest.main()




# --- Phase 13: okooo auto-discovery fixtures ---------------------------------
from unittest import mock

from src.football import discovery

_FULL_TO_SHORT = {v: k for k, v in discovery.TEAM_NAME_FIXES.items()}


def _okooo_fixture(issue: dict, marker_issue: int) -> str:
    """Build an okooo-like issue page from a curated issue dict."""
    tabs = " ".join(
        f"{n}期(当前)" if n == marker_issue else f"{n}期"
        for n in (int(issue["issue"]) - 1, int(issue["issue"]), int(issue["issue"]) + 1)
    )
    sale_end = issue["sale_end"]
    rows = []
    for m in issue["matches"]:
        kickoff = m["kickoff"][5:10] + " " + m["kickoff"][11:16]
        rows.append(
            "<tr><td>{order}</td><td>{league}</td><td>{kickoff}</td>"
            "<td>{home}[{hr}]</td><td>{o3}</td><td>{o1}</td><td>{o0}</td>"
            "<td>{away}[{ar}]</td><td>析情</td></tr>".format(
                order=m["order"], league=m["league"], kickoff=kickoff,
                home=_FULL_TO_SHORT.get(m["home"], m["home"]), hr=m["home_rank"],
                away=_FULL_TO_SHORT.get(m["away"], m["away"]), ar=m["away_rank"],
                o3=f"{m['odds']['3']:.2f}", o1=f"{m['odds']['1']:.2f}", o0=f"{m['odds']['0']:.2f}",
            )
        )
    filler = "<p>澳客网足彩数据</p>" * 60
    return (
        "<html><body><div>" + tabs + "</div>"
        f"<div>停售时间：{sale_end[5:10]}(周五){sale_end[11:16]}</div>"
        + filler
        + "<table>" + "".join(rows) + "</table></body></html>"
    )


class FootballDiscoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.issue = json.loads((ROOT / "data/football/current_issue.json").read_text())
        cls.now = discovery.datetime(2026, 10, 15, 12, 0, tzinfo=discovery.BJ)

    def test_marker_found_and_missing(self):
        html = _okooo_fixture(self.issue, int(self.issue["issue"]))
        text = discovery.BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
        self.assertEqual(discovery.current_issue_marker(text), int(self.issue["issue"]))
        with self.assertRaises(discovery.DiscoveryError):
            discovery.current_issue_marker("没有当前标记")

    def test_parse_roundtrip_matches_curated_issue(self):
        html = _okooo_fixture(self.issue, int(self.issue["issue"]))
        parsed = discovery.parse_issue_page(html, int(self.issue["issue"]), self.now)
        validate_issue(parsed)
        self.assertEqual(parsed["matches"], self.issue["matches"])
        self.assertEqual(parsed["sale_end"], self.issue["sale_end"])
        self.assertEqual(parsed["draw_date"], self.issue["draw_date"])

    def test_refresh_same_issue_is_unchanged(self):
        html = _okooo_fixture(self.issue, int(self.issue["issue"]))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "current_issue.json"
            path.write_text(json.dumps(self.issue, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(discovery, "_fetch", return_value=html):
                status, issue = discovery.refresh_issue_file(path, self.now)
            self.assertEqual((status, issue), ("unchanged", self.issue["issue"]))

    def test_refresh_switches_to_next_issue_and_freezes_scope(self):
        current_no = int(self.issue["issue"])
        nxt = json.loads(json.dumps(self.issue))
        nxt["issue"] = str(current_no + 1)
        landing = _okooo_fixture(self.issue, current_no + 1)
        next_page = _okooo_fixture(nxt, current_no + 1)
        pages = {discovery.ISSUE_URL.format(issue=current_no): landing,
                 discovery.ISSUE_URL.format(issue=current_no + 1): next_page}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "current_issue.json"
            path.write_text(json.dumps(self.issue, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(discovery, "_fetch", side_effect=lambda url: pages[url]):
                status, issue = discovery.refresh_issue_file(path, self.now)
            self.assertEqual((status, issue), ("switched", str(current_no + 1)))
            written = json.loads(path.read_text())
            validate_issue(written)
            self.assertEqual(len(written["matches"]), 14)

    def test_refresh_failure_leaves_file_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "current_issue.json"
            original = json.dumps(self.issue, ensure_ascii=False)
            path.write_text(original, encoding="utf-8")
            with mock.patch.object(
                discovery, "_fetch", side_effect=discovery.DiscoveryError("WAF")
            ):
                with self.assertRaises(discovery.DiscoveryError):
                    discovery.refresh_issue_file(path, self.now)
            self.assertEqual(path.read_text(), original)
