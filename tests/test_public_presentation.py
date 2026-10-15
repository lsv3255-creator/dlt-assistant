from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PublicPresentationTest(unittest.TestCase):
    def read(self, rel):
        return (ROOT / rel).read_text(encoding="utf-8")

    def test_ai_runtime_metadata_is_not_rendered(self):
        js = self.read("public/ai-cycle.js")
        for marker in ("r.model", "r.generated_at", "r.prompt_version", "r.editorial_policy"):
            self.assertNotIn(marker, js)
        self.assertNotIn("c.ai.model", self.read("public/draw-enhancements.js"))

    def test_public_pages_do_not_expose_internal_file_or_version_labels(self):
        pages = "\n".join(self.read(path) for path in (
            "public/index.html", "public/score.html", "public/experiment.html", "public/my.html"
        ))
        for marker in (
            "评分版本：", "权重版本：", "最近调整参数", "data/dlt_history.json",
            "data/recommendations.json", "reports/*.json", "localStorage",
        ):
            self.assertNotIn(marker, pages)

    def test_customer_facing_failures_are_generic(self):
        self.assertIn("请稍后刷新页面重试", self.read("public/app.js"))
        self.assertIn("数据暂时无法加载，请稍后重试", self.read("public/score.js"))
        self.assertIn("选号数据暂时无法加载，请稍后重试", self.read("public/pick.js"))
        self.assertIn("走势图数据暂时无法加载，请稍后重试", self.read("public/trend-v2.js"))


if __name__ == "__main__":
    unittest.main()
