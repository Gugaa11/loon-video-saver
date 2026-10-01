# 两个 Chrome 扩展的静态实现分析

分析日期：2026-10-01

分析对象：

- [bilibili哔哩哔哩视频下载助手](https://chromewebstore.google.com/detail/nlhgchhigkpbiefockjkoocnjgbdmpkl)，商店版本 `1.0.18`；CRX SHA-256：`7336AFEB7D2BE8499F6AC42400DC4B58A376FF6DC25EEB43E4B07574946D231A`
- [抖音视频下载大师](https://chromewebstore.google.com/detail/hilfahbmfiglhfbgiapjfhicmkpbeoil)，商店版本 `1.40.0.0`；CRX SHA-256：`253B35AE2C9E23FF0C519010071FEC4160D2343BC7BB1BCB92DD1F70902D1514`

方法：从 Chrome 更新服务取得商店当前 CRX3 包，解包后静态检查 `manifest.json`、JavaScript、下载工作线程和 WebAssembly 资源。没有安装或执行扩展，也没有复制其代码到本项目。

## 结论先行

第一个扩展是 B 站专用解析器；其核心路径与本项目采用的路径一致：取得 `cid`，请求 B 站播放接口，然后下载 `durl[0]` 的合流文件。它没有实现 DASH 音视频合并，因此商店所称“全部清晰度”不能由这条核心代码路径保证。

第二个扩展并不是抖音专用解析器，而是一套通用视频下载框架。它用浏览器 `webRequest` 观察所有网站的媒体请求，识别直链、HLS 和 DASH，再用随扩展附带的 LibAV WebAssembly 工作线程下载、合并或转封装。包内没有抖音专用 content script；抖音能否命中主要取决于通用网络嗅探是否观察到直接 MP4 或播放清单。

对 iPhone 最合适的移植方式不是照搬浏览器扩展，而是把职责拆成：

```text
平台 App 的分享菜单
        ↓
iOS 快捷指令接收 URL
        ↓
Loon 本机脚本解析，或从已允许的 App API 响应中缓存播放信息
        ↓
快捷指令带 Referer / User-Agent 下载
        ↓
存入“照片”或“文件”
```

本项目已把这条路线实现为 B 站解析和抖音本地响应缓存。它不依赖陌生解析站，也不会把下载记录上传到第三方服务。

## 扩展一：B 站下载助手

### 权限和页面接入

清单为 Manifest V3，只匹配 `*.bilibili.com`，请求 `storage`、`activeTab`、`cookies`、`downloads` 权限。页面开始加载时注入 `fix-script.js`，页面空闲时运行下载逻辑，并把 `ajax_listener.js` 注入页面上下文。

### 实际下载路径

1. 包装页面的 `XMLHttpRequest`，观察 `bvc.bilivideo.com/pbp/data` 请求，从 URL 中记录 `cid` 和 `aid`。
2. 普通视频请求 `https://api.bilibili.com/x/player/playurl`，参数包含 `cid`、`bvid`、`qn=80` 和 `otype=json`。
3. 番剧请求 `https://api.bilibili.com/pgc/player/web/playurl/`，参数包含 `ep_id` 和页面当前画质。
4. 只读取响应的 `durl[0].url` 和 `durl[0].size`。
5. 用 XHR 把整个文件读成 Blob，再通过对象 URL 触发 Chrome 下载。

### 可复用与不可复用部分

- 可复用：`cid/bvid → playurl → durl` 的渐进式 MP4 路线、必要的 Referer、短链展开、分 P 选择。
- 不应照搬：把整个大文件先读入浏览器 Blob；在 iOS 上应让快捷指令直接下载并交给系统保存动作。
- 能力边界：代码没有下载并合并 DASH 视频轨和音频轨；`durl[0]` 也会漏掉旧式多分段视频的后续片段。
- 隐私观察：静态包里还有远程配置、IP 信息服务、推广跳转和日志上报代码。它们与核心下载功能无关，本项目均未采用。

## 扩展二：“抖音视频下载大师”

### 它实际是通用下载器

清单请求 `<all_urls>`、`webRequest`、`downloads`、`offscreen`、`scripting`、`unlimitedStorage` 等高范围权限。包内的站点适配器覆盖 YouTube、Vimeo、Facebook/Instagram、OK.ru、VK、Canva、iQIYI、TwitCasting、Bilibili、Kick 等，但没有抖音专用适配器。

### 通用探测和合并机制

1. `webRequest.onSendHeaders` 记录请求头，`onResponseStarted` 检查 URL 和响应 `Content-Type`。
2. 将媒体分成直接文件、HLS/M3U8、DASH/MPD 等类型；页面脚本同时读取标题、封面和 `<video>` 状态。
3. 站点适配器补充通用嗅探不容易得到的信息。例如 B 站适配器读取页面的 `cid/bvid`，生成 WBI 签名后请求 `x/player/wbi/playurl?fnval=4048`，从而取得 DASH 音视频轨。
4. `download_worker` 内含 LibAV WebAssembly，可处理双源音视频、HLS/MPD、转封装和合并。
5. 通过 `video.mediaKeys` 检测 DRM；只是标记，未发现绕过 DRM 的实现。

### 风险和取舍

- 这种架构功能广，但需要观察全部站点流量和较高权限，不适合原样迁移到 Loon。
- 登录用户的下载记录代码会整理 `page_url`、`video_url`、标题、平台和时间，并向 `ispdf.com` 的账户接口提交；本项目不包含账户、配额、遥测或下载记录上传。
- 其 WebAssembly 合并器是桌面高画质能力的关键。Loon 脚本环境没有等价的后台文件系统、下载管理器和长时间 WASM 工作线程，所以纯“Loon + 快捷指令”只应返回已经合流的单文件媒体。

## 本项目采用了什么

| 浏览器扩展思路 | Loon/iOS 对应实现 |
|---|---|
| B 站页面拿 `cid` 后请求播放接口 | 先用公开详情接口取得 `cid`，无需注入网页 |
| 下载 `durl[0]` 合流 MP4 | 返回单段合流 MP4 给快捷指令 |
| 全站 `webRequest` 嗅探 | 只匹配抖音作品相关 API 响应，缩小 MitM 范围 |
| 保存完整页面/网络状态 | 只缓存作品 ID、标题、播放 URL 和必要请求头，七天过期 |
| 浏览器下载 API | 快捷指令“获取 URL 内容”后存入照片或文件 |
| LibAV/WASM 合并 DASH/HLS | 当前不合并；遇到分轨或多分段时明确报错 |
| 第三方账户、配额和遥测 | 不使用；Cookie 只发给对应平台的解析 API，不转发给视频 CDN |

## 其他平台能否保存到 iPhone 本地

这里的“可以”指公开、未加 DRM、且用户有权保存的内容，不代表绕过会员、私密或地区限制。

| 平台/媒体类型 | 纯 Loon + 快捷指令 | 结论与主要限制 |
|---|---:|---|
| B 站公开普通视频 | 已实现 | 使用带音轨的合流 MP4；通常最高约 720P，平台可能降级 |
| 抖音公开短视频 | 已实现 | 先播放再分享最可靠；匿名分享页可能触发风控；暂不支持图集/实况 |
| Vimeo 公开且提供 progressive MP4 的视频 | 可扩展 | 播放器配置常给出单文件 MP4；私密、仅嵌入或 HLS-only 视频另说 |
| 微博公开视频 | 可扩展但易变 | 页面/API 往往包含直接 MP4 或 HLS；需要针对登录和风控维护解析器 |
| TikTok 公开短视频 | 可扩展但易变 | 原理类似抖音；地区、签名、Cookie 和反自动化变化频繁 |
| 小红书、快手 | 可用“App 响应缓存”路线实验 | 需要逐平台确认 API、证书固定和媒体 URL 时效，不能承诺长期稳定 |
| X、Facebook、Instagram | 技术上可扩展，不建议首批加入 | 会话、签名和反自动化经常变化，也更容易涉及私密内容或账号 Cookie |
| YouTube 高画质、B 站 DASH 高画质 | 纯方案不完整 | 通常为音视频分轨，必须增加 ffmpeg/LibAV 合并层；只返回视频轨会无声 |
| Twitch、Kick、直播和普通 HLS | 纯方案不可靠 | M3U8 是分段清单，需要持续下载、解密非 DRM 分段并合并，快捷指令不适合作为稳定下载器 |
| Netflix、Disney+、付费课程等 DRM 内容 | 不支持 | 不移除、不规避 DRM、付费或访问控制 |

若要继续扩展，优先顺序建议为：Vimeo progressive MP4 → 微博直接 MP4 → TikTok/小红书/快手的按平台缓存。YouTube、高画质 B 站和 HLS 应单独设计“iOS 本地合并 App”或自托管 ffmpeg 服务，不能假装只靠一个 Loon 脚本就能可靠完成。

## 相关开源实现

- [yt-dlp Bilibili extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py)：B 站详情、分 P、playurl、DASH/合流格式处理。
- [yt-dlp Vimeo extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/vimeo.py)：Vimeo 播放器配置、progressive/HLS/DASH 格式处理。
- [yt-dlp Weibo extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/weibo.py)：微博页面/API 中媒体信息的解析方式。
- [yt-dlp TikTok extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/tiktok.py)：短链、网页/API 和多格式处理，展示了该平台维护成本。
- [yt-dlp Twitter extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py)：X/Twitter 的媒体变体和 API 路径。
- [douyin_download_helper](https://github.com/nu1lkali/douyin_download_helper)：抖音移动分享页 `_ROUTER_DATA` 路线。

本项目只参考公开接口形态和流程，解析代码为独立实现；没有把两个商店扩展的专有代码或 WebAssembly 文件打进交付包。
