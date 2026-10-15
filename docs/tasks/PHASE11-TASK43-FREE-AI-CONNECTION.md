# Phase 11 Task #43 — 在线免费模型连接验证

项目：大乐透 zzz7491/dlt-assistant
位置：.github/workflows/dlt-ai-connection.yml
必须遵守：不改现有号码/单注/复式/冻结快照/复盘/部署；不打印密钥、认证头或上游错误正文。

用户已创建 OpenRouter 账号密钥，并于 2026-10-15 08:31 确认三个仓库机密保存完成。优先在线免费模型，不使用本地模型，不自动转付费。
新增只读 GitHub Actions 验证：三个配置存在、仅允许 https://openrouter.ai/api/v1 + openrouter/free、实际调用现有分析函数、校验模型返回格式及因子引用，输出实际返回模型名。所有 public/data JSON 在测试前后哈希必须一致。
测试最多两次，凭据/配置错误不重试；无部署或写回步骤。当前期原推荐冻结不变，连接验证成功不等于当前网站已经产生 AI 推荐。
回滚：删除新增验证 workflow 或 revert 本提交，不涉及业务数据。
