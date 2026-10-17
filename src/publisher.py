"""推荐系统输出层（Phase 11-D1）：将 reports 闭环数据安全发布到 public/data 供前端消费。

职责（纯输出层，不含任何推荐算法 / 策略 / 模型逻辑）：
  1. 扩展 public/data/recommendations.json：保留一期固定号码（D1 锁定值），追加
     score / reason / is_primary / source 加法字段（前端 selectPrimary 已兼容）。
  2. 生成 public/data/review.json：最近一期复盘（来源 reports/reflection_report.json）。
  3. 生成 public/data/strategy_score.json：策略表现统计（来源 reports/backtest_summary.json）。

原则：
  - 失败安全：任一报告缺失/损坏 → 对应输出为空结构，绝不让整个流程失败。
  - 纯加法：不删除现有字段；recommendations.json 保持数组格式（前端 A/B/C/D 折叠依赖）。
  - 零第三方依赖：仅标准库（json/os/datetime/argparse）。

用法：
  python -m src.publisher                 # 默认路径（仓库根目录运行）
  python src/publisher.py                 # 直接运行亦可
  python -m src.publisher --safe          # 任何异常仅打印并 exit 0（CI 接入用）
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from typing import Any

# 策略前缀 → 中文标签（与 src/recommender.py STRATEGY_LABELS 保持一致，避免循环导入）
LABELS: dict[str, str] = {
    "A": "均衡统计型",
    "B": "冷热组合型",
    "C": "纯随机娱乐型",
    "D": "综合评分型",
}

# 命中等级（total_hit = 前区命中 + 后区命中，0-7）——与 src/backtest.py HIT_LEVEL 保持一致
HIT_LEVEL: dict[int, int] = {0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4}  # 0=无,1=低,2=中,3=高,4=极高


def _load_json(path: str) -> Any:
    """安全读取 JSON：文件不存在/解析失败 → 返回 None（不抛异常）。"""
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _strategy_group(strategy: Any) -> str:
    """'D-综合评分型' → 'D'；无前缀 → 'other'。"""
    if not strategy:
        return "other"
    head = str(strategy).split("-")[0].strip().upper()
    return head if head in ("A", "B", "C", "D") else "other"


# ---------------------------------------------------------------- P0-1 不可变发布快照
#
# 契约：同一 issue 一旦正式发布，复盘必须读取该 issue 的已发布快照；
# 禁止开奖后重算 primary / 重选策略 / 硬编码 D / 依开奖结果改快照。
# 仅使用标准库（json / hashlib / os / datetime），不引入任何第三方依赖。

import hashlib  # P0-1：快照完整性哈希（完整性标识，非安全签名）

SNAPSHOT_SCHEMA_VERSION = "1.1"  # P1-2：快照新增冻结的 structured explanation（旧 "1" 快照仍可读）
SNAPSHOT_DEFAULT_PATH = "public/data/published_recommendations.json"


def _canonical_json(obj: Any) -> str:
    """确定性序列化：稳定键序 + 固定分隔符 + 非 ASCII 原样，保证同内容同字符串。"""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def snapshot_hash(snapshot: Any) -> str | None:
    """对快照内容字段做确定性 SHA-256（覆盖 issue/primary_strategy/front/back/
    reason/final_score/final_breakdown/model_version/explanation；不含
    published_at 与 snapshot_hash，使幂等重放不变）。非 dict → None。"""
    if not isinstance(snapshot, dict):
        return None
    numbers = snapshot.get("numbers") or {}
    d = {
        "issue": str(snapshot.get("issue")),
        "primary_strategy": snapshot.get("primary_strategy"),
        "front": numbers.get("front"),
        "back": numbers.get("back"),
        "reason": snapshot.get("reason"),
        "final_score": snapshot.get("final_score"),
        "final_breakdown": snapshot.get("final_breakdown"),
        "model_version": snapshot.get("model_version"),
        "explanation": snapshot.get("explanation"),
    }
    return hashlib.sha256(_canonical_json(d).encode("utf-8")).hexdigest()


def build_snapshot(primary: Any, *, published_at: str) -> dict[str, Any] | None:
    """由「发布给前端的同一 primary」构造不可变快照。非 dict primary → None。

    字段名适配当前 canonical 结构（recommendations.json 记录字段）：
      target_issue→issue, strategy→primary_strategy, front/back→numbers,
      reason/final_score/final_breakdown/model_version 原样保留。
    """
    if not isinstance(primary, dict):
        return None
    numbers = {"front": list(primary.get("front") or []),
               "back": list(primary.get("back") or [])}
    snap = {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "issue": str(primary.get("target_issue")),
        "published_at": published_at,
        "primary_strategy": primary.get("strategy"),
        "numbers": numbers,
        "reason": primary.get("reason"),
        "final_score": primary.get("final_score"),
        "final_breakdown": primary.get("final_breakdown"),
        "model_version": primary.get("model_version"),
        "explanation": primary.get("explanation"),  # P1-2：冻结结构化 explanation
        "snapshot_hash": None,  # 下方填充
    }
    snap["snapshot_hash"] = snapshot_hash(snap)
    return snap


def _load_published_store(path: str) -> dict[str, Any]:
    data = _load_json(path)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return {"schema_version": SNAPSHOT_SCHEMA_VERSION, "items": []}
    data.setdefault("schema_version", SNAPSHOT_SCHEMA_VERSION)
    return data


def _build_primary_explanation(primary: dict[str, Any], history_data: Any,
                               recent_window: int = 50) -> dict[str, Any] | None:
    """P1-2：为唯一 primary 生成确定性 explanation（惰性导入 src.explanation，失败安全）。

    输入：primary 记录（strategy/front/back/basis/factors/model_version/score_total/target_issue）
          + dlt_history.json 数据（真实统计依据来源）。
    输出：结构化 explanation dict；任何异常 → None（snapshot 仍冻结，reason_status 由前端兜底）。
    """
    try:
        from .explanation import build_explanation  # 惰性导入，不强制顶层依赖
        issues = (history_data or {}).get("issues") if isinstance(history_data, dict) else None
        return build_explanation(
            strategy=primary.get("strategy"),
            front=primary.get("front") or [],
            back=primary.get("back") or [],
            history=issues if isinstance(issues, list) else None,
            recent_window=recent_window,
            basis=primary.get("basis"),
            factors=primary.get("factors"),
            model_version=primary.get("model_version"),
            score_total=primary.get("score_total") or primary.get("final_score"),
            target_issue=primary.get("target_issue"),
        )
    except Exception:
        return None


def upsert_published_snapshot(path: str, snapshot: dict[str, Any]) -> str:
    """写不可变快照。返回状态：created / unchanged / conflict / corrupt。

    - 该 issue 无快照 → 追加（created）
    - 已有且内容 hash 相同 → 不写盘（unchanged，幂等）
    - 已有但内容不同 → 保留原快照，不覆盖（conflict，不可变核心）
    - P4-3 F1：目标文件已存在但不可解析为合法 published store（损坏 / 缺 items）
      → fail-closed 返回 'corrupt'，绝不重置/清空历史快照（保护 26112/26113）。
      只有「文件真不存在」才视为首次发布并创建新 store。
    """
    data = _load_json(path)
    preexists = os.path.exists(path)
    if preexists and (not isinstance(data, dict) or not isinstance(data.get("items"), list)):
        return "corrupt"  # 存在但损坏 → fail-closed，绝不静默重置历史快照
    store = _load_published_store(path)
    items = store.get("items", [])
    issue = str(snapshot.get("issue"))
    existing = next((s for s in items if str(s.get("issue")) == issue), None)
    if existing is not None:
        if snapshot_hash(existing) == snapshot_hash(snapshot):
            return "unchanged"
        return "conflict"  # 保留原快照，绝不静默覆盖
    items.append(snapshot)
    store["items"] = items
    store["updated_at"] = _now()
    _write_json(path, store)
    return "created"


def load_published_by_issue(path: str) -> dict[str, dict[str, Any]]:
    """读取全部已发布快照，返回 {issue: snapshot}（供复盘按 issue 查询）。"""
    items = _load_published_store(path).get("items", [])
    return {str(s.get("issue")): s for s in items if isinstance(s, dict)}


def _hit_counts(front: Any, back: Any, actual_front: Any, actual_back: Any) -> dict[str, Any]:
    """用「冻结号码」对「实际开奖」计算命中（前/后/总 + 等级）。"""
    ff = set(x for x in (front or []) if isinstance(x, int))
    fb = set(x for x in (back or []) if isinstance(x, int))
    af = set(x for x in (actual_front or []) if isinstance(x, int))
    ab = set(x for x in (actual_back or []) if isinstance(x, int))
    f_hit = len(ff & af)
    b_hit = len(fb & ab)
    total = f_hit + b_hit
    return {"front": f_hit, "back": b_hit, "total": total, "level": HIT_LEVEL.get(total, 0)}


def _build_reason(rec: dict[str, Any]) -> str | None:
    """基于 basis 规则生成简短推荐理由（纯规则文案，非 AI、非预测）。无 basis 时返回 None。"""
    basis = rec.get("basis")
    if not isinstance(basis, dict):
        return None
    parts: list[str] = []
    miss = basis.get("missing")
    if isinstance(miss, (int, float)) and miss >= 70:
        parts.append("含超平均遗漏回补信号")
    st = basis.get("structure")
    if isinstance(st, dict):
        ssm = st.get("sum_span_match")
        if isinstance(ssm, (int, float)) and ssm >= 80:
            parts.append("和值/跨度贴合历史高频区间")
        if isinstance(st.get("zone_match"), (int, float)) and st["zone_match"] >= 60:
            parts.append("区间分布贴合历史常态")
    if not parts:
        return None
    return "；".join(parts)


# ---------------------------------------------------------------- ① 推荐扩展

def build_recommendations(current: Any, source_recs: Any) -> list[dict[str, Any]]:
    """扩展当前推荐（一期固定号码源）→ 追加 score/reason/is_primary/source。

    current     public/data/recommendations.json（D1 锁定值，号码权威来源；可为 None/非列表）
    source_recs reports/recommendations.json（完整记录，含 D 的 score_total/basis；可为 None/非列表）
    """
    if not isinstance(current, list):
        return []
    src = source_recs if isinstance(source_recs, list) else []
    # 源记录按键索引：(target_issue, strategy, idx)
    src_map: dict[tuple, dict[str, Any]] = {}
    for r in src:
        if isinstance(r, dict) and r.get("target_issue") is not None:
            src_map[(str(r.get("target_issue")), str(r.get("strategy")), r.get("idx", 0))] = r

    out: list[dict[str, Any]] = []
    for item in current:
        if not isinstance(item, dict):
            continue
        rec = dict(item)  # 拷贝，纯加法不污染输入
        group = _strategy_group(rec.get("strategy"))
        src_rec = src_map.get((str(rec.get("target_issue")), str(rec.get("strategy")), rec.get("idx", 0)))
        if src_rec is None:
            # D1 与 reports 键不完全一致时回退：同 target_issue + 同策略前缀
            for sr in src:
                if (str(sr.get("target_issue")) == str(rec.get("target_issue"))
                        and _strategy_group(sr.get("strategy")) == group
                        and sr.get("idx") == rec.get("idx", 0)):
                    src_rec = sr
                    break
        # score：优先 D 原始 score_total；缺失时为 None（前端 selectPrimary 按 final>score>D 容错）
        st = None
        if src_rec is not None:
            v = src_rec.get("score_total")
            st = round(float(v), 2) if isinstance(v, (int, float)) else None
        rec["score"] = st
        rec["reason"] = _build_reason(src_rec) if src_rec else None
        # is_primary：当前唯一推荐约定 = D 综合评分型（D3 引入 final_score 后再改由评分决定）
        rec["is_primary"] = (group == "D")
        rec["source"] = "reports/recommendations.json"
        out.append(rec)
    return out


# ---------------------------------------------------------------- ② 复盘（P0-1：快照优先）

# 因子三态 → 调整方向规则（纯规则映射，不修改任何算法/评分）
_FACTOR_ADJUST_RULES: dict[str, tuple[str, str]] = {
    "heat": ("热号关注", "热号因子指向"),
    "missing": ("遗漏补偿关注", "遗漏回补"),
    "trend": ("趋势因子", "趋势判断"),
    "structure": ("结构贴合", "组合结构判断"),
}


def pick_primary(recs: list[dict[str, Any]]) -> dict[str, Any] | None:
    """P0 唯一权威 primary：只读 publisher 设定的 is_primary 标记（与前端 selectPrimary 同契约）。

    不做 score 重排 / 不猜 final / 不回退 D / 不选 first。
    恰好 1 个 is_primary=True → 返回它；0 个或多个（契约违反）→ None（fail-closed，不猜）。
    """
    if not isinstance(recs, list):
        return None
    primaries = [r for r in recs if isinstance(r, dict) and r.get("is_primary") is True]
    return primaries[0] if len(primaries) == 1 else None


def _build_next_adjustment(analysis: dict[str, Any]) -> list[dict[str, Any]]:
    """基于 factor_review 三态 + 和值偏差生成规则化调整建议。

    仅读取复盘数据做规则映射，不调用模型、不修改评分、不影响推荐结果。
    任一数据缺失 → 不产生对应建议；整体无建议 → 返回 []（失败安全）。
    """
    suggestions: list[dict[str, Any]] = []
    fr = (analysis or {}).get("factor_review") or {}
    for key, (text_head, reason_head) in _FACTOR_ADJUST_RULES.items():
        status = (fr.get(key) or {}).get("status")
        if status == "negative":
            suggestions.append({
                "type": "reduce",
                "text": "降低" + text_head + "权重",
                "reason": reason_head + "偏差（相对历史中位数偏低）",
            })
        elif status == "positive":
            suggestions.append({
                "type": "keep",
                "text": "维持" + text_head,
                "reason": reason_head + "正常（方向判断合理）",
            })
        # neutral：方向合理但本期未命中，不产生建议，避免噪音
    sum_diff = (analysis or {}).get("sum_diff")
    if isinstance(sum_diff, (int, float)) and sum_diff > 25:
        suggestions.append({
            "type": "reduce",
            "text": "收缩和值区间",
            "reason": "上期和值偏差较大（差 " + str(sum_diff) + "）",
        })
    elif isinstance(sum_diff, (int, float)) and sum_diff <= 10:
        suggestions.append({
            "type": "keep",
            "text": "维持和值区间",
            "reason": "上期和值贴合历史高频区间",
        })
    return suggestions



_DLT_FIXED_PRIZES = {
    "三等奖": 10000,
    "四等奖": 3000,
    "五等奖": 300,
    "六等奖": 200,
    "七等奖": 100,
    "八等奖": 15,
    "九等奖": 5,
}


def _dlt_prize(front_hits: int, back_hits: int, amounts: dict | None = None) -> dict:
    """Official DLT prize tier for a hit pattern.

    一等奖/二等奖 are floating (amounts come from the draw notice
    when available); the rest are fixed by the game rules.
    """
    amounts = amounts or {}
    if front_hits == 5 and back_hits == 2:
        return {"tier": "一等奖", "amount": amounts.get("一等奖")}
    if front_hits == 5 and back_hits == 1:
        return {"tier": "二等奖", "amount": amounts.get("二等奖")}
    tier = None
    if front_hits == 5 and back_hits == 0:
        tier = "三等奖"
    elif front_hits == 4 and back_hits == 2:
        tier = "四等奖"
    elif front_hits == 4 and back_hits == 1:
        tier = "五等奖"
    elif front_hits == 3 and back_hits == 2:
        tier = "六等奖"
    elif front_hits == 4 and back_hits == 0:
        tier = "七等奖"
    elif (front_hits, back_hits) in ((3, 1), (2, 2)):
        tier = "八等奖"
    elif (front_hits, back_hits) in ((3, 0), (2, 1), (1, 2), (0, 2)):
        tier = "九等奖"
    if tier is None:
        return {"tier": None, "amount": 0}
    return {"tier": tier, "amount": _DLT_FIXED_PRIZES[tier]}


def build_review(reflection: Any, published_by_issue: dict[str, Any] | None = None, prize_amounts_by_issue: dict[str, Any] | None = None) -> dict[str, Any]:
    """生成复盘 → review.json 结构（P0-1 快照驱动）。

    权威来源 = published_by_issue 中该 issue 的不可变发布快照：
      draw issue → 查快照 → 冻结 front/back → 对实际开奖算命中。
    绝不重算 primary / 不重选策略 / 不硬编码 D。

    reflection：reflection_report.json（提供各期 actual 开奖 + factor_review，
    亦作为「无快照时」的 legacy 兼容来源）。
    published_by_issue：{str(issue): snapshot}（不可变发布快照索引）。
    无数据 → 空结构；有 issue 但无快照 → legacy/non-authoritative fallback（明确标记）。
    """
    if not isinstance(reflection, dict):
        return {"updated_at": _now(), "empty": True, "issue": None}
    periods = reflection.get("periods")
    if not isinstance(periods, list) or not periods:
        return {"updated_at": _now(), "empty": True, "issue": None}
    published = published_by_issue if isinstance(published_by_issue, dict) else {}

    # 目标 issue：最近一期「已开奖」（actual 有前区号码）
    drawn = [p for p in periods if isinstance(p, dict) and ((p.get("actual") or {}).get("front"))]
    if not drawn:
        return {"updated_at": _now(), "empty": True, "issue": None}
    target_issue = max(str(p.get("issue")) for p in drawn)

    # 实际开奖（供命中计算）
    act_by_issue = {str(p.get("issue")): (p.get("actual") or {}) for p in drawn}
    act = act_by_issue.get(target_issue, {})
    actual_front = act.get("front") or []
    actual_back = act.get("back") or []

    snap = published.get(target_issue)
    if isinstance(snap, dict) and snap.get("numbers"):
        # —— 权威复盘：读不可变快照 ——
        numbers = snap.get("numbers") or {}
        front = numbers.get("front") or []
        back = numbers.get("back") or []
        hits = _hit_counts(front, back, actual_front, actual_back)
        factor_review = _factor_review_of(periods, target_issue, snap.get("primary_strategy"))
        sum_diff = abs(sum(front) - sum(actual_front)) if front and actual_front else None
        return {
            "updated_at": _now(),
            "empty": False,
            "issue": target_issue,
            "snapshot_status": "ok",
            "authoritative": True,
            "snapshot_hash": snap.get("snapshot_hash"),
            "recommendation": {
                "strategy": snap.get("primary_strategy"),
                "front": front,
                "back": back,
                "score_total": snap.get("final_score"),
                "model_version": snap.get("model_version"),
            },
            "reason": snap.get("reason"),
            "explanation": snap.get("explanation"),  # P1-2：复盘读取冻结 explanation，绝不重算
            "actual_result": {"front": actual_front, "back": actual_back},
            "hit_count": hits,
            "prize": _dlt_prize(hits["front"], hits["back"], (prize_amounts_by_issue or {}).get(target_issue)),
            "analysis": {"sum_diff": sum_diff, "factor_review": factor_review},
            "next_adjustment": _build_next_adjustment(
                {"factor_review": factor_review, "sum_diff": sum_diff}),
            "disclaimer": "复盘读取当期已发布不可变快照，仅为娱乐回顾，不代表预测中奖",
        }

    # —— legacy / non-authoritative fallback：该 issue 无不可变快照 ——
    # 仅从 reflection 恢复该 issue 的推荐（D 优先只是历史兼容选择，明确标记 non-authoritative），
    # 绝不把它当作「当时发布的唯一推荐」。
    cand = [p for p in periods if str(p.get("issue")) == target_issue]
    if not cand:
        return {"updated_at": _now(), "empty": True, "issue": None}
    p = max(cand, key=lambda x: _strategy_group(x.get("strategy", "")) == "D")
    rec = p.get("recommend") or {}
    front = rec.get("front") or []
    back = rec.get("back") or []
    hits = _hit_counts(front, back, actual_front, actual_back)
    return {
        "updated_at": _now(),
        "empty": False,
        "issue": target_issue,
        "snapshot_status": "missing",
        "authoritative": False,
        "legacy": True,
        "snapshot_hash": None,
        "recommendation": {
            "strategy": p.get("strategy"),
            "front": front,
            "back": back,
            "score_total": rec.get("score_total"),
        },
        "actual_result": {"front": actual_front, "back": actual_back},
        "hit_count": hits,
        "prize": _dlt_prize(hits["front"], hits["back"], (prize_amounts_by_issue or {}).get(target_issue)),
        "analysis": {"factor_review": (p.get("factor_review") or {})},
        "next_adjustment": _build_next_adjustment({"factor_review": (p.get("factor_review") or {})}),
        "disclaimer": "该期无不可变发布快照，复盘为 legacy 兼容（非权威，不代表当时实际发布内容）",
    }


def _factor_review_of(periods: list[dict[str, Any]], issue: str, strategy: str) -> dict[str, Any]:
    """取该 issue 且策略前缀匹配 primary 的 factor_review（无则空 dict）。"""
    for p in periods:
        if isinstance(p, dict) and str(p.get("issue")) == issue and \
                _strategy_group(p.get("strategy", "")) == _strategy_group(strategy or ""):
            fr = p.get("factor_review")
            if isinstance(fr, dict):
                return fr
    return {}


# ---------------------------------------------------------------- ③ 策略表现

def build_strategy_score(backtest: Any) -> dict[str, Any]:
    """从 backtest_summary.json 生成策略表现榜 → strategy_score.json 结构。

    strategies = {A,B,C,D: {count, avg_total_hit, avg_front_hit, avg_back_hit, ...}}
    无数据 → 空列表（含 updated_at）。
    """
    if not isinstance(backtest, dict):
        return {"updated_at": _now(), "empty": True, "strategies": []}
    strategies = backtest.get("strategies")
    if not isinstance(strategies, dict):
        return {"updated_at": _now(), "empty": True, "strategies": []}

    rows: list[dict[str, Any]] = []
    for key in ("A", "B", "C", "D"):
        s = strategies.get(key)
        if not isinstance(s, dict):
            continue
        count = s.get("count", 0)
        avg_hit = s.get("avg_total_hit", 0.0)
        rows.append({
            "strategy": key,
            "label": LABELS.get(key, key),
            "total_count": count,
            # 命中率 = 平均命中数 / 满分 7（前 5 + 后 2），归一化 0-1（娱乐参考）
            "hit_rate": round(float(avg_hit) / 7.0, 3) if count else 0.0,
            # 样本量不足时 recent_score 等同整体（防小样本误导，D3 起才引入近 10 期窗口）
            "recent_score": round(float(avg_hit), 3) if count else 0.0,
            "rank": 0,  # 下方按 avg_total_hit 降序重排
            "_avg_total_hit": round(float(avg_hit), 3) if count else 0.0,
        })
    rows.sort(key=lambda r: (-r["_avg_total_hit"], r["strategy"]))
    for i, r in enumerate(rows, 1):
        r["rank"] = i
        r.pop("_avg_total_hit", None)
    return {
        "updated_at": _now(),
        "empty": not rows,
        "strategies": rows,
        "disclaimer": "策略权重与排行仅用于展示与娱乐回顾，非预测依据",
    }


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _write_json(path: str, data: Any) -> None:
    """原子写入 JSON：先写同目录临时文件 + fsync，再 os.replace 覆盖目标。

    P4-3 F2（I5）：避免「truncate-then-write」在写中途崩溃时留下半写/损坏
    文件（此前会触发 G1 的历史快照静默重置风险）。同一文件系统上
    os.replace 是原子操作。使用 tempfile 保证临时名唯一且与目标同目录。
    """
    import tempfile
    d = os.path.dirname(os.path.abspath(path))
    if d:
        os.makedirs(d, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=d, prefix=".publisher.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        # 任何失败：清理临时文件，绝不留下半写目标
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _strip_updated_at(x: Any) -> Any:
    """递归剥离 dict 中的 updated_at 键（幂等比较用）。"""
    if isinstance(x, dict):
        return {k: _strip_updated_at(v) for k, v in x.items() if k != "updated_at"}
    if isinstance(x, list):
        return [_strip_updated_at(i) for i in x]
    return x


def _write_json_if_changed(path: str, data: Any) -> bool:
    """幂等写入：内容（忽略 updated_at）未变时跳过写盘，避免时间戳噪声。

    返回 True=实际写入，False=跳过。现有文件损坏/不可解析 → 视为需写入。
    """
    existing = _load_json(path)
    if existing is not None and _strip_updated_at(existing) == _strip_updated_at(data):
        return False
    _write_json(path, data)
    return True


# ---------------------------------------------------------------- 融合评分接入（D3.2）

def _load_final_score_config(config_path: str = "config/settings.yaml") -> dict[str, float] | None:
    """读取 settings.yaml 的 final_score.weights 配置（方案 B：可选导入+回退）。

    yaml 缺失 / 解析失败 / 段缺失 → 返回 None（调用方使用 final_score.DEFAULT_WEIGHTS）。
    """
    try:
        import yaml  # 第三方可选依赖；CI 环境可用（scheduler 已依赖）
    except Exception:
        return None
    if not config_path or not os.path.exists(config_path):
        return None
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
    except Exception:
        return None
    section = (cfg or {}).get("final_score") or {}
    weights = section.get("weights")
    if not isinstance(weights, dict) or not weights:
        return None
    return {k: float(v) for k, v in weights.items()
            if isinstance(v, (int, float))}


def _recent_map_from_reflection(reflection: Any, window: int = 5) -> dict[str, list[float]]:
    """从 reflection_report.periods 推导各策略最近 N 次 total_hit 列表。

    periods 条目：{issue, strategy, result:{total_hit,...}}（按时间升序）。
    缺失/损坏 → 空 map（融合层自动中性化）。
    """
    out: dict[str, list[float]] = {}
    if not isinstance(reflection, dict):
        return out
    for p in reflection.get("periods") or []:
        if not isinstance(p, dict):
            continue
        g = _strategy_group(p.get("strategy"))
        res = p.get("result") or {}
        hit = res.get("total_hit") if isinstance(res, dict) else None
        if isinstance(hit, (int, float)):
            out.setdefault(g, []).append(float(hit))
    return {g: hits[-window:] for g, hits in out.items() if hits}


def _apply_final_scores(recs: list[dict[str, Any]],
                        backtest: Any,
                        strategy_score: Any,
                        reflection: Any,
                        review: Any,
                        weights: dict[str, float] | None = None) -> list[dict[str, Any]]:
    """将 final_score 融合结果回写到 recs（失败安全：任何异常 → 原样返回 recs）。

    - effective_sample ← backtest.total_periods；
    - history_map ← backtest.strategies[g].avg_total_hit（count>0）；
    - recent_map ← reflection.periods 最近 5 次 total_hit；
    - prev_draw ← review.actual_result（风险惩罚用）；
    - structure_ctx 不传入（结构分中性 50，D3.2.0 已注明为后续增强）。
    """
    if not isinstance(recs, list) or not recs:
        return recs
    try:
        from .final_score import compute_final_scores  # 惰性导入，不改 final_score.py

        effective_sample = 0
        history_map: dict[str, float] = {}
        strategies = (backtest or {}).get("strategies")
        if isinstance(strategies, dict):
            for g, s in strategies.items():
                if isinstance(s, dict) and s.get("count"):
                    history_map[str(g)] = float(s.get("avg_total_hit") or 0.0)
                    effective_sample = max(effective_sample, int(s.get("count") or 0))
        tp = (backtest or {}).get("total_periods")
        if isinstance(tp, int):
            effective_sample = tp

        rank_map: dict[str, int] = {}
        rows = (strategy_score or {}).get("strategies")
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict) and row.get("strategy") and isinstance(row.get("rank"), int):
                    rank_map[str(row["strategy"])] = row["rank"]

        actual = (review or {}).get("actual_result") or {}
        prev_draw = {"front": actual.get("front"), "back": actual.get("back")} \
            if isinstance(actual, dict) and actual.get("front") else None

        scored = compute_final_scores(
            recs,
            effective_sample=effective_sample,
            strategy_rank=rank_map,
            history_map=history_map,
            recent_map=_recent_map_from_reflection(reflection),
            structure_ctx=None,
            prev_draw=prev_draw,
            weights=weights,
        )
        # compute_final_scores 失败安全会原样返回入参对象 → 用身份判断是否成功
        if scored is not recs and isinstance(scored, list):
            return scored
        return recs
    except Exception:
        return recs


# ---------------------------------------------------------------- 入口

def publish(*, rec_path: str = "reports/recommendations.json",
            reflect_path: str = "reports/reflection_report.json",
            backtest_path: str = "reports/backtest_summary.json",
            current_path: str = "public/data/recommendations.json",
            out_dir: str = "public/data",
            published_path: str | None = None,
            history_path: str = "public/data/dlt_history.json",
            recent_window: int = 50) -> dict[str, Any]:
    """执行输出层发布，返回各文件生成结果摘要（永不抛异常）。

    P0-1：确定唯一 primary 后写不可变发布快照（published_path，默认
    out_dir/published_recommendations.json），复盘按 issue 读取该快照。
    P1-2：发布前用真实历史数据为 primary 生成确定性 explanation 并冻结进快照。
    """
    current = _load_json(current_path)
    source_recs = _load_json(rec_path)
    reflection = _load_json(reflect_path)
    backtest = _load_json(backtest_path)

    recs = build_recommendations(current, source_recs)
    strategy_score = build_strategy_score(backtest)

    # recommendations.json 的号码源存在性检查：D1 导出缺失时回退 reports 最新一期（仍失败安全）
    if not recs and isinstance(source_recs, list) and source_recs:
        latest_issue = max(str(r.get("target_issue", "")) for r in source_recs)
        latest = [r for r in source_recs if str(r.get("target_issue")) == latest_issue]
        recs = build_recommendations(latest, source_recs)

    # D3.2 融合评分接入（回退路径之后、写盘之前）：final_score/final_breakdown/final_rank
    # + is_primary 由融合结果重算；任何异常 → 原样返回（保留 D 硬编码兜底，行为与 D3.1 前一致）
    recs = _apply_final_scores(recs, backtest, strategy_score, reflection, None,
                               weights=_load_final_score_config())

    # P0 唯一权威 primary + 不可变发布快照：在「恰好一个 is_primary」确定之后写快照。
    # 快照必须使用与前端展示一致的同一 primary（pick_primary 与 selectPrimary 同契约：只读 is_primary）。
    snapshot_path = published_path or os.path.join(out_dir, "published_recommendations.json")
    published_status: dict[str, Any] = {"path": snapshot_path, "issues": {}}
    primary = pick_primary(recs)          # 恰好 1 个 is_primary=True 才返回；0/多个 → None
    snapshot_write_ok = isinstance(primary, dict)
    if snapshot_write_ok:
        # P1-2：用真实历史数据为该 primary 生成确定性 explanation（不改 numbers/score/is_primary）。
        expl = _build_primary_explanation(primary, _load_json(history_path), recent_window=recent_window)
        primary["explanation"] = expl                      # 仅新增加法字段，供快照冻结 + 前端展示
        primary["reason"] = primary.get("reason") or (expl.get("summary") if expl else None)
        snap = build_snapshot(primary, published_at=_now())
        st = upsert_published_snapshot(snapshot_path, snap)
        published_status["issues"][str(primary.get("target_issue"))] = st
        # CONFLICT = 该 issue 已有不同不可变快照；CORRUPT = 已存在的发布 store 损坏。
        # 两者都 fail-closed：不得把新推荐写进 recommendations.json（否则 displayed !=
        # snapshot），保留冻结展示，绝不重置/覆盖历史快照（I3/I4/I12）。
        if st in ("conflict", "corrupt"):
            snapshot_write_ok = False

    # P0-1 复盘：读不可变快照索引（含历史已发布 + 本期新写），按 issue 查询
    published_by_issue = load_published_by_issue(snapshot_path)
    prize_amounts_by_issue: dict[str, dict[str, int]] = {}
    details_doc = _load_json(os.path.join(out_dir, "draw_details.json"))
    if isinstance(details_doc, dict):
        for entry in details_doc.get("issues", []) or []:
            prizes = entry.get("prizes") or {}
            amounts = {}
            for tier in ("一等奖", "二等奖"):
                per = ((prizes.get(tier) or {}).get("basic") or {}).get("per_ticket_yuan")
                if isinstance(per, (int, float)):
                    amounts[tier] = int(per)
            if amounts:
                prize_amounts_by_issue[str(entry.get("issue"))] = amounts
    review = build_review(reflection, published_by_issue, prize_amounts_by_issue)

    rec_out = os.path.join(out_dir, "recommendations.json")
    review_out = os.path.join(out_dir, "review.json")
    strategy_out = os.path.join(out_dir, "strategy_score.json")

    # STEP 7 fail-closed：primary 恰好一个且快照非 conflict 才写 recommendations.json；
    # 否则（0/多个 primary，或 conflict）跳过写盘，保留冻结展示，避免 display/snapshot 分叉。
    if snapshot_write_ok:
        changed_recommendations = _write_json_if_changed(rec_out, recs)
    else:
        changed_recommendations = False
    published_status["fail_closed"] = (not snapshot_write_ok)

    changed = {
        "recommendations": changed_recommendations,
        "review": _write_json_if_changed(review_out, review),
        "strategy_score": _write_json_if_changed(strategy_out, strategy_score),
    }

    return {
        "updated_at": _now(),
        "recommendations": {"file": rec_out, "count": len(recs), "changed": changed["recommendations"]},
        "review": {"file": review_out, "empty": bool(review.get("empty")), "changed": changed["review"],
                   "snapshot_status": review.get("snapshot_status", "missing")},
        "published": published_status,
        "strategy_score": {"file": strategy_out, "count": len(strategy_score.get("strategies", [])),
                           "changed": changed["strategy_score"]},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="推荐系统输出层：发布闭环数据到 public/data")
    parser.add_argument("--rec-path", default="reports/recommendations.json")
    parser.add_argument("--reflect-path", default="reports/reflection_report.json")
    parser.add_argument("--backtest-path", default="reports/backtest_summary.json")
    parser.add_argument("--current-path", default="public/data/recommendations.json")
    parser.add_argument("--out-dir", default="public/data")
    parser.add_argument("--published-path", default=None,
                        help="P0-1 不可变发布快照路径（默认 <out-dir>/published_recommendations.json）")
    parser.add_argument("--safe", action="store_true", help="CI 模式：任何异常仅打印并 exit 0")
    args = parser.parse_args()
    try:
        result = publish(rec_path=args.rec_path, reflect_path=args.reflect_path,
                         backtest_path=args.backtest_path, current_path=args.current_path,
                         out_dir=args.out_dir, published_path=args.published_path)
        # P4-4 G-OBS-2: structured operational log — per-issue upsert status +
        # snapshot hash + fail-closed state (observability only; no logic change).
        pub = result.get("published", {})
        issues = pub.get("issues", {})
        print(f"[publisher] 输出层发布完成：推荐 {result['recommendations']['count']} 条，"
              f"复盘 empty={result['review']['empty']}，策略 {result['strategy_score']['count']} 组")
        if issues:
            for iss, st in issues.items():
                print(f"[publisher]   snapshot issue={iss} status={st}")
        if pub.get("fail_closed"):
            print(f"[publisher]   fail-closed=True（未写 display：0/多 primary 或 conflict/corrupt）")
    except Exception as e:  # 顶层兜底（--safe 时 exit 0）
        print(f"[publisher] 发布失败：{type(e).__name__}: {e}")
        sys.exit(0 if args.safe else 1)


if __name__ == "__main__":
    main()
