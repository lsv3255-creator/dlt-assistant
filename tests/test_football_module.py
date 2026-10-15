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


def _okooo_fixture(issue: dict) -> str:
    """Build an okooo-like issue page (real row layout) from an issue dict."""
    current_no = int(issue["issue"])
    tabs = "".join(
        f'<a href="/zucai/{n}/" class="jsQihaoTab">{n}期</a>'
        for n in (current_no - 1, current_no, current_no + 1, current_no + 2)
    )
    sale_end = issue["sale_end"]
    rows = []
    for m in issue["matches"]:
        kickoff = m["kickoff"][5:10] + " " + m["kickoff"][11:16]
        rows.append(
            "<tr><td>{order}</td><td>{league}</td><td>{kickoff}</td>"
            "<td><i>[{hr}]</i><em>{o3:.2f}</em><span>{home}</span>"
            "<em>{o1:.2f}</em><i>[{ar}]</i><em>{o0:.2f}</em><span>{away}</span></td>"
            "<td><a href=\"/soccer/match/{mid}/history/\">析</a>"
            "<a href=\"/soccer/match/{mid}/qingbao/\">情</a></td></tr>".format(
                order=m["order"], league=m["league"], kickoff=kickoff,
                home=_FULL_TO_SHORT.get(m["home"], m["home"]), hr=m["home_rank"],
                away=_FULL_TO_SHORT.get(m["away"], m["away"]), ar=m["away_rank"],
                o3=m["odds"]["3"], o1=m["odds"]["1"], o0=m["odds"]["0"], mid=1000 + m["order"],
            )
        )
    filler = "<p>澳客网足彩数据</p>" * 60
    return (
        "<html><body><div>" + tabs + "</div>"
        f'<div class="overTime">截止时间:<em> {sale_end[5:10]}(周五) {sale_end[11:16]}</em></div>'
        + filler
        + "<table>" + "".join(rows) + "</table></body></html>"
    )


class FootballDiscoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.issue = json.loads((ROOT / "data/football/current_issue.json").read_text())
        cls.now = discovery.datetime(2026, 10, 15, 12, 0, tzinfo=discovery.BJ)

    def test_tabs_listed(self):
        html = _okooo_fixture(self.issue)
        tabs = discovery.tabulated_issues(html)
        self.assertIn(int(self.issue["issue"]), tabs)
        self.assertEqual(tabs, sorted(tabs))

    def test_parse_roundtrip_matches_curated_issue(self):
        html = _okooo_fixture(self.issue)
        parsed = discovery.parse_issue_page(html, int(self.issue["issue"]), self.now)
        validate_issue(parsed)
        self.assertTrue(all(m.get("okooo_match_id") for m in parsed["matches"]))
        stripped = [{k: v for k, v in m.items() if k != "okooo_match_id"} for m in parsed["matches"]]
        self.assertEqual(stripped, self.issue["matches"])
        self.assertEqual(parsed["sale_end"], self.issue["sale_end"])
        self.assertEqual(parsed["draw_date"], self.issue["draw_date"])

    def test_refresh_same_issue_is_unchanged(self):
        current_no = int(self.issue["issue"])
        pages = {discovery.ISSUE_URL.format(issue=current_no): _okooo_fixture(self.issue)}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "current_issue.json"
            path.write_text(json.dumps(self.issue, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(discovery, "_fetch", side_effect=lambda url: pages[url]):
                # First pass only adds okooo match ids to the curated file.
                first, _ = discovery.refresh_issue_file(path, self.now)
                self.assertEqual(first, "refreshed")
                written = json.loads(path.read_text())
                self.assertTrue(all(m.get("okooo_match_id") for m in written["matches"]))
                # Second pass with identical source data changes nothing.
                status, issue = discovery.refresh_issue_file(path, self.now)
            self.assertEqual((status, issue), ("unchanged", self.issue["issue"]))

    def test_refresh_switches_after_deadline_passes(self):
        current_no = int(self.issue["issue"])
        closed = json.loads(json.dumps(self.issue))
        closed["sale_end"] = "2026-10-14T22:00:00+08:00"
        nxt = json.loads(json.dumps(self.issue))
        nxt["issue"] = str(current_no + 1)
        nxt["sale_end"] = "2026-10-18T22:00:00+08:00"
        pages = {
            discovery.ISSUE_URL.format(issue=current_no): _okooo_fixture(closed),
            discovery.ISSUE_URL.format(issue=current_no + 1): _okooo_fixture(nxt),
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "current_issue.json"
            path.write_text(json.dumps(self.issue, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(discovery, "_fetch", side_effect=lambda url: pages[url]):
                status, issue = discovery.refresh_issue_file(path, self.now)
            self.assertEqual((status, issue), ("switched", str(current_no + 1)))
            written = json.loads(path.read_text())
            validate_issue(written)
            self.assertEqual(written["sale_end"], "2026-10-18T22:00:00+08:00")
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


# --- Phase 13 step 2: team dynamics & archive --------------------------------
from src.football import dynamics


def _history_fixture() -> str:
    def team_table(name: str, rows: list[tuple]) -> str:
        body = "".join(
            f"<tr><td>联赛 {i}</td><td>26-10-14 {date} 02:45</td><td>{home}</td>"
            f"<td>{score}</td><td>{away}</td><td>1-0</td><td>1.60</td></tr>"
            for i, (date, home, score, away) in enumerate(rows)
        )
        return (
            f"<table><tr><td>{name} 全赛事 本赛事</td></tr>"
            "<tr><td>联赛</td><td>时间</td><td>主队</td><td>比分</td><td>客队</td><td>半场</td></tr>"
            + body + "</table>"
        )

    home_rows = [("2026-10-14", "主队甲", "2-0", "对手丙"), ("2026-10-10", "对手丁", "1-1", "主队甲")]
    away_rows = [("2026-10-14", "客队乙", "0-3", "对手丙"), ("2026-10-11", "客队乙", "1-0", "对手丁")]
    h2h_rows = [("2025-05-24", "主队甲", "1-1", "客队乙"), ("2024-10-26", "客队乙", "0-2", "主队甲"),
                ("2024-04-03", "主队甲", "3-1", "客队乙")]
    return (
        "<html><body>"
        + team_table("主队甲", home_rows)
        + team_table("客队乙", away_rows)
        + "<table><tr><td>两队交锋 全赛事</td></tr>"
        "<tr><td>联赛</td><td>时间</td><td>主队</td><td>比分</td><td>客队</td><td>半场</td></tr>"
        + "".join(
            f"<tr><td>联赛</td><td>25-05-24 {d} 22:00</td><td>{h}</td><td>{s}</td><td>{a}</td><td>0-0</td></tr>"
            for d, h, s, a in h2h_rows
        )
        + "</table></body></html>"
    )


class FootballDynamicsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.issue = json.loads((ROOT / "data/football/current_issue.json").read_text())

    def test_history_parser_form_rest_and_h2h(self):
        dyn = dynamics.parse_history_page(_history_fixture(), "2026-10-17T03:00:00+08:00")
        self.assertEqual(dyn["home"]["form_last10"]["points"], 4)  # win + draw
        self.assertEqual(dyn["home"]["form_last10"]["played"], 2)
        self.assertEqual(dyn["home"]["rest_days"], 3)
        self.assertEqual(dyn["away"]["form_last10"]["points"], 3)
        self.assertEqual(dyn["head_to_head"]["meetings"], 3)
        self.assertEqual(dyn["head_to_head"]["home_wins"], 2)
        self.assertEqual(dyn["head_to_head"]["draws"], 1)

    def test_enrich_issue_uses_match_ids_and_degrades(self):
        issue = json.loads(json.dumps(self.issue))
        issue["matches"][0]["okooo_match_id"] = "999"
        with mock.patch.object(dynamics, "_fetch", return_value=_history_fixture()):
            enriched = dynamics.enrich_issue(issue, fetch=dynamics._fetch)
        self.assertEqual(enriched, 1)
        self.assertIn("dynamics", issue["matches"][0])
        bare = json.loads(json.dumps(self.issue))
        self.assertEqual(dynamics.enrich_issue(bare, fetch=dynamics._fetch), 0)

    def test_engine_consumes_dynamics(self):
        issue = json.loads(json.dumps(self.issue))
        dyn = dynamics.parse_history_page(_history_fixture(), issue["matches"][0]["kickoff"])
        issue["matches"][0]["dynamics"] = dyn
        row = build_plan(issue)["matches"][0]
        for factor in ("recent_form", "rest_days", "head_to_head"):
            self.assertIn(factor, row["factors"]["available"])
        self.assertNotIn("recent_form", row["factors"]["unavailable"])
        self.assertIn("dynamics", row)
        self.assertAlmostEqual(sum(row["probabilities"].values()), 1, places=4)
        plain = build_plan(self.issue)["matches"][0]
        self.assertNotEqual(row["probabilities"], plain["probabilities"])

    def test_team_archive_sql_accumulates_and_publishes_last(self):
        issue = json.loads(json.dumps(self.issue))
        issue["matches"][0]["dynamics"] = dynamics.parse_history_page(
            _history_fixture(), issue["matches"][0]["kickoff"]
        )
        plan = build_plan(issue)
        plan["ai"] = {"status": "completed", "title": "AI 综合分析", "sections": {}}
        plan["review"] = {"status": "pending"}
        sql = build_sql(plan)
        self.assertIn("CREATE TABLE IF NOT EXISTS football_teams", sql)
        self.assertIn("football_team_snapshots", sql)
        self.assertIn("INSERT OR REPLACE INTO football_team_snapshots", sql)
        self.assertIn(issue["matches"][0]["home"], sql)
        self.assertNotIn("DELETE FROM football_team_snapshots", sql)
        self.assertGreater(
            sql.rindex("football_current_snapshot"), sql.rindex("football_team_snapshots")
        )
