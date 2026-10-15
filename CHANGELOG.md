## 2026-10-15 — Phase 11 Task #45 前端技术信息隐藏

- 首页不再展示在线模型名称、生成时间、分析版本、规则核验过程和原始记录等后台信息。
- 数据分析、智能选号、趋势、实验和我的方案页面同步隐藏内部版本、参数、文件路径、接口/缓存状态及原始错误。
- 所有后台数据和自动流程保持不变；新增公开展示回归测试，41项相关测试通过。

## 2026-10-15 — Phase 11 Task #44（已上线）

- 新增在线AI综合分析、正式单注/复式推荐理由、开奖后AI复盘、下一期复盘建议传递。
- 独立归档按期保存成功结果；失败定时补试，不覆盖已冻结号码；真实模型ID、时间、输入hash可追溯。
- 新复盘使用现行7奖级及当期公告计算假设奖金，不复用旧实验9奖级奖金表；无事前AI记录明确为事后解读。
- 原单注/复式/发布快照/原复盘/选号/存储不改。77项本地测试PASS；真实免费调用与手机浏览器验证PASS，生产工作流 38666739397 成功，正式站页面与AI数据验收通过；原冻结号码保持不变。AI原稿经规则过滤无依据表述，原始记录及引用可追溯。回滚revert本任务提交。

## 2026-10-15 — Phase 11 Task #43 免费在线AI连接验证通过

2026-10-15 08:33 中国时间：GitHub Actions run 38660623874 / job 116180736331 success。AI_CONNECTIVITY、SCHEMA_AND_EVIDENCE、ALL_PUBLIC_DATA_UNCHANGED 均 PASS。实际模型 nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free，免费路由测试返回合法10+3候选（仅内存测试，不发布、不替换当前8+4）。
- 新增只读验证 workflow，无部署、无写回，不打印密钥或上游错误正文。

## 2026-10-15 — Phase 11 Task #42（已上线；AI 调用待配置）

- 首页接入已核验开奖公告：各奖级基本/追加注数、每注奖金、奖金合计、销售额、奖池、兑奖截止与官方来源。
- 推荐说明新增真实综合评分及排名分量，保留候选来源说明和原单注号码。
- 独立的按期冻结复式：默认 8+4，校验 336 注/672 元，包含原单注。
- 增加服务端 AI 复式选择和因子引用验证；无模型配置/失败如实降级。
- 57 项针对性测试 PASS；GitHub 浏览器检查 PASS；生产 workflow 38657755719 与 Pages 实际部署成功，正式域名显示奖金详情/复式/原单注/复盘，历史切期正常。回滚：revert 本任务提交，不删除旧快照。


## 2026-10-09

- fix: 更正 26114 冻结推荐快照的错误完整性摘要，不修改推荐内容；恢复 GitHub Actions 自动更新，生产显示 26114/26115 与权威复盘。
- feat (pending merge): 增量采集江苏省体彩中心开奖公告中的销量、奖级注数与奖金、奖池、兑奖截止日，并在首页展示已核验详情；源数据与号码历史逐期交叉校验。
- test: 隔离工作流获取 10 期公告并校验各奖级奖金合计，见 Phase 11 Task #41。

# 更新记录

## 2026-10-02

### DLT P4-5 SCHEDULED OPERATIONS / DAILY PIPELINE RESILIENCE（本地 commit，未 push/deploy）

**类型**: chore（daily pipeline 韧性）+ test + docs
**目的**: 将 P4-4 readiness/backup/recovery 能力安全接入日常流水线，并强化
scheduler/publisher/D1/Git/deployment 的失败隔离与状态表达。非预测研究、不改
recommendation semantics（算法/selector/scoring/weights/window/RNG/历史 publication 全部不动）。

**审计（F1–F24 故障模式，24 类）**: 识别 7 个 in-scope 韧性缺口（G-5a..g）：
publisher 写前无 backup、无本地 pre-publish gate、history-lag 未显式化、D1 失败被吞、
盲目 `git pull --rebase || true`、无 failure 分类/状态 artifact、deploy auth/account/api/deploy 未区分。

**新增/修改（全部 safe / no semantic change）**:
| 文件 | 说明 |
|---|---|
| `scripts/ops_status.py` | P12/P17 结构化 per-run 状态 + failure taxonomy（machine-readable、secret 清洗、原子写、gitignored `reports/last-run-status.json`） |
| `scripts/check_local_prepublish.py` | P10 本地 pre-publish integrity gate（store parse + snapshot hash + 26112/26113 immutable + required files + history-lag/target-already-published 显式 + 可选 backup manifest；无需 Cloudflare auth） |
| `.github/workflows/dlt-analysis.yml` | P9 publisher 前 backup（失败即阻断，D2）；P10 pre-publish gate（失败阻断，D6）；scheduler 失败 → SCHEDULER_FAILURE + exit 1（D5）；P11 history-lag 显式状态；P15 D1 失败 → LOCAL_PUBLISHED_D1_FAILED + D1_FAILURE；P14 git push 改为 overlap-aware fail-closed no-force；P16 deploy 区分 ACCOUNT_MISMATCH/AUTH_EXPIRED/DEPLOY_FAILURE（不自动 login）；P17 final `ops_status dump` |
| `tests/test_p45_daily_pipeline_resilience.py` | 24 断言（status 字段/无 secret、prepublish gate、history-lag 不 skip、corrupt/26112-mismatch 阻断、workflow 静态断言 backup-before-publisher/无盲目 rebase/无 force/无 wrangler login/并发保护/D1 可见/noop、INSERT OR IGNORE 幂等、destructive restore 需授权） |
| `docs/architecture/P45-DAILY-PIPELINE-RESILIENCE-CONTRACT.md` | D1–D18 冻结 |
| `docs/runbooks/DLT-DAILY-PIPELINE.md` | 正常/12 类故障的 symptom/diagnosis/safe-command/do-not-do/verification |
| `reports/p45-daily-pipeline-baseline.md` / `-callgraph.md` / `p45-failure-mode-audit.{md,json}` | 审计 |

**验证**:
| 项 | 结果 |
|---|---|
| P4-5 测试 | 24/24 PASS |
| 全量回归 | P4-1 28 + Guard 17 + P4-2 12 + P4-3 23 + P4-4 15 + P4-5 24 + publisher 16 + p0 14 = **149/149 PASS** |
| 26112 / 26113 | 本地 + 生产只读复核不变 |
| 变更面 | 仅 `.github/workflows/dlt-analysis.yml` + 新 scripts/test/docs/reports + `.gitignore`；无 recommender/scorer/analyzer/window/RNG/历史 snapshot 改动 |
| 部署 | NO_DEPLOY_REQUIRED（本阶段不改 public/functions/Pages bundle；P4-4 遗留的 src/publisher.py 观测日志无 Pages 影响） |

### DLT P4-4 OPERATIONAL OBSERVABILITY / RECOVERY READINESS（本地 commit，未 push/deploy）

**类型**: chore（可观测性 + 恢复就绪）+ test + docs
**目的**: production observability / recovery readiness（非预测研究、不改
recommendation semantics、不动算法/scoring/weights/analysis window/RNG/历史 publication）。

**审计（P6 可观测性 + P7 恢复就绪，A–N 故障场景）**: 识别 4 个可观测性 gap
（无结构化 status artifact、publish 未记 per-issue upsert status+hash、无 failure
class、history-lag 未显式记录）与 3 个恢复 gap（无发布 store 备份、无恢复校验器、
无 runbook）。

**新增工具（全部 fail-closed / dry-run-first，不写生产 D1，不泄露 secret）**:
| 文件 | 说明 |
|---|---|
| `scripts/check_production_readiness.py` | 只读 PASS/FAIL + failure_class；结构化写 `reports/last-run-status.json`（可 gitignore）；绝不运行 scheduler/publisher、绝不写 D1 |
| `scripts/recovery_check.py` | dry-run 默认（inspect/validate/list/compare/check-backup）；`--restore` 需显式 `--manifest`+`--authorize`+hash 校验（R1/R5/R9/R10） |
| `scripts/backup_published_store.py` | 发布 store 的 append-only 备份 + SHA-256 manifest；不自动删除 |
| `docs/runbooks/DLT-PRODUCTION-RECOVERY.md` | 7 类故障的 symptom/diagnosis/safe-command/do-not-do/verification |

**最小代码增强（观测 only，无逻辑改动）**: `src/publisher.py` 的 `main()` 增打印
per-issue upsert status + fail-closed 状态（G-OBS-2）。

**契约**: `docs/architecture/P44-RECOVERY-READINESS-CONTRACT.md`（R1–R12 冻结）。

**验证**:
| 项 | 结果 |
|---|---|
| P4-4 测试 | 15/15 PASS |
| 全量回归 | P4-1 28 + Guard 17 + P4-2 12 + P4-3 23 + P4-4 15 + publisher/p0 30 = **125/125 PASS** |
| 26112 / 26113 | 复核不变 |
| 变更面 | src/ 仅 publisher.py（观测日志）；无 algorithm/selector/scoring/weights/window/RNG/历史 snapshot 改动 |

**产物**: 上述 3 scripts + runbook + contract + `reports/p44-{operational-baseline,observability-audit.json,observability-audit.md,production-readiness.json}` + `tests/test_p44_operational_readiness.py`。

### DLT P4-3 PRODUCTION INTEGRITY / PUBLICATION LIFECYCLE HARDENING（本地 commit，未 push/deploy）

**类型**: fix（publication 完整性）+ test + docs
**目的**: 仅做 production integrity / publication lifecycle hardening（不改变 recommendation
semantics、不动算法/scoring/weights/analysis window/RNG contract、不重生历史 publication）。

**审计（只读）发现的两个 in-scope 缺陷并已修复**:
| 缺陷 | 级别 | 根因 | 修复 |
|---|---|---|---|
| G1 | CRITICAL (I3/I4/I12) | 损坏的 `published_recommendations.json` 在下次 upsert 时被**静默重置为空 store**，抹掉全部历史不可变快照 | F1：`upsert_published_snapshot` 检测「文件已存在但不可解析为合法 store」→ 返回 `corrupt` 且不写盘；`publish()` 对 `corrupt` fail-closed（不写 display）。仅文件真不存在才首次创建 |
| G2 | HIGH (I5) | `_write_json` 用 `open(path,"w")+json.dump`（先 truncate），中途崩溃留半写/损坏文件 → 是 G1 的根因触发器 | F2：改为同目录 `tempfile.mkstemp` + `fsync` + 原子 `os.replace`；失败清理 temp，不留下半写目标 |

**修改（最小 diff）**: 仅 `src/publisher.py`（F1 upsert 早退 + `publish()` 的 `corrupt` 分支 + F2 原子写）。
算法 / selector / scoring / weights / analysis window / RNG contract / 历史 snapshot 全部 UNCHANGED。

**验证**:
| 项 | 结果 |
|---|---|
| G1 corrupt-store | 返回 `corrupt`、文件不被改写、历史 26112/26113 保留 |
| G2 atomic write | 无 `.tmp` 残留；失败不留半写 |
| 对抗场景 A–L | 全部 PASS（幂等 / conflict / history-lag / 并发 / 部分失败 / 重试 / 乱序 / malformed / hash 一致性 / 前端权威 / 部署隔离 / 确定性） |
| 全量回归 | P4-1 28 + Guard 17 + P4-2 12 + P4-3 23 + publisher 30 = **110 tests PASS** |
| 26112 immutable | hash `bea8ef87...` 复核不变 |

**产物**: `src/publisher.py`（F1/F2）、`tests/test_p43_publication_integrity.py`（23 tests）、
`reports/p43-publication-lifecycle-baseline.md`、`reports/p43-publication-callgraph.md`、
`reports/p43-integrity-audit.{json,md}`、`docs/architecture/P43-PUBLICATION-INTEGRITY-CONTRACT.md`。

### DLT P4-2 PRODUCTION WORDING INTEGRITY（文案与 P2/P3 研究结论对齐，本地 commit）

**类型**: fix（前端文案）+ test + docs
**目的**: 使生产用户可见文案与 P2/P3 已确认的研究结论一致——大乐透是**历史数据分析 + 娱乐推荐工具**，**不是**彩票预测系统；移除/限定任何暗示"当前产品具有预测能力"的措辞。不提升预测能力，仅对齐措辞。

**修改（MINIMAL，仅 public 文案，不动算法/scoring/weights/snapshot/UI 逻辑）**:
| 文件 | 旧措辞 | 新措辞 |
|---|---|---|
| `public/experiment.html` | 预测目标期号： | 娱乐推荐目标期号： |
| `public/experiment.html` | 模型：（推荐区） | 分析策略： |
| `public/experiment.html` | 预测次数（表头） | 回测次数 |
| `public/experiment.html` | 胜随机（表头） | 相对随机基线 |
| `public/experiment.html` | 每日实验预测任务 | 每日实验任务 |
| `public/experiment.js` | 表头 "胜随机" | "相对随机基线" |
| `public/experiment.js` | 排行榜 badge "胜" | "略优"（列名已限定为相对随机基线） |
| `public/experiment.js` | "「胜随机」…不构成显著证据" | "「相对随机基线」…未确认优于随机基线" |

**允许保留（A 类：否定/免责/历史研究语境）**: "不构成…预测"、"非预测目标"、"不衡量预测能力"、"不代表真实预测模型"、"负期望游戏"、"理性购彩"、index.html "本期唯一推荐 / 娱乐推荐 / 不等于中奖预测"。

**产物**: `reports/p42-wording-audit.md`（人读审计）、`reports/p42-wording-audit.json`（机器可审计 regression）、`tests/test_p42_wording_integrity.py`（12 断言回归测试）。

**完整性**: recommender/scoring/weights/analysis-window/snapshot/recommendation-algorithm 全部 UNCHANGED；26112 snapshot hash `bea8ef87...` 复核不变；exactly-one-final-recommendation 语义保留；exactly-one 生产推荐与 A/B/C/D internal-only 不变。

### DLT P4-1 DETERMINISTIC RECOMMENDATION REPRODUCIBILITY GATE（production hardening，本地 commit，未 push/deploy）

**类型**: fix（生产推荐 RNG 可复现性）+ docs + test
**Gate 结论**: P41_CODE_GATE = PASS（所有测试 PASS；PRODUCTION_DEPLOY_AUTHORIZED = NO）

**目标**: 让同一 publication context 重复执行 C candidate generation 得到完全相同结果
（REPRODUCIBLE = YES），而非追求历史命中提升。

**根因**: 生产 `config/settings.yaml` `recommend.seed: null` → `recommender.recommend()`
`rng = random.Random(None)` → OS entropy 播种，A/B/C 每次生成不同。

**修复（最小 diff）**:
- 新增 `src/deterministic_rng.py`：`derive_deterministic_seed` / `publication_seed`，
  基于 `hashlib.sha256`（stdlib，无新依赖）。seed = SHA-256(game_id|target_issue|strategy_id|algorithm_version) → 256-bit int。
- `src/scheduler.py`：`seed=None`（生产默认）时注入 publication-bound deterministic seed；显式 seed 原样透传（向后兼容）；缺失 identity 分量 fail-closed（`SeedDerivationError`，绝不回退 seed=None）。

**seed 契约**: 相同 identity → 永远相同 seed；不同 target_issue / algorithm_version / strategy_id → 不同 seed。
seed 为可复现命名空间键，**不读命中率 / backtest / P2P3 best-seed**（STEP 11: SEED USES HIT PERFORMANCE = NO）。

**验证**:
| 项 | 结果 |
|---|---|
| RNG DEFECT CONFIRMED | YES（before：12/12 contexts × 20 repeats 产生 20 个不同 C） |
| SAME CONTEXT REPEATABLE | YES（100 contexts × 10 repeats，unique=1，100/100） |
| CROSS PROCESS REPEATABLE | YES（20 contexts，process A == B，20/20） |
| EXPLICIT SEED BACKWARD COMPATIBLE | YES（seed 0/1/20260930 结果不变） |
| PUBLICATION SEMANTIC IDEMPOTENT | YES（snapshot_hash 排除 published_at；upsert 幂等） |
| CONCURRENT GENERATION CONSISTENT | YES（双 worker 同 payload） |
| SEED COLLISIONS | 0（1000 synthetic identities） |
| A / B / D / SELECTOR / WEIGHTS / 1000 CAP / 26112 / UI | 全部 UNCHANGED |

**产物**: `src/deterministic_rng.py`、`src/scheduler.py`（仅 seed 注入块）、`tests/test_p41_deterministic_rng.py`（28 tests / 41 assertions）、`docs/architecture/DETERMINISTIC-RNG-CONTRACT.md`、`reports/p41-rng-{callgraph.md,before.json,after.json}`、`reports/p41-seed-contract.json`、`reports/p41-production-diff.json`、`reports/P41-DETERMINISTIC-RNG-REPORT.md`、`scripts/p41_{repro_before,determinism_after,check_26112}.py`。

**完整性**: 仅 `src/scheduler.py` 为 tracked 修改；26112 快照 hash `bea8ef87f3f137238686ae52712f922956215408f0cf54187b9295d8f1ae5fad` 复核不变；无 experiment.html / UI / CSS / P4-2 内容改动；未 push、未 deploy。

---

## 2026-10-01

### DLT P3-5 RESEARCH CLOSURE & PRODUCTION SIMPLIFICATION DECISION GATE（research only，本地 commit，未 push/deploy）

**类型**: research（收口决策）+ docs
**Gate 结论**: P3-5 = PASS（P3 研究阶段收口；NO PRODUCTION CHANGE；P3 RESEARCH PHASE = CLOSED）

**目标**: 基于 P2+P3 全部 OOS/holdout 证据，判断当前生产推荐链复杂度的证据支持度、
可简化度与 RNG 可复现性；形成 P35 生产方向建议 + 研究停止规则 + 未来实验契约。

**产物**:
| 文件 | 说明 |
|---|---|
| `src/evaluation/research_closure.py` | 证据台账 / 组件 inventory + 分类 / B0-B7 baseline / 复杂度成本 / 简化反事实 / RNG+1000cap 决策 / 三生产方案 / 停止规则 / 产品语义审计 / P2-P3 统一解释 |
| `scripts/evaluate_research_closure.py` | P3-5 runner（integrity 校验 → 各 artifact 生成） |
| `tests/test_p35_research_closure.py` | 27 断言（≥25） |
| `reports/p35-evidence-ledger.json` | P2-1→P3-4 冻结证据台账（7 gate） |
| `reports/p35-component-inventory.json` | 22 组件 role + 证据分类 |
| `reports/p35-baseline-comparison.json` | B0-B7 指标 + 复杂度成本 + 简化反事实 |
| `reports/p35-production-options.json` | 三方案 + direction + RNG + cap + 停止规则 + 产品语义审计 |
| `reports/P35-SIMPLIFICATION-DECISION.md` | 最终决策报告 |
| `reports/P3-RESEARCH-CLOSURE.md` | P3 全阶段收口总结 |
| `docs/research/EXPERIMENT-CONTRACT.md` | 未来研究契约（10 条 + STOP 规则） |

**核心结论**（1930 OOS；B0-B7 复用 P3-2 cache + P3-4 重建）:
- **B7_CURRENT（最复杂：5 因子 + OOS walk-forward + 4 候选 + selector）full mean 1.0544，
  在 8 个 baseline 中排倒数第 3**（B3 fixed-C 1.0731 / B5·B6 random-choice 1.0636 之上，
  B4 fixed-D 1.0513 / B0 随机票 1.0508 之上）
- 简化反事实：CURRENT vs random-choice Δ=-0.020（CI 含 0）；vs fixed-D Δ=+0.057（CI 含 0）
  → **不得声称复杂 selector 有实际收益**
- C RNG 可复现性风险 = **YES**（seed=None 不可复现；本 Gate 标记 REPRODUCIBILITY_RISK，不改）
- 1000-draw 窗口决策 = **KEEP_1000_TEMPORARILY**（区分 DATA RETENTION 与 ANALYSIS WINDOW；无确认性证据）
- P2/P3 统一解释：所有表观 edge 在 fair-null + Holm + holdout + 可复现口径下消失；
  流水线是**娱乐/分析系统，非预测器**
- 产品语义：explanation.py 免责 PASS；experiment.html 预测性措辞标记待未来修订（本 Gate 不改 UI）

**P35_RECOMMENDED_PRODUCTION_DIRECTION = KEEP_CURRENT_TEMPORARILY**（simplification_warranted_for_engineering=True，
但**非部署授权**；任何修改须走独立 production-change Gate）。

**研究停止规则（STEP 15）**: 无独立于现有历史统计体系的新可检验假设前，
STOP FEATURE MINING / SELECTOR TUNING / ML ESCALATION；未来研究须先按
`docs/research/EXPERIMENT-CONTRACT.md` 预注册。

**生产完整性**（未改）: 生产文件 / 26112 snapshot / recent_issues=1000 / dataset SHA 全部 UNCHANGED；
PUSH NO / DEPLOY NO。

**回归**: `tests/test_p35_research_closure.py` 27/27 OK。

**P3 RESEARCH PHASE = CLOSED**（P3-1..P3-5 全部 PASS；等待下一阶段正式决策）。

---

### DLT P3-4 SELECTOR EDGE DECOMPOSITION & ROBUSTNESS GATE（research only，本地 commit，未 push/deploy）

**类型**: research（机制分解）+ docs
**Gate 结论**: P3-4 = PASS（无 selector edge；机制已分解，NO PRODUCTION CHANGE）

**唯一研究问题**: 解释 CURRENT selector 早期表观优势（P2-2 S1 vs S7 Δ=0.051, Holm p=0.102 未确认）
究竟来自什么机制，且为何 P2-3/P3-2 final holdout 未确认。

**产物**:
| 文件 | 说明 |
|---|---|
| `src/evaluation/selector_decomposition.py` | 重建 CURRENT selector（真实 compute_final_scores + walk-forward OOS）+ 全部分解（candidate set / selection-conditional / 4×4 counterfactual / pairwise / margin / component / correlation / rolling+quintile / leave-era-out / freq-matched null / conditional strata null / C 100-seed / seed×era / H1-H4 confirmatory / 机制标签） |
| `scripts/evaluate_selector_edge.py` | P3-4 runner（definition 先冻结 → consistency 校验 → 分解 → dev 假设冻结 → holdout 一次确认 → 机制标签） |
| `tests/test_p34_selector_decomposition.py` | 34 断言（含 30+ 必需项） |
| `reports/p34-selector-definition.json` | 冻结定义（含 definition_sha256） |
| `reports/p34-selection-before-holdout.json` | holdout 前冻结机制假设 |
| `reports/p34-selector-results.json` | 全量结果 |
| `reports/P34-SELECTOR-EDGE-REPORT.md` | 最终报告 |

**核心结论**（1930 OOS；dev 1544 / holdout 386；frequency-matched + conditional 1000 perm；C 100-seed；Holm）:
- 一致性：`pick_T0`（生产 selector）== manual `compute_final_scores` on P2-3 cache，**0/900 mismatch**
- CURRENT selector mean = **1.0544（full OOS）/ 1.0363（holdout）**，**低于** fair-random（1.0563）与 frequency-matched null（1.0616）
- candidate set：`CURRENT − candidate mean4 = −0.0092`（selector 比随机选自家候选还差）；候选 hits 两两 pearson ≤ 0.116、pairwise 差异≈0（大量 tie）→ 候选近似可互换
- selection-conditional：C 选中时 C 均值 0.9294 < 无条件 1.0731（uplift −0.1436）；counterfactual：C 选中期中 D/A 反而更高 → selector 在差时期追 C，非识别 C 优势
- margin：Spearman(margin, advantage) ≈ 0（full −0.0066 / holdout +0.046）→ **SELECTOR CONFIDENCE NOT CALIBRATED**
- confirmatory H1-H4：全部 **Holm p = 1.0**，效应量 ≈ 0
- 机制标签：**SEED_DEPENDENT + UNCALIBRATED_SELECTOR + ERA_DEPENDENT + NOISE_COMPATIBLE**（无 ROBUST_SELECTOR_EDGE）
- **结论：无稳定 selector edge；早期表观优势 = 候选可互换 + C 结构性偏好 + seed 偶然性 + era 波动 + 高噪声 sample noise，非真实预测能力**
- **ML RECONSIDERATION WARRANTED: NO**（需 stable + holdout-confirmed + seed-robust + era-robust 机制，均未满足）

**生产完整性**（未改）:
- selector / 权重 / candidate / C seed / recent_issues=1000 / production dataset / 26112 snapshot / frontend 全部 UNCHANGED
- 9 个生产文件 baseline SHA 复验一致；26112 hash `bea8ef87…`；PUSH NO / DEPLOY NO

**回归**: `tests/test_p34_selector_decomposition.py` 34/34 OK；dataset SHA `ba4bfb09…` 复验一致；consistency 0/900。

---

### DLT P3-3 FEATURE VALIDITY & ABLATION GATE（research only，本地 commit，未 push/deploy）

**类型**: feat（评测研究）+ research
**Gate 结论**: P3-3 = PASS

**目标**: 评估当前推荐系统使用的历史统计特征是否具有严格 OOS 信息价值（非调权重）。

**产物**:
| 文件 | 说明 |
|---|---|
| `src/evaluation/feature_study.py` | LEVEL 1 单号特征 + 度量（AUC/Spearman/decile-lift）+ null + 冗余 + 候选特征 + inventory（生产函数驱动 + 泄漏断言） |
| `src/evaluation/feature_ablation.py` | D 策略 9 个 one-feature-at-a-time 消融（真实 recommend()；权重 zero + 内建归一化，结果前冻结规则） |
| `scripts/evaluate_features.py` | P3-3 runner（definition 先冻结 → dev-only → pre-holdout 冻结 → holdout 一次确认） |
| `scripts/_p33_ablation_worker.py` | shell-level 并行消融 worker（10 进程，复用 P3-2 模式） |
| `tests/test_p33_feature_study.py` | 34 项断言（+2 额外 = 36） |
| `reports/evaluation/p33-feature-definition.json` | 冻结定义（含 definition_sha256） |
| `reports/evaluation/p33-feature-selection-before-holdout.json` | holdout 前冻结假设 |
| `reports/evaluation/p33-feature-results.json` | 全量结果 |
| `reports/evaluation/P33-FEATURE-STUDY-REPORT.md` | 最终报告 |

**核心结论**（1930 OOS；dev 1544 / holdout 386；50-seed null；Holm + BH-FDR）:
- LEVEL 1 单号特征：前/后区全部特征 ROC-AUC ≈ 0.49–0.51、|Spearman| ≤ 0.01 → **无判别力**
- LEVEL 2 候选特征：|Spearman| ≤ 0.03（与命中数无关联）
- D 消融：9 个 one-feature-at-a-time 全部 Holm p = 1.0（移除任何特征都不显著改变 OOS 命中）
- 冗余组：`cur_omit~omit_ratio`(ρ≈0.99)、`freq_ratio~avg_omit`(ρ≈0.89)
- **SUPPORTED 特征 = 0**；FRONT/BACK frequency·omission·hot/cold·structure = 全部 UNSUPPORTED/REDUNDANT/INCONCLUSIVE
- **结论：NO IDENTIFIABLE PREDICTIVE FEATURE**；策略为对无预测力历史的娱乐选择器，无法超过不变随机基线
- **ML 不被证据支持**（基础特征无稳定 OOS 信号 → ML 只会扩大过拟合空间）

**生产完整性**（未改）:
- 算法 / 权重 / selector / window / 1000 cap / 26112 snapshot / frontend 全部 UNCHANGED
- 9 个生产文件 baseline SHA 复验一致；`recent_issues=1000`；26112 hash `bea8ef87…`
- PUSH: NO / DEPLOY: NO

**回归**: `tests/test_p33_feature_study.py` 36/36 OK；dataset SHA `ba4bfb09…` 复验一致；消融 cache 与直接 `recommend()` equivalence 抽样一致。

---

## 2026-09-30

### DLT 产品基线里程碑（WP0 恢复 → P0/P1 全链路 → CHECKPOINT-1 受控提交）

**类型**: feat + docs + chore（恢复与产品基线）

**背景**:
- 本地工作区曾处于 mid-rebase 破坏态（73 文件被删），以 push-clean bundle 为唯一可信源完成 WP0 恢复，并在恢复之上建立 P0/P1 产品基线。

**本次已提交的 5 个本地 commit（均在 master，领先 origin/master 5 个，未 push）**：

| Commit | 内容 |
|---|---|
| `6d4170b` | docs: 恢复历史研究/项目记录（docs/history、docs/research、reports/archive、DECISIONS、Gate4 批准项，46 文件） |
| `282670c` | chore: 移除退役推荐路径（api_server.py、src/generate_recommendation.py、src/recommendation_adapter.py、daily-recommend.yml，均 0 生产引用） |
| `1fa2235` | feat: P0 不可变发布快照 + P1-1 唯一推荐前端 + P1-2 确定性解释引擎（src/publisher.py、src/explanation.py、public/app.js、public/index.html + 4 个测试文件；P0 与 P1-1/P1-2 在 app.js 内 hunk 互锁，合并为 1 commit 避免 broken intermediate） |
| `fb31d45` | feat: P1-3A 移动优先趋势页三层 IA + P1-3B 连接轨迹视图（public/trend-v2.{html,js,css} + p13a/p13b 契约测试，原生 SVG、无第三方 chart 库、历史描述性无预测文案） |
| `e63f552` | merge: 合入远端 52 个每日数据更新（dlt_history → 26111/2026-09-28；推荐目标期 26112 > 已开 26111；恰好 1 个 is_primary；未改算法） |

**数据新鲜度（RELEASE-1 STEP 2 硬门禁）**:
- ✅ history 最新已开奖 = 26111（2026-09-28）；推荐目标期 = 26112 > 已开奖期
- ✅ 恰好 1 个 `is_primary`（C-纯随机娱乐型，D1 锁定值）

**回归**:
- P0 snapshot 26 OK · P1-1 ALL PASS · P1-2 10 OK · P1-3A ALL PASS · P1-3B ALL PASS
- `node --check` app.js / trend-v2.js OK；现存 Python py_compile OK

**未提交/保留项**:
- `.agnes/`、`.recovery-import/`（bundle + tar.gz 恢复源）、`tmp5gn2ua3v/`（P0 临时 fixture）→ intentional untracked，不 commit、不删除
- 恢复备份 `/Users/Shared/projects/.recovery-backup-20260930` 保留

**状态**:
- 本地 master = `e63f552`（ahead 5 / behind 0）；**push 阻塞**：环境无 github.com HTTPS 凭据（keychain 无、.netrc 无、GH_TOKEN 无），需用户提供 token 后执行 `git push origin master`；随后经 `dlt-analysis.yml` workflow_dispatch 触发 CI 完成 Cloudflare 部署（需 CLOUDFLARE_API_TOKEN）

## 2026-08-28

### Phase 16 Step 7 - 实验调度器 CI 失败隔离加固 (P1)

**类型**: fix

**问题**:
- STEP 1 只读检查发现：`.github/workflows/dlt-analysis.yml` 中 `experiment_scheduler --daily`(原 203 行) 与 `--weekly`(原 311 行) 两步骤缺少 `|| echo` 失败隔离，而同 job 的 data_quality/monitor/build 步骤均有。CI 默认 `set -e`，调度器一旦非零退出会中止后续生产 commit/deploy，违反"实验失败不阻断生产"原则。

**修复**:
- analyze 作业 `--daily` 步骤末尾追加 `|| echo "experiment scheduler 失败（已隔离，不阻断生产）"`
- weekly-experiment 作业 `--weekly` 步骤末尾追加 `|| echo "experiment scheduler 失败（已隔离，不阻断生产）"`
- 与 data_quality/monitor/build 步骤失败隔离策略一致

**验证**:
- ✅ `python -m yaml` 解析 yml 语法通过
- ✅ `data/structure_profile.json` SHA256 仍为 `ef678954…`（生产冻结文件未触碰）
- ✅ `git show --stat` 确认仅 `.github/workflows/dlt-analysis.yml`（+4/-2）入提交

**影响范围**:
- ✅ 仅 CI 配置，零改实验/生产逻辑；调度器行为未变（仅非零退出不再阻断生产）

**风险**:
- 低（ADD-ONLY 追加失败隔离，与既有步骤一致）

**部署**: 待推送后由 GitHub Actions 自动生效（本地已 commit `7b3876f`，未 push 以免带入工作区 pre-existing 改动 / 覆盖远程每日提交）

## 2026-08-22

### Phase 10 Recovery R5 - 生产监控与自动验收基础建设

**类型**: chore

**新增**:
- **文件**: `scripts/check-production.sh`
- **内容**: 生产环境自动检查脚本（首页 HTTP 200 / 关键资源 200 / index.html 含平台标识且不含 final_recommendation / app.js 不含 final_recommendation / recommendations.json 可解析；输出 PASS/FAIL，退出码 0/1 便于 CI/定时任务接入）
- **文件**: `docs/ROLLBACK.md`
- **内容**: 如何回滚至 `production-stable-v1.0`（git tag/checkout + 重新部署 + 线上验证），明确红线
- **文件**: `docs/production-version-design.md`
- **内容**: 生产版本标识方案设计（方案 A meta / B version.json / C release.json，推荐 B）

**验证**:
- **脚本运行**: ✅ `bash scripts/check-production.sh` 输出 Result: PASS，正式域名全部资源 200
- **设计**: 版本标识仅设计未实施（Step 4 要求等待用户确认）

**影响范围**:
- ✅ 仅新增监控/验证工具与文档，未修改首页/算法/UI/数据结构
- ✅ 全部新增文件可回滚（纯新增，无既有文件被破坏）

**风险**:
- 低（只读检查 + 新增独立文件）

### Phase 10 Recovery R5.2 - 生产运行错误修复（Hotfix）

**类型**: fix

**问题**:
- 生产首页 `https://500wan.mootlsv.com/` 报 `Cannot set properties of null (setting 'textContent')`，推荐数据不显示

**原因**:
- `public/app.js` 第 272 行 `document.getElementById("rec-target").textContent = ...` 引用了 `index.html` 中不存在的元素 `rec-target`
- 该语句位于 `if (recs.length)` 内，一旦 `recommendations.json` 有数据即必崩；异常被 `.catch` 捕获后隐藏 `#content` 显示错误框，导致"首页无推荐数据"

**修复**:
- `public/index.html`：在「本期智能推荐」区块补充 `<span id="rec-target">—</span>`（展示预测期号，保持原布局）
- `public/app.js`：第 272 行增加 null 防护（`var recTargetEl = ...; if (recTargetEl) recTargetEl.textContent = ...`）
- `public/app.js`：渲染主流程外包 try/catch，任何 DOM 查询失败优雅降级而非白屏

**验证**:
- **本地**: ✅ Node DOM 桩执行渲染逻辑（正常 + 缺失 rec-target 两种场景）均无 TypeError，推荐数据正常渲染（1629 字符）
- **部署**: ✅ `wrangler pages deploy public --project-name dlt-assistant --branch master` 实际执行成功（Deployment complete → 绑定 500wan.mootlsv.com）
- **线上**: ✅ 生产版 app.js + 生产数据 Node 执行无异常；index/app.js/dlt_history.json/recommendations.json 全部 200；首页含 `id="rec-target"`

**影响范围**:
- ✅ 仅首页推荐区预测期号展示修复 + 防御性 null 防护，未改算法/数据结构/UI 布局/新增功能

**风险**:
- 低（最小热修复，已本地与生产双重验证）

**回滚**:
- `git revert 8d33a15` 或 `git checkout 36d9bfc -- public/`，重新部署即可

### Phase 10 Recovery R5.3 - 生产恢复人工验收

**类型**: verify

**范围**: 仅人工验收与生产版本确认，无代码/配置改动

**当前运行版本（只读确认）**:
- **远程 master / 本地 HEAD**: `a1661b9`（含 R5.2 文档记录）
- **最新修复 commit**: `8d33a15`（fix: repair homepage recommendation render crash）
- **production-stable-v1.0 标签**: `36d9bfc`（冻结基线，未含 R5.2 热修复——符合预期，热修复为独立 commit）
- **生产实际代码**: Cloudflare 部署已含修复（`index.html` 含 `id="rec-target"`；`app.js` 含 `recTargetEl` 防护 + `catch (e)` 安全网）；首页 / app.js / recommendations.json / dlt_history.json 全部 HTTP 200

**用户人工验收结论（2026-08-22 22:01）**:
- ✅ 首页正常，无 `Cannot set properties of null`，无红色错误提示
- ✅ 最新开奖数据（26094 期）、推荐区域、预测期号（26095）、A/B/C/D 策略均正常显示
- ✅ 五个模块（首页 / 数据分析 / 智能选号 / 趋势分析 / 我的方案）切换正常
- ✅ Console 无 TypeError / JavaScript error / 404 资源错误
- ✅ 确认 R5.2 修复有效

**影响范围**:
- ✅ 仅文档记录与版本确认，未触碰任何生产代码或数据结构

**风险**:
- 无（验收通过，处于只读维护冻结状态）

### Task: Phase 10 Recovery R2 - 生产稳定基线确认

**类型**: refactor

**修改**:
- **文件**: 状态文档、日志、协议
- **内容**: 
  - 创建生产稳定基线 `production-stable-v1.0`
  - 更新 `TASK_STATUS.md` 基线表
  - 更新 `CHANGELOG.md` 记录
  - 制定 Feature Change Protocol 变更协议

**验证**:
- **Git 状态**: ✅ `master` 分支，仅未跟踪文件
- **生产验证**: ✅ `https://500wan.mootlsv.com/` 所有资源 200
- **数据完整性**: ✅ 4 策略 + 历史数据完整
- **标签创建**: ✅ `git tag -a production-stable-v1.0`

**影响范围**:
- ✅ 明确生产基线版本
- ✅ 建立变更控制机制
- ✅ 回滚方案确认
- ✅ 禁止修改区域明确

**风险**:
- 生产稳定基线冻结

---

### Phase 10 Recovery R2 - 执行与修复

**类型**: fix

**提交**:
- `1de051d`: 空提交，触发 Cloudflare Pages 重新部署
- `a1e7e35`: 修复错误提示，将 `final_recommendation.json` 改为 `recommendations.json`

**执行内容**:
1. ✅ Git 只读检查 (status, log, remote)
2. ✅ 生产资源 HTTP 验证 (HTML/JS/JSON)
3. ✅ CDN 缓存问题定位 (max-age=14400, cf-cache-status: REVALIDATED)
4. ✅ 触发 GitHub Actions 重新部署
5. ✅ 部署成功确认 (大乐透 AI 娱乐分析 completed success)
6. ✅ 修复 `public/index.html` 第 52 行错误提示
7. ✅ 生成验收报告 `Phase10-R2-生产稳定基线验收报告.md`
8. ✅ 更新记忆文件 `.workbuddy/memory/2026-08-22.md`

**问题诊断**:
- **核心问题**: 浏览器缓存旧版本 JS，导致 "Cannot set properties of null" 错误
- **根本原因**: `index.html` 提示文本仍引用 `final_recommendation.json`（代码逻辑已无此引用）
- **CDN 状态**: 首页 `DYNAMIC`, app.js `REVALIDATED`，缓存已刷新

**修复措施**:
- 空提交触发 Cloudflare 自动部署
- 修复错误提示文本，与代码逻辑保持一致
- 用户需手动清除浏览器缓存 (Ctrl+Shift+Del)

**影响范围**:
- ✅ 生产环境资源完整性确认
- ✅ CDN 缓存刷新成功
- ✅ 错误提示与代码逻辑一致
- ⚠️ 用户需清除浏览器缓存后重新验证

**文档产出**:
- `Phase10-R2-生产稳定基线验收报告.md`
- 更新 `.workbuddy/memory/2026-08-22.md`
- 更新 `TASK_STATUS.md`
- 变更需严格遵循协议
- 回滚路径明确

---

## Phase 10 Recovery R3.2

**类型**: fix

**问题**:
- 生产环境 `https://500wan.mootlsv.com/` 未同步最新 `index.html`（第 52 行错误提示仍显示 `final_recommendation.json`）

**原因**:
- GitHub Actions workflow `32547242570` 在"提交更新（数据与报告）"步骤 `git push` 被拒绝（非快进合并）
- 导致后续"部署到 Cloudflare Pages"（`wrangler pages deploy`）从未执行
- 生产环境停留在旧 commit，未包含 `a1e7e35` 修复

**修复**:
- 同步本地 HEAD 至 `bf4b7cb`，创建空提交 `36d9bfc` 触发部署
- 通过 GitHub API 重新触发 workflow_dispatch `32574914238`（completed success）
- `wrangler pages deploy` 成功执行，部署至 Cloudflare Pages

**验证**:
- ✅ 正式域名恢复：第 52 行显示 `data/recommendations.json`（非 `final_recommendation.json`）
- ✅ 所有静态资源（index.html / app.js / recommendations.json / dlt_history.json）返回 200 OK
- ✅ 标签 `production-stable-v1.0` 已更新至 `36d9bfc`（R4 冻结基线）

---

### Task: Phase 10 Recovery R1 - 首页推荐恢复

**类型**: fix

**修改**:
- **文件**: `public/app.js`
- **内容**: 
  - 回退到 72e9e35^ 版本
  - 移除 `final_recommendation.json` 依赖
  - 恢复 `recommendations.json` 数组格式加载
  - 恢复首页推荐展示功能

**验证**:
- **本地**: ✅ HTTP 8888 正常，数据渲染无错误
- **部署**: ✅ GitHub Actions 自动构建完成
- **线上**: ✅ https://500wan.mootlsv.com/ 正常显示

**影响范围**:
- ✅ 首页推荐展示恢复正常
- ✅ 4 种策略 (A/B/C/D) 完整加载
- ✅ 无功能退化
- ✅ 无 UI 变化

**风险**:
- 降级机制恢复
- 兼容性确认通过
- 回滚方案明确

---

## 2026-08-22 (之前)

### Task: Phase 10 Recovery R0 - 问题定位

**类型**: fix

**修改**:
- **文件**: 诊断报告 `task36-R8-recovery-report.md`
- **内容**: 问题定位与恢复方案制定

**验证**:
- **诊断**: ✅ Git 历史分析完成
- **确认**: ✅ 问题根源 `72e9e35` 提交
- **方案**: ✅ 回退方案确认

**影响范围**:
- 明确恢复路径
- 风险评估完成

---

## 2026-08-21

### Task: Daily Analysis - 每日数据分析

**类型**: chore

**修改**:
- **文件**: `data/dlt_history.json`
- **内容**: 每日大乐透开奖数据统计更新

**验证**:
- **本地**: ✅ JSON 数据生成成功
- **部署**: ✅ GitHub Actions 自动部署

**影响范围**:
- 历史数据完整性保持

---

## 早期版本

### Phase 17.5: 新版选号引擎上线

**类型**: feat/refactor

**修改**:
- **文件**: 前端组件、数据生成器、部署配置
- **内容**: 新版选号引擎静态化部署

**验证**:
- **本地**: ✅ 组件测试通过
- **部署**: ✅ Cloudflare Pages 部署完成
- **线上**: ✅ 功能验证通过

**影响范围**:
- 选号功能升级
- 静态化架构优化

---

## 记录说明

### 记录格式

- **日期**: 变更发生的日期
- **Task**: 关联的任务编号
- **类型**: feat/fix/refactor/docs/chore
- **修改**: 具体修改的文件和内容
- **验证**: 本地/部署/线上验证结果
- **影响范围**: 变更影响的功能模块
- **风险**: 风险评估和缓解措施

### 更新规则

1. **每次任务完成**必须记录
2. **重要变更**必须详细记录
3. **部署成功**必须包含线上验证
4. **风险评估**必须明确

---

## Feature Change Protocol (功能变更协议)

**生效日期**: 2026-08-22  
**基线版本**: `production-stable-v1.0`

### 变更流程（Step 1-8）

1. **任务立项**
   - 编号格式：`Phase NN Task #XX`（如 `Phase 11 Task #37`）
   - 明确变更目标与范围
   - 评估风险与回滚方案

2. **基线检查**
   - 读取当前 `TASK_STATUS.md`
   - 确认 Git 状态（`git status` / `git log`）
   - 确认生产地址正常

3. **只读分析**
   - 读取相关文件内容
   - 分析影响范围
   - **不修改任何代码/配置**

4. **方案确认**
   - 提交设计方案给用户
   - 等待明确指令
   - 确认修改文件列表

5. **增量修改**
   - 小步提交，每次修改不超过 3 个文件
   - 本地验证通过后再 Git commit
   - 使用规范的 commit message（feat/fix/refactor/docs/chore）

6. **部署验证**
   - GitHub Actions 自动部署
   - **必须验证官方域名** `https://500wan.mootlsv.com/`
   - 仅 `*.pages.dev` 临时地址无效

7. **记录落盘**
   - 更新 `TASK_STATUS.md`
   - 更新 `CHANGELOG.md`
   - 生成任务报告 `taskXX-*.md`

8. **最终确认**
   - 输出「任务已完成，等待确认」
   - 等待用户下一阶段指令

### 禁止项

- ❌ **禁止直接修改生产代码**（无任务立项）
- ❌ **禁止仅验证 pages.dev 地址**（必须官方域名）
- ❌ **禁止部署前不本地验证**
- ❌ **禁止数据结构变更无兼容性确认**
- ❌ **禁止删除旧数据文件**（保持向后兼容）
- ❌ **禁止大规模重构**（小步增量）
- ❌ **禁止连续修改无 Git commit**（每次修改后提交）

### 任务编号规范

- **Phase 11**: 新功能设计 → `Phase 11 Task #37`, `Phase 11 Task #38`...
- **Phase 10 Recovery R3**: 推荐系统重新设计 → `Phase 10 Task #39`, `Phase 10 Task #40`...

---

**版本**: v1.0  
**生效日期**: 2026-08-22
