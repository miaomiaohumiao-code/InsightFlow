# Cloudflare 独立测试部署

Vercel 继续使用 main 分支和 npm run build。本分支只增加 OpenNext/Workers 部署配置。

- Node.js 24，npm ci 后运行 npm run build:cloudflare。
- 推荐通过 Linux GitHub Actions 构建；Windows 不是 OpenNext 完整支持的平台。
- npm run deploy:cloudflare 部署到独立的 insightflow-preview Worker。
- DEEPSEEK_API_KEY 必须通过 Cloudflare Secret 配置，禁止写入仓库。
- AI_PROVIDER、DEEPSEEK_MODEL 和公开 AI 开关在 wrangler.jsonc 中配置。
- 本项目没有使用 ISR，不启用 R2 缓存；不自动创建收费存储资源。
- 新网站使用独立浏览器存储，不会自动读取 Vercel 域名下的项目。
- 部署成功不代表中国大陆访问稳定，需在多个运营商网络实测完整 AI 流程。

GitHub Cloudflare build 工作流仅打包及校验，不自动发布，不需要生产密钥。
