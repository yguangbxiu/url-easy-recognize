# URL Easy Recognize

Chrome 扩展：将已加入书签的网站标签页标题（Logo Mark）替换为书签名，便于在同时打开 dev / test / uat 等多环境时快速区分。

## 功能

- 按 **origin**（域名 + 协议 + 端口）匹配书签
- 命中时将标签页标题设为该书签保存的名称
- 不修改 Favicon
- 支持 SPA 路由切换后保持书签名（MutationObserver 防覆盖）
- 书签增删改后自动更新，无需重启浏览器

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目根目录（包含 `manifest.json` 的目录）

## 使用

1. 为各环境网站添加书签，并设置易于区分的名称，例如：
   - `https://dev.myapp.com` → 书签名 `MyApp DEV`
   - `https://uat.myapp.com` → 书签名 `MyApp UAT`
2. 访问对应网站任意页面，标签页标题将显示书签名

## 设置

**单击**扩展图标，在图标旁弹出设置面板：

| 选项 | 说明 |
|------|------|
| 书签名称 | 是否在标签页标题中展示书签名（是 / 否） |
| 显示前几个字符 | 展示时可选择：全部、前 3 个字符、前 5 个字符，或自定义长度（1–100） |

**双击**扩展图标可快速切换「展示书签名称」开关。关闭后已打开的标签页将恢复为网站原始标题；图标悬停提示和角标（OFF）会显示当前状态。

## 匹配规则

| 规则 | 说明 |
|------|------|
| 匹配粒度 | 先按 **origin**（协议 + 域名 + 端口）筛选，再按 URL **路径最长前缀** 选取 |
| 路径边界 | 书签路径 `P` 命中当前路径 `C`，当且仅当 `C === P` 或 `C` 以 `P/` 开头（避免 `/dev` 误匹配 `/developer`） |
| 多条书签同 origin | 取路径前缀**最长**的那条；分数相同时保留书签树中先遇到的 |
| 根路径 `/` | 匹配该 origin 下所有路径，但优先级最低 |
| 无匹配 | 保持网站原标题 |

示例：

| 书签 URL | 书签名 | 当前页面 | 结果 |
|----------|--------|----------|------|
| `https://app.com/dev` | `DEV` | `https://app.com/dev/page` | `DEV` |
| `https://app.com/uat` | `UAT` | `https://app.com/dev/page` | 无匹配 |
| `https://app.com/dev` + `https://app.com/dev/admin` | `DEV` / `DEV-Admin` | `https://app.com/dev/admin/settings` | `DEV-Admin` |
| `https://app.com/` | `App` | `https://app.com/any` | `App` |

## 已知限制

- 不同 origin 之间无法跨域匹配（如 `dev.myapp.com` 与 `uat.myapp.com` 各自独立匹配）
- 无法作用于 `chrome://` 等系统页面
- 需要 `<all_urls>` 权限以在所有书签站点上注入脚本

## 手动验证

1. 同 origin 建 `/dev`、`/uat` 两条书签，访问 `/dev/page` 显示 DEV，访问 `/uat/page` 显示 UAT
2. 建 `/dev` 与 `/dev/admin` 嵌套书签，访问 `/dev/admin/x` 显示更具体的 Admin 书签名
3. 访问 `/developer` 时，不应被 `/dev` 书签误匹配
4. 为两个不同 origin 的测试站点各建一条书签，名称设为 `项目-DEV` 和 `项目-UAT`，分别打开确认标签标题正确
5. 在 SPA 站点内切换路由，确认标题仍为书签名
6. 打开未加入书签的站点，确认标题不受影响
7. 修改书签名后刷新页面，确认新名称生效
8. 单击扩展图标，修改「前 3 个字符」后确认标题截断生效
9. 双击扩展图标关闭展示，确认标签恢复网站原标题；再次双击确认书签名恢复
