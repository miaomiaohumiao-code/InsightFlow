# 首次部署记录

- 日期：2026-09-20。
- 地址：https://insightflow-sable-five.vercel.app
- Vercel 项目：insightflow。
- 云端生产构建成功，包含 TypeScript 检查。
- 未登录 HTTP 检查：首页 200；三个 AI POST 接口均 403，分析尝试数为 0。
- Production 环境已保存 INSIGHTFLOW_ENABLE_PUBLIC_AI=false；未上传 DeepSeek 密钥。
- 本次使用从 Git 已审核文件复制的 `.local/deploy` 干净目录部署。Vercel CLI 在 Windows 上的预检未正确忽略私人截图目录，因此不能未经 dry-run 直接上传工作目录。
- 浏览器自动化当前受本地沙箱故障阻断；线上交互验收尚未完成。此前本地完整流程验收见 phase-11-qa.md。
- 正式域名与 localhost 的浏览器存储相互独立，本地项目不会自动迁移。
## 2026-09-21 · 受控 AI 上线

- 用户在 Vercel Production 中自行保存 DEEPSEEK_API_KEY，操作过程中未读取或显示密钥值。
- 全部部署 Vercel Authentication 已开启（ssoProtection.deploymentType=all）；匿名 API 请求返回 401。
- INSIGHTFLOW_ENABLE_PUBLIC_AI 已设为 true，并成功完成新生产构建与 TypeScript 检查。
- 部署：dpl_Fvh7o1AcXfjo43XkGxuHgPS6aUsc；网址不变。
- 配置接口实测 configured=true、enabled=true、model=deepseek/deepseek-flash。
- 受保护线上接口一条英文合成评论实测成功：1 次 API 尝试，931 输入 Token、131 输出 Token；结果中文、原始英文引文保留，通过现有契约校验。
- 本次为连通性与提取批次测试，不代表已在线上重跑完整 58 条评论及营销策略流程。用户原有浏览器项目未被修改。
- 修复缺少密钥时的提示，区分 Vercel 环境变量与本地 .env.local。

## 简历公开演示

项目所有者明确授权所有持有链接的访客使用完整 AI，并知晓调用计入部署者 DeepSeek 额度。已关闭 Vercel 登录保护（ssoProtection=null），未改变密钥或模型配置。

验证：匿名首页 HTTP 200；匿名配置 configured=true、enabled=true；匿名一条合成评论提取成功（1 次 API 尝试）；营销和实验接口对无效输入返回 400 而非访问拒绝。本次未重复完整多批分析流程。

链接：https://insightflow-sable-five.vercel.app/
