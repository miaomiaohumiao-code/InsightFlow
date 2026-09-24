# GitHub 与 Vercel 部署指南

## 当前准备状态

项目采用 Next.js App Router，无需静态导出或自建数据库。三个 API 路由使用 Node.js runtime，maxDuration 为 180 秒；Vercel 项目须启用 Fluid Compute 并允许该时长。单次模型超时 45–50 秒、最多 3 次尝试，在 180 秒预算内预留处理时间，但供应商慢响应仍可能失败。

已固定 Node.js 24.x，使用 npm ci 和 npm run build。Vercel 自动识别 Next.js，Output Directory 使用默认值；不要设为 out，不需要手动启动 npm start，也不需要额外 vercel.json。

## 1. 准备 GitHub 仓库

当前目录尚未初始化 Git，因此没有可检查的提交历史或远程地址。

1. 在 GitHub 创建空仓库，首次可设 Private，完成检查后再改 Public。
2. 在本地项目根目录运行 git init，然后检查 git status --short。
3. 用 git check-ignore .env.local .local/ 复核忽略项；.env.example 应可提交。
4. 运行 git add . 后检查 git diff --cached --stat 及 git diff --cached --name-only。禁止强制添加环境文件、原始资料或“结果”截图目录。
5. 确认没有私密文件后提交，设置 main 分支；按 GitHub 新仓库页面提供的实际地址配置 origin 并推送。不要把访问令牌写进 remote URL。

.gitignore 与 .vercelignore 已排除本地密钥、原始文档、结果截图、检查点和构建目录。忽略规则不能移除已经提交过的秘密；将来若误提交，须撤销密钥并清理历史，不能仅删除文件。

## 2. 导入 Vercel

1. 登录 Vercel，选择 Add New → Project，授权并导入目标 GitHub 仓库。
2. Framework Preset 选 Next.js；Root Directory 为仓库根；Node.js 选 24.x。
3. Install Command 为 npm ci，Build Command 为 npm run build，Output Directory 保持默认。
4. 在 Environment Variables 配置 AI_PROVIDER=deepseek、DEEPSEEK_MODEL，并通过控制台安全输入 DEEPSEEK_API_KEY。
5. 首次设 INSIGHTFLOW_ENABLE_PUBLIC_AI=false。Production、Preview 的变量分别配置；不需要给预览分支开放付费 API。
6. 检查 Functions 的 Fluid Compute 与执行时长，确保三个 API 的 180 秒配置可用。
7. Deploy，确认构建成功，再打开分配的 HTTPS 地址。

变量属于服务端，不添加 NEXT_PUBLIC_ 前缀；.env.local 无需也不应上传。变量变更后重新部署。

## 3. 上线验收

- 首页、输入、预览和本地保存可用，刷新后项目保留。
- 公开 AI 关闭时，三个 POST 接口均返回 403。
- 准备启用 AI 前，轮换曾在聊天中发送过的密钥，并在服务商侧配置可用的额度限制与告警。
- 先启用 Vercel Deployment Protection 或受控访问，再将公开开关设 true 并重新部署；该开关不是用户认证。
- 用少量获准发送的数据依次验证分析、引用、营销策略和实验建议；查看调用账单及函数日志中的状态，不记录密钥和完整 VOC。
- 正式发布后将 README 的 Online Demo 占位替换为实际地址。localhost 数据不会迁移到正式域名。

## 已知部署边界

本地生产构建通过不等于云端已经验收。尚未实际连接 GitHub/Vercel、验证账户权限、供应商地区网络或云端真实 AI 调用。实例内计数不是持久限流，开放无账号付费接口仍有额度被滥用的风险。客户端负责调度；关闭页面会中断运行，成功检查点可继续。

参考官方文档（2026-09-19 核对）：[Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)、[Node.js 版本](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)、[函数执行时长](https://vercel.com/docs/functions/configuring-functions/duration)。
