# iPhone 本地安装（无网站、无远程脚本）

这套方式不需要 GitHub、公开安装站或第三方解析服务。`video-saver.js` 保存在你自己的 iCloud Drive/Loon 目录并由 Loon 本地执行；视频下载仍由 iOS 快捷指令完成。

## 文件用途

- `Loon/Script/video-saver.js`：要放入 iCloud Drive 的本地脚本。
- `VideoSaver.local.conf`：要合并到你现有 Loon 配置的配置片段。
- `SHORTCUT.md`：创建系统分享菜单快捷指令的动作清单。

## 一、把脚本放入 Loon

1. 在 iPhone 的 Loon 中打开“更多 → iCloud Drive”，启用“自动同步”。
2. 在“文件”App 中解压本安装包。
3. 把安装包中 `Loon/Script/video-saver.js` 移到：

   ```text
   iCloud Drive/Loon/Script/video-saver.js
   ```

   如果 `Loon/Script` 目录不存在，先在 Loon 中开启一次 iCloud 自动同步，或在“文件”App 中按这个层级创建目录。
4. 回到 Loon，打开“配置 → 本地 JS 文件”，使用“恢复脚本”。列表中应出现 `video-saver.js`。

## 二、合并 Loon 配置

1. 打开安装包中的 `VideoSaver.local.conf`。
2. 在 Loon 中打开“配置 → 编辑”。
3. 将文件中每个区块里的配置行，复制到现有配置的同名区块：
   - `DOMAIN,video-saver.loon,DIRECT` 放到现有 `[Rule]` 下。
   - `video-saver.loon = 127.0.0.1` 放到现有 `[Host]` 下。
   - 两条 `request/response ... script("video-saver.js")` 放到现有 `[Script]` 下。
   - 三个抖音域名放到现有 `[Mitm]` 的 `hostname` 列表中。
4. 如果原配置没有某个区块，再连同区块标题一起添加。不要创建两个同名区块。
5. 保存配置，确认“脚本”和“复写”开关已启用。

只使用 B 站时，可以不配置抖音的 Response Script 与 `[Mitm]` hostname。

## 三、抖音所需的系统确认

1. 在 Loon 的 MitM 页面生成证书并安装。
2. 打开 iOS“设置 → 通用 → 关于本机 → 证书信任设置”，信任 Loon 证书。
3. 回到 Loon 开启 MitM。

这是 iOS 安全确认，不能由脚本代替。若开启后抖音无法联网，说明当前 App 版本可能使用证书固定；关闭抖音 Response Script/MitM，仍可继续使用 B 站功能。

## 四、创建分享快捷指令

按照 `SHORTCUT.md` 创建“保存分享视频”。解析入口固定为：

```text
http://video-saver.loon/resolve?url=编码后的分享链接
```

以后在 B 站或抖音点“分享 → 更多 → 保存分享视频”即可。抖音建议先播放目标视频一两秒再分享，以便本地脚本缓存作品播放信息。

## 五、验证

### B 站

打开任意公开视频并分享给快捷指令。若成功，快捷指令会下载合流 MP4 并请求照片权限。平台通常只为匿名渐进式接口提供到约 720P。

### 抖音

先播放目标作品，再分享。若提示“没有找到作品数据”：

- 检查 Loon 是否已连接；
- 检查 MitM 证书是否已信任；
- 检查 Response Script 是否启用；
- 在 Loon 脚本日志中搜索 `Loon Video Saver cached`。

## 本地模式的限制

- 没有插件参数页面，B 站使用默认 720P 请求，不保存账号 Cookie。
- 不合并 DASH 音视频分轨、HLS 分段或 B 站旧式多段文件。
- 不处理抖音图集、实况、直播、付费、私密或 DRM 内容。
- 请只保存你本人创作、明确获授权或平台允许下载的内容。
