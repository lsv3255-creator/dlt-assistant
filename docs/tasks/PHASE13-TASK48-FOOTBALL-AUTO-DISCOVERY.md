# Phase 13 Task #48 — 足彩自动换期与球队存档（进行中）

## 用户口径（2026-10-15 确认）

- 足彩必须自动更新官方期号、自动切换新一期并冻结，不再人工录入赛程。
- 存档口径按预测用途划分：足彩赛果/开奖历史不存当前期之外的长期库；
  但球队档案与球队历史信息必须存档，且每一期都要抓最新球队动态
  （近期状态、伤停、休息天数、历史交锋），否则预测没有依据。

## 第一步：自动发现与换期（本任务）

- 官方 sporttery 站点对自动化访问返回 EdgeOne WAF 567（浏览器与脚本
  均被拦截），定为不可用源；自动发现改用澳客足彩页：期号页签标有
  「当前」期，含 14 场对阵、联赛排名、平均赔率与停售时间，并预告
  后续期号。
- `src/football/discovery.py`：解析澳客期次页 → 完整性校验（恰好
  14 场、赔率齐全）→ 通过 `engine.validate_issue` 才允许写入
  `data/football/current_issue.json`；任何失败抛 `DiscoveryError`，
  文件保持原样。
- `scripts/football_cycle.py` 在生成分析前先尝试自动刷新：发现新一
  期则切换（`switched`），同期场次/赔率变化则更新数据
  （`refreshed`），无变化为 `unchanged`；异常时打印
  `football_discovery_fallback` 并沿用原文件，冻结机制
  （`freeze_existing_recommendation`）保持不变，同一切换不改已发布
  推荐。
- 澳客队名为简称，用已按 26143 期官方对阵核验过的映射表补全称。

## 已知限制

- 足彩工作流的回写清单（workflow 文件内）只含公开结果与 archive，
  `current_issue.json` 的发现结果暂不回写仓库（GitHub App 无
  workflows 权限，暂不能改工作流文件）；数据库与正式站以每次运行
  的发现结果为准，功能不受影响。
- 澳客对 GitHub Actions 出口的放行情况以合并后首跑日志为准；若被
  拦，`football_discovery_fallback` 会出现在日志中且站点保持现期。

## 第二步（待本步验收后）

- 球队存档：球队档案表/文件（球队、联赛、排名、历史交锋、近期战
  绩）长期累积，与赛果历史分开。
- 每期抓最新球队动态，填充引擎现有四个空位因素：recent_form、
  injuries、rest_days、head_to_head。
