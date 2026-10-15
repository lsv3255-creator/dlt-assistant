"""Generate the public traditional-football-lottery analysis artifact."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.football.engine import build_plan, freeze_existing_recommendation, settle

SOURCE = ROOT / "data/football/current_issue.json"
OUTPUT = ROOT / "public/data/football/current.json"
ARCHIVE = ROOT / "data/football/archive.json"


def _read(path: Path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def _atomic_write(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def evidence(plan: dict) -> dict[str, str]:
    uncertain = [row for row in plan["matches"] if len(row["sfc_choices"]) == 2]
    r9_orders = plan["plans"]["ren9"]["orders"]
    return {
        "schedule": f'第{plan["issue"]}期共14场，停售时间{plan["sale_end"]}，场次身份已与官方公告固定。',
        "factor_method": "程序先综合市场相对概率、同联赛排名差和主客场保守先验，再用结果差距衡量分歧；这些是辅助比较，不是真实胜率。",
        "factor_coverage": "本期14场均有市场、排名和主客场三类可核验输入；尚无可靠来源的近期状态、伤停、休息天数和交锋数据不参与计算。",
        "sfc_cover": "14场方案对分歧最大的5场采用双选，其余采用单选；共展开32注，基本金额64元。",
        "sfc_uncertain": "重点防范场次：" + "、".join(f'{r["order"]}场{r["home"]}vs{r["away"]}' for r in uncertain) + "。",
        "r9_scope": "任选九只保留相对置信差更清晰的9场：" + "、".join(str(order) for order in r9_orders) + "场。",
        "risk": "足球赛果受阵容、临场状态和突发事件影响；指数会变化，任何方案均不保证中奖，停售前应复核官方场次调整。",
    }


def _fallback_ai(plan: dict, review: dict | None = None) -> dict:
    facts = evidence(plan)
    return {
        "status": "pending",
        "title": "AI 深度解读将在在线分析完成后更新",
        "sections": {
            "overview": "当前先展示已核验赛程和程序化概率换算结果，在线 AI 尚未完成本期综合解读。",
            "sfc_reason": facts["sfc_cover"] + facts["sfc_uncertain"],
            "r9_reason": facts["r9_scope"] + facts["factor_method"],
            "risk": facts["risk"],
            **({"review": "赛果已录入，AI复盘将在在线分析完成后更新。"} if review and review.get("status") == "completed" else {}),
        },
    }


def _request_ai(plan: dict, review: dict | None = None) -> dict:
    key = os.getenv("DLT_AI_API_KEY", "").strip()
    base = os.getenv("DLT_AI_BASE_URL", "").strip()
    route = os.getenv("DLT_AI_MODEL", "").strip()
    if not key or base != "https://openrouter.ai/api/v1" or not route:
        return _fallback_ai(plan, review)
    if route != "openrouter/free" and not route.endswith(":free"):
        return _fallback_ai(plan, review)
    import requests

    facts = evidence(plan)
    fields = ["overview", "sfc_reason", "r9_reason", "risk"]
    if review and review.get("status") == "completed":
        fields.append("review")
        facts["review_result"] = (
            f'冻结方案赛后核验：14场覆盖命中{review["sfc_hits"]}/14，'
            f'任选九命中{review["ren9_hits"]}/9。只允许解释事前取舍，不得事后改号。'
        )
    prompt = (
        "你是传统足彩14场与任选九的数据分析助手。只根据给定证据做中文综合评审，不能补造球队新闻、伤停、走势或概率，"
        "不能承诺中奖。AI的作用是综合市场、排名、主客场和不确定性，解释覆盖取舍和风险，不得把模型相对概率冒充真实胜率。"
    )
    schema = {
        "type": "json_schema",
        "json_schema": {
            "name": "football_analysis",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {name: {"type": "string", "minLength": 20, "maxLength": 500}
                               for name in fields},
                "required": fields,
                "additionalProperties": False,
            },
        },
    }
    models = [route] if route != "openrouter/free" else [
        "dots-studio/dots-3-note-preview:free", "openrouter/free"
    ]
    failures = []
    for model in models:
        try:
            response = requests.post(
                base + "/chat/completions",
                headers={"Authorization": "Bearer " + key},
                json={
                    "model": model,
                    "temperature": 0,
                    "max_tokens": 2400,
                    "reasoning": {"enabled": False},
                    "response_format": schema,
                    "provider": {"require_parameters": True},
                    "messages": [
                        {"role": "system", "content": prompt},
                        {"role": "user", "content": json.dumps(facts, ensure_ascii=False)},
                    ],
                },
                timeout=90,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"].strip()
            # Some free endpoints wrap otherwise valid structured JSON in markdown.
            start, end = content.find("{"), content.rfind("}")
            if start < 0 or end <= start:
                raise ValueError("AI response did not contain a JSON object")
            sections = json.loads(content[start:end + 1])
            if set(sections) != set(fields):
                raise ValueError("invalid AI sections")
            if any(not isinstance(value, str) or len(value) < 20 for value in sections.values()):
                raise ValueError("invalid AI text")
            joined = " ".join(sections.values())
            assertion_text = joined
            for caution in ("不保证中奖", "不能保证中奖", "无法保证中奖", "并不保证中奖", "不作精准预测", "不能精准预测", "无法精准预测"):
                assertion_text = assertion_text.replace(caution, "")
            forbidden = ("保证中奖", "稳赚", "稳胆", "精准预测", "状态火热", "伤停名单")
            if any(word in assertion_text for word in forbidden):
                raise ValueError("unsupported AI claim")
            if re.search(r"近[0-9一二三四五六七八九十]+场|[0-9一二三四五六七八九十]+连[胜败]|历史交锋.{0,12}[胜败]", joined):
                raise ValueError("unsupported AI form claim")
            return {"status": "completed", "title": "AI 综合分析", "sections": sections}
        except (requests.RequestException, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            failures.append(type(exc).__name__ + ":" + str(exc)[:120])
            continue
    print("football_ai_fallback: " + " | ".join(failures))
    return _fallback_ai(plan, review)


def main() -> None:
    issue = _read(SOURCE)
    if not issue:
        raise SystemExit("current football issue is missing")
    plan = build_plan(issue)
    existing = _read(OUTPUT, {})
    plan = freeze_existing_recommendation(plan, existing)
    if issue.get("results"):
        review = {"status": "completed", **settle(plan, issue["results"])}
        plan["status"] = "settled"
    else:
        review = {"status": "pending"}
    same_analysis = (
        existing.get("issue") == plan["issue"]
        and [row.get("probabilities") for row in existing.get("matches", [])]
        == [row.get("probabilities") for row in plan["matches"]]
        and (existing.get("review") or {}).get("status") == review["status"]
    )
    if same_analysis and (existing.get("ai") or {}).get("status") == "completed":
        plan["ai"] = existing["ai"]
    else:
        plan["ai"] = _request_ai(plan, review)
    plan["review"] = review
    archive = _read(ARCHIVE, {"items": []})
    items = [item for item in archive["items"] if item.get("issue") != plan["issue"]]
    items.append(plan)
    _atomic_write(ARCHIVE, {"items": items[-100:]})

    # Public artifact intentionally excludes runtime metadata and internal identity hashes.
    public_plan = json.loads(json.dumps(plan, ensure_ascii=False))
    public_plan.pop("identity_hash", None)
    for row in public_plan.get("matches", []):
        factors = row.get("factors", {})
        factors.pop("weights", None)
        factors.pop("components", None)
    for source in public_plan.get("sources", {}).values():
        source.pop("checked_at", None)
    _atomic_write(OUTPUT, public_plan)
    print(f'football issue {plan["issue"]}: ai={plan["ai"]["status"]}, output={OUTPUT}')


if __name__ == "__main__":
    main()

