# Instagram Download Helper (IG Helper)

## 安装和更新（ChenshuXu fork）

**[安装 / 更新最新版 IG Helper](https://raw.githubusercontent.com/ChenshuXu/ig-helper/master/ig-helper.user.js)** · 当前版本：**4.2.1.3**

1. 在每个浏览器中安装并启用 Tampermonkey。
2. 打开上面的固定链接，在 Tampermonkey 页面点击“安装”或“更新”。如果浏览器只显示源码，在 Tampermonkey 的“实用工具 → 从 URL 安装”中粘贴同一个链接。
3. 刷新 Instagram 页面。

这个链接始终指向本 fork 已发布的最新版本，包含原图轮播、Story 和普通帖子下载修复。脚本已配置 `@updateURL` / `@downloadURL`，Tampermonkey 会按各浏览器的更新设置检查此 fork；也可在其管理面板手动“检查更新”，或再次打开安装链接。

本 fork 保留原脚本的名称和 namespace，方便覆盖已有的 IG Helper 并保留设置。如果旧脚本曾手动固定更新地址，请在 Tampermonkey 的脚本设置中确认使用上述 GitHub 地址。只启用一个 `IG Helper`；旧的 `IG Helper Fix - Full Resources` companion 应保持禁用。

### 发布新版本

修改 `src/`，递增 `src/metadata.js` 中的 `@version`，并更新这里的版本号。运行 `npm test` 和 `npm run build`，把源码及生成的 `main.js`、`ig-helper.user.js`、`ig-helper.meta.js` 一起提交并推送到 `master`。GitHub Actions 会验证测试及构建产物是否一致。所有浏览器继续使用同一个安装链接。

以下为上游项目说明；原作者和 GPL-3.0 许可证保留。

<div align="center">
  
  [![](https://img.shields.io/badge/Kofi-F16061.svg?logo=ko-fi&logoColor=white)](https://ko-fi.com/F1F1J6VZH)
  [![](https://img.shields.io/discord/505936774531514388?color=5865F3&logo=discord&logoColor=white)](https://discord.gg/q3KT4hdq8x)

  Buy me a coffee, Donate to ig-helper if it makes your help. Your donation makes ig-helper better: [https://ko-fi.com/snkoarashi](https://ko-fi.com/snkoarashi)
</div>

**Simple and fast download of resources from Instagram (posts, reels, stories, and more).**

## 🎉 Features
- Force the fetching of all resources in the post.
- Download the resources in the post with one click.
- Download the resources currently displayed in the post with one click.
- Open the resource in a new window.
- Download the video thumbnail.
- Fetch high-quality photos or videos through the Media API.
- Disable video looping.
- Enable the native HTML5 video controller for video resources.
- Download the user's profile picture.
- Provide scroll buttons for Reels pages.
- Automatically modify and control the playback volume of all video elements.
- Redirect to a user's profile page when clicking on their avatar in the story area on the homepage.
- Customize the naming format when downloading according to your preferences.

## ⚙ How to Change Settings
1. Go to Instagram.com.
2. Check your Tampermonkey extension.
3. See the following:
<img src="https://i.imgur.com/tSSsl5K.gif" />

## 📌 Hot keys
- `ALT+Q` - Close pop-up window
- `ALT+W` - Open the settings menu
- `ALT+Z` - Open the debug menu
- `ALT+S` - Download resource in story page

## 📢 Developer Statement
1. All code development and testing are based on the Chrome browser and the extension Tampermonkey.
2. Due to the framework and personal differences used in Instagram development, the page layout and node names presented by each person may be different. Therefore, all development and testing are based on the pages I have seen, which may cause a few people to The script does not work, please forgive me.
3. Extensive use of this script, especially when enabling the "Media API" or "Force Fetch API," may trigger Instagram's automation bot checks, potentially leading to account warnings, being logged out, or even being banned. Please use it with caution.

> [!IMPORTANT]
> Upstream on GreasyFork: https://greasyfork.org/scripts/404535-ig-helper
> 
> The upstream project supports and tests Tampermonkey. For this fork, use the GitHub install link above.

Finally, I want to say that Instagram's inconsistent UI layout increased the development pain, especially the need to de-parse components built with React. Therefore, the malfunction of IG Helper was incredibly frustrating, but there was nothing I could do. I could only try to fix these parts in my spare time.

## ✨ Development Guide
This guide provides comprehensive documentation for developers who want to understand, modify, or contribute to the IG Helper codebase. It covers the build system, development environment setup, and contribution workflow.

### Development Environment Setup
#### Prerequisites
- Node.js (v20 or newer)
- A userscript manager (Tampermonkey, Greasemonkey, or Violentmonkey)

#### Setup Steps
1. Clone the repository:
```
git clone https://github.com/ChenshuXu/ig-helper.git
cd ig-helper
```
2. Install dependencies:
```
npm install
```
3. Build the script:
```
node build.js
```
Install the generated `ig-helper.user.js` file in your userscript manager. `main.js` remains available for compatibility; `ig-helper.meta.js` contains the metadata used for update checks.

### Contribution Workflow

#### Development Process
1. **Fork & Clone**: Fork the repository and clone it locally
2. **Branch**: Create a feature branch
3. **Develop**: Make changes to the source files
4. **Build**: Run `npm test` and `npm run build` to generate `main.js`, `ig-helper.user.js`, and `ig-helper.meta.js`
5. **Test**: Install the script in your userscript manager and test your changes
6. **Submit**: Create a pull request

#### Code Standards
- Follow the existing code style
- Use ESLint to ensure code quality: `npx eslint main.js`
- Document new functions and features

## Contributiner
### [@Yomisana](https://github.com/yomisana)
- Menu design suggestions and batch-download ideas
- Enhancement suggestions

### [@sn-o-w](https://github.com/sn-o-w)
- Text translation (Romanian)
- Miscellaneous optimizations and enhancements, plus code debugging

<a href="https://github.com/SN-Koarashi/ig-helper/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=SN-Koarashi/ig-helper" />
</a>
