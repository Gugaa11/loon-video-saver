# Loon 视频保存助手（B 站 / 抖音）

这是一套“Loon 本地解析 + iOS 快捷指令保存”的实现。它让 B 站或抖音的分享链接在本机解析，快捷指令再下载视频并保存到照片 App，不依赖陌生的第三方解析网站。

## 能做什么

- 从 iOS 分享菜单接收 B 站、抖音公开作品链接或带链接的分享文案。
- B 站：调用公开详情/播放接口，选择带音轨的渐进式 MP4，默认请求 720P。
- 抖音：优先使用 Loon 从抖音 App 正常响应中缓存的播放地址；没有缓存时尝试移动分享页 `_ROUTER_DATA`。
- 返回下载地址和必要请求头，由快捷指令下载并存入系统相册。
- Cookie 是可选项，只保存在 Loon 的插件参数里，脚本只把它发给对应平台。

## 明确限制

- Loon 本身不能注册 iOS 分享扩展，也没有写入照片库/文件的脚本 API，所以必须配合“快捷指令”。
- 只支持你有权下载的公开或已授权内容；不绕过付费、会员、私密、DRM 或地区权限。
- B 站高画质通常采用 DASH 音视频分轨。快捷指令没有可靠的 ffmpeg 合并能力，因此本实现只选平台提供的合流 MP4；实际清晰度可能自动降级。
- 当前只处理视频，不处理抖音图集、实况或 B 站旧式多分段视频。
- 抖音匿名页面存在动态风控。最可靠的使用方法是先在抖音 App 打开目标视频、播放片刻，再从该页面分享。

## 文件

- `src/video-saver.js`：Loon 解析与抖音响应缓存脚本。
- `VideoSaver.plugin.template`：插件模板；发布脚本后生成最终插件。
- `tools/build-plugin.mjs`：把脚本公网地址写入模板。
- `SHORTCUT.md`：在 iPhone 上搭建分享菜单快捷指令的逐步说明。
- `EXTENSION_ANALYSIS.md`：两个 Chrome 扩展的静态实现分析和其他平台可行性矩阵。
- `test/`：核心单元测试、B 站在线冒烟测试和抖音诊断脚本。

## 安装 Loon 插件

仓库中不包含 Cookie 或其他账号信息。请在 iPhone 上点击：

**[一键导入 Loon 插件](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2FGugaa11%2Floon-video-saver%2Fmain%2FVideoSaver.plugin)**

也可以在 Loon 的“配置 → 插件 → +”中手动粘贴下面的订阅地址：

```text
https://raw.githubusercontent.com/Gugaa11/loon-video-saver/main/VideoSaver.plugin
```

导入后启用插件。仓库发布更新时，在 Loon 插件页面执行订阅更新即可同步最新版本。

为抖音缓存功能开启 Loon 的 MitM，并安装、信任 Loon 证书；只使用 B 站时不需要 MitM。运行快捷指令时请保持 Loon 已连接。

如果希望完全离线手动部署，可参考 [MOBILE_LOCAL.md](MOBILE_LOCAL.md) 和 `VideoSaver.local.conf`。

## 安装快捷指令

按 [SHORTCUT.md](SHORTCUT.md) 的 14 个动作搭建“保存分享视频”。完成后在 B 站或抖音点“分享”，选择这个快捷指令即可。

## 开发与验证

要求 Node.js 18 或更高版本：

```powershell
npm test
npm run smoke:bilibili
```

在线冒烟测试会解析 yt-dlp 测试集中长期使用的公开 B 站样例，并只请求视频的前两个字节，不会下载完整视频。

## 实现依据

- [Loon 插件文档](https://nsloon.app/docs/Plugin/)说明插件由规则、脚本、MitM 等模块组成；[Script API](https://nsloon.app/docs/Script/script_api/)列出的公开能力包括 HTTP、存储、通知和响应构造，但没有分享扩展或照片库写入 API。
- [Apple Shortcuts 文档](https://support.apple.com/guide/shortcuts/receive-onscreen-items-apd350ce757a/ios)确认快捷指令可从其他 App 的分享菜单接收内容；[保存动作说明](https://support.apple.com/guide/shortcuts/apdaf74d75a5/ios)包含“存储到照片相簿”。
- B 站流程参考 [yt-dlp 的 Bilibili extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py)和公开 API 的 `view → cid → playurl → durl` 结构。
- 抖音流程参考 [douyin_download_helper](https://github.com/nu1lkali/douyin_download_helper)记录的“短链 → 移动分享页 → `_ROUTER_DATA` → `play_addr`”路线，以及社区对嵌套 JSON 使用花括号深度扫描的实现经验。本项目的代码为独立实现。

## 合规提示

请只下载你本人创作、明确获授权或平台允许下载的内容，并遵守平台条款与当地法律。脚本不会移除 DRM，也不应被用于再分发他人作品。
