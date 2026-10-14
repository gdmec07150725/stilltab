# 将 StillTab 源码提交到 GitHub

建议仓库名：`stilltab`。

GitHub About 描述可以填写：

> A local-first browser extension for mindful browsing: reminders, pauses, and website rules.

建议 Topics：`browser-extension`、`chrome-extension`、`edge-extension`、`productivity`、`focus`、`typescript`、`manifest-v3`。

英文首页为根目录 README.md，中文说明为 README.zh-CN.md；许可证已按你的选择设置为 MIT。当前插件界面保持中文名「停一下 · 网页行为规则」，英文项目名为 StillTab。

## 提交范围

请从项目根目录 `D:/code/behavior-rules` 提交，包含扩展源码、手机端源码、文档、截图、图标源文件和锁文件。这是一份包含手机端的仓库；浏览器扩展位于 apps/extension。

.gitignore 已排除依赖、生成的运行文件、浏览器测试配置、打包产物和签名材料。电脑上已有的 .pem 私钥、.crx、APK 等不会因普通的 git add 被纳入；不要使用 git add -f 强制添加它们。

## 1. 在 GitHub 建立空仓库

在自己的账号下新建 `stilltab`，可见性按你的意愿选择。准备公开开源时选 Public。不要勾选自动生成 README、.gitignore 或许可证，因为本地已备齐。

## 2. 在 PowerShell 提交本地源码

```powershell
cd D:/code/behavior-rules
git init -b main
git add .
git status --short
git diff --cached --stat
git diff --cached --check
```

先查看待提交列表，确认没有私钥、本机配置、依赖或编译产物；若检查报告空白错误，修正后重新添加相关文件。确认内容正确后：

```powershell
git commit -m "Initial open-source release of StillTab"
```

如果 Git 提示没有提交者身份，按提示设置你自己的 name 和 email；需要隐藏邮箱时可使用 GitHub 提供的 noreply 邮箱。

## 3. 关联远程仓库并推送

把下面 URL 中的 `YOUR_USERNAME` 替换为你在 GitHub 上的用户名，或直接复制新仓库页面提供的 HTTPS 地址：

```powershell
git remote add origin https://github.com/YOUR_USERNAME/stilltab.git
git push -u origin main
```

登录使用 GitHub 正常认证流程。不要把访问令牌写进远程 URL、README 或源码。

## 已有 Git 仓库时

如果之后已经执行过初始化，请先运行 `git status` 与 `git remote -v` 确认当前状态，不要重复添加同名 origin。

以上命令用于首次提交。完成首次推送后，日常更新只需检查 git status、暂存修改、提交并运行 git push，不必重复初始化或添加 origin。
