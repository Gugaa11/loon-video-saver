/*
 * Loon Video Saver
 * Resolve public Bilibili and Douyin share links without a third-party parser.
 * The iOS Shortcut is responsible for downloading the returned URL and saving it.
 */
(function (root) {
  "use strict";

  var IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  var BILI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";

  function VideoSaverError(code, message, details) {
    this.name = "VideoSaverError";
    this.code = code;
    this.message = message;
    this.details = details || null;
  }
  VideoSaverError.prototype = Object.create(Error.prototype);

  function firstHeader(headers, name) {
    var wanted = String(name).toLowerCase();
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].toLowerCase() === wanted) return headers[keys[i]];
    }
    return null;
  }

  function absoluteUrl(base, location) {
    if (/^https?:\/\//i.test(location)) return location;
    if (/^\/\//.test(location)) return String(base).split(":")[0] + ":" + location;
    var origin = String(base).match(/^(https?:\/\/[^/]+)/i);
    if (!origin) return location;
    if (location.charAt(0) === "/") return origin[1] + location;
    return String(base).replace(/[^/]*(?:\?.*)?$/, "") + location;
  }

  function cleanSharedUrl(value) {
    var text = String(value || "").trim();
    var match = text.match(/https?:\/\/[^\s<>"']+/i);
    if (!match) throw new VideoSaverError("NO_URL", "分享内容中没有找到 HTTP(S) 链接");
    return match[0].replace(/[，。！？、；：,.!?;:)）\]}]+$/g, "");
  }

  function queryValue(url, name) {
    var pattern = new RegExp("[?&]" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^&#]*)", "i");
    var match = String(url).match(pattern);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1].replace(/\+/g, "%20"));
    } catch (_) {
      return match[1];
    }
  }

  function followRedirects(httpGet, initialUrl, headers, limit) {
    var max = typeof limit === "number" ? limit : 8;
    var current = initialUrl;
    var seen = {};

    function next(remaining) {
      if (seen[current]) {
        throw new VideoSaverError("REDIRECT_LOOP", "短链接重定向出现循环", { url: current });
      }
      seen[current] = true;
      return httpGet({
        url: current,
        headers: headers,
        timeout: 12000,
        "auto-redirect": false
      }).then(function (response) {
        var status = Number(response.status || 0);
        var location = firstHeader(response.headers, "location");
        if (status >= 300 && status < 400 && location) {
          if (remaining <= 0) {
            throw new VideoSaverError("TOO_MANY_REDIRECTS", "短链接重定向次数过多");
          }
          current = absoluteUrl(current, String(location));
          return next(remaining - 1);
        }
        return { url: current, response: response };
      });
    }

    return next(max);
  }

  function jsonBody(response, label) {
    try {
      return JSON.parse(String(response.body || ""));
    } catch (error) {
      throw new VideoSaverError("BAD_JSON", label + "返回了无法解析的数据", {
        status: response.status,
        sample: String(response.body || "").slice(0, 160)
      });
    }
  }

  function safeFilename(value, fallback) {
    var name = String(value || fallback || "video")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) name = fallback || "video";
    return name.slice(0, 80);
  }

  function extractBvid(url) {
    var match = String(url).match(/\b(BV[0-9A-Za-z]{10})\b/i);
    return match ? "BV" + match[1].slice(2) : null;
  }

  function resolveBilibili(httpGet, sharedUrl, options) {
    var opts = options || {};
    var headers = { "User-Agent": BILI_UA, Referer: "https://www.bilibili.com/" };
    if (opts.bilibili_cookie) headers.Cookie = String(opts.bilibili_cookie);
    var needsExpand = /\/(?:b23\.tv|bili2233\.cn)\//i.test(sharedUrl);
    var expanded = needsExpand
      ? followRedirects(httpGet, sharedUrl, headers, 8).then(function (x) { return x.url; })
      : Promise.resolve(sharedUrl);

    return expanded.then(function (finalUrl) {
      var bvid = extractBvid(finalUrl);
      if (!bvid) throw new VideoSaverError("BILI_ID_NOT_FOUND", "没有从 B 站链接中识别到 BV 号", { url: finalUrl });
      var viewUrl = "https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid);
      return httpGet({ url: viewUrl, headers: headers, timeout: 12000, "auto-redirect": true })
        .then(function (viewResponse) {
          var view = jsonBody(viewResponse, "B 站详情接口");
          if (view.code !== 0 || !view.data) {
            throw new VideoSaverError("BILI_VIEW_FAILED", view.message || "B 站详情接口失败", { code: view.code });
          }
          var page = Math.max(1, Number(queryValue(finalUrl, "p") || 1));
          var pages = Array.isArray(view.data.pages) ? view.data.pages : [];
          var pageInfo = pages[page - 1] || pages[0] || {};
          var cid = pageInfo.cid || view.data.cid;
          if (!cid) throw new VideoSaverError("BILI_CID_NOT_FOUND", "B 站响应中没有找到 cid");
          var requestedQn = Number(opts.bilibili_qn || 64);
          if ([16, 32, 64].indexOf(requestedQn) < 0) requestedQn = 64;
          var playUrl = "https://api.bilibili.com/x/player/playurl?bvid=" + encodeURIComponent(bvid) +
            "&cid=" + encodeURIComponent(cid) + "&qn=" + requestedQn +
            "&fnver=0&fnval=0&fourk=0&platform=html5&high_quality=1";
          var playHeaders = Object.assign({}, headers, { Referer: "https://www.bilibili.com/video/" + bvid });
          return httpGet({ url: playUrl, headers: playHeaders, timeout: 12000, "auto-redirect": true })
            .then(function (playResponse) {
              var play = jsonBody(playResponse, "B 站播放接口");
              if (play.code !== 0 || !play.data) {
                throw new VideoSaverError("BILI_PLAY_FAILED", play.message || "B 站播放接口失败", { code: play.code });
              }
              var durl = play.data.durl;
              if (!Array.isArray(durl) || !durl.length || !durl[0].url) {
                throw new VideoSaverError("BILI_NO_PROGRESSIVE_MP4", "未取得可直接保存的合流 MP4；该视频可能只提供 DASH 分轨");
              }
              if (durl.length > 1) {
                throw new VideoSaverError("BILI_MULTI_SEGMENT", "该视频返回多个旧式分段，快捷指令无法无损合并", { segments: durl.length });
              }
              var title = view.data.title || bvid;
              if (pageInfo.part && pages.length > 1) title += " - " + pageInfo.part;
              var qnNames = { 16: "360P", 32: "480P", 64: "720P" };
              return {
                ok: true,
                platform: "bilibili",
                media_type: "video",
                url: durl[0].url,
                // The account cookie is only needed by Bilibili's API. Never forward it
                // to the media CDN returned by the API.
                headers: { "User-Agent": BILI_UA, Referer: playHeaders.Referer },
                filename: safeFilename(title, bvid) + ".mp4",
                title: title,
                id: bvid,
                quality: qnNames[play.data.quality] || String(play.data.quality || requestedQn),
                source_url: finalUrl
              };
            });
        });
    });
  }

  function extractDouyinId(url) {
    var patterns = [
      /\/(?:video|note|share\/video|share\/slides|share\/note)\/(\d{15,22})/i,
      /[?&](?:modal_id|aweme_id)=(\d{15,22})/i
    ];
    for (var i = 0; i < patterns.length; i += 1) {
      var match = String(url).match(patterns[i]);
      if (match) return match[1];
    }
    return null;
  }

  function scanJsonValue(text, marker) {
    var markerIndex = text.indexOf(marker);
    if (markerIndex < 0) return null;
    var equalIndex = text.indexOf("=", markerIndex + marker.length);
    if (equalIndex < 0) return null;
    var index = equalIndex + 1;
    while (index < text.length && /\s/.test(text.charAt(index))) index += 1;
    if (text.charAt(index) === '"') {
      var escaped = false;
      for (var s = index + 1; s < text.length; s += 1) {
        var sc = text.charAt(s);
        if (escaped) escaped = false;
        else if (sc === "\\") escaped = true;
        else if (sc === '"') {
          var outer = JSON.parse(text.slice(index, s + 1));
          return JSON.parse(outer);
        }
      }
      return null;
    }
    if (text.charAt(index) !== "{") return null;
    var depth = 0;
    var inString = false;
    var slash = false;
    for (var i = index; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (inString) {
        if (slash) slash = false;
        else if (ch === "\\") slash = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return JSON.parse(text.slice(index, i + 1));
      }
    }
    return null;
  }

  function findAwemeItem(value, depth) {
    if (!value || depth > 24) return null;
    if (Array.isArray(value)) {
      for (var a = 0; a < value.length; a += 1) {
        var inArray = findAwemeItem(value[a], depth + 1);
        if (inArray) return inArray;
      }
      return null;
    }
    if (typeof value !== "object") return null;
    if ((value.aweme_id || value.group_id) && (value.video || value.images)) return value;
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i += 1) {
      var found = findAwemeItem(value[keys[i]], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function firstMediaUrl(container) {
    if (!container) return null;
    var urls = container.url_list || container.urlList;
    if (Array.isArray(urls) && urls.length) return urls[0];
    return container.url || null;
  }

  function normalizeDouyinPlayUrl(url) {
    return String(url || "")
      .replace(/\/playwm\//g, "/play/")
      .replace(/([?&])watermark=1(?=&|$)/g, "$1watermark=0")
      .replace(/([?&])ratio=(?:480p|540p|720p)(?=&|$)/g, "$1ratio=1080p");
  }

  function douyinItemToResult(item, awemeId, sourceUrl) {
    if (Array.isArray(item.images) && item.images.length) {
      throw new VideoSaverError("DOUYIN_ALBUM_UNSUPPORTED", "当前版本只下载视频，暂不处理抖音图集或实况");
    }
    var video = item.video || {};
    var media = firstMediaUrl(video.play_addr_h264) || firstMediaUrl(video.play_addr) || firstMediaUrl(video.download_addr);
    if (!media && video.play_addr && video.play_addr.uri) {
      media = "https://aweme.snssdk.com/aweme/v1/play/?video_id=" +
        encodeURIComponent(video.play_addr.uri) + "&ratio=1080p&line=0";
    }
    if (!media) throw new VideoSaverError("DOUYIN_MEDIA_NOT_FOUND", "抖音作品数据中没有视频播放地址");
    var resolvedId = String(item.aweme_id || item.group_id || awemeId);
    var title = item.desc || (item.author && item.author.nickname) || resolvedId;
    return {
      ok: true,
      platform: "douyin",
      media_type: "video",
      url: normalizeDouyinPlayUrl(media),
      headers: { "User-Agent": IOS_UA, Referer: "https://www.douyin.com/" },
      filename: safeFilename(title, resolvedId) + ".mp4",
      title: title,
      id: resolvedId,
      quality: "1080P（平台可能自动降级）",
      source_url: sourceUrl
    };
  }

  function readDouyinCache(options, awemeId, sourceUrl) {
    if (!options || typeof options._cacheRead !== "function") return null;
    var raw = options._cacheRead("loon_video_saver_douyin_" + awemeId);
    if (!raw) return null;
    try {
      var cached = JSON.parse(raw);
      if (!cached.saved_at || Date.now() - cached.saved_at > 7 * 24 * 60 * 60 * 1000) return null;
      var result;
      if (cached.result && cached.result.url) {
        result = Object.assign({}, cached.result);
        result.source_url = sourceUrl;
      } else {
        // Backwards compatibility with the early development cache format.
        result = douyinItemToResult(cached.item, awemeId, sourceUrl);
      }
      result.resolved_from = "loon_cache";
      return result;
    } catch (_) {
      return null;
    }
  }

  function resolveDouyin(httpGet, sharedUrl, options) {
    var opts = options || {};
    var headers = {
      "User-Agent": IOS_UA,
      Referer: "https://www.douyin.com/",
      Accept: "text/html,application/xhtml+xml"
    };
    if (opts.douyin_cookie) headers.Cookie = String(opts.douyin_cookie);
    var id = extractDouyinId(sharedUrl);
    var expanded = id
      ? Promise.resolve(sharedUrl)
      : followRedirects(httpGet, sharedUrl, headers, 10).then(function (x) { return x.url; });

    return expanded.then(function (finalUrl) {
      var awemeId = extractDouyinId(finalUrl);
      if (!awemeId) throw new VideoSaverError("DOUYIN_ID_NOT_FOUND", "没有从抖音链接中识别到作品 ID", { url: finalUrl });
      var cached = readDouyinCache(opts, awemeId, finalUrl);
      if (cached) return cached;
      var paths = ["share/video", "share/slides", "share/note"];

      function tryPath(index, lastError) {
        if (index >= paths.length) {
          throw lastError || new VideoSaverError("DOUYIN_DATA_NOT_FOUND", "抖音分享页没有返回作品数据");
        }
        var pageUrl = "https://www.iesdouyin.com/" + paths[index] + "/" + awemeId + "/";
        return httpGet({ url: pageUrl, headers: headers, timeout: 15000, "auto-redirect": true })
          .then(function (response) {
            var html = String(response.body || "");
            var router;
            try {
              router = scanJsonValue(html, "_ROUTER_DATA");
            } catch (error) {
              return tryPath(index + 1, new VideoSaverError("DOUYIN_BAD_ROUTER_DATA", "抖音页面数据解析失败", { error: String(error) }));
            }
            var item = findAwemeItem(router, 0);
            if (!item) return tryPath(index + 1, new VideoSaverError("DOUYIN_DATA_NOT_FOUND", "抖音分享页没有找到作品数据"));
            var parsed = douyinItemToResult(item, awemeId, finalUrl);
            parsed.resolved_from = "share_page";
            return parsed;
          }).catch(function (error) {
            if (error && error.code && error.code !== "DOUYIN_DATA_NOT_FOUND" && error.code !== "DOUYIN_BAD_ROUTER_DATA") throw error;
            return tryPath(index + 1, error);
          });
      }

      return tryPath(0, null);
    });
  }

  function resolve(httpGet, input, options) {
    var sharedUrl = cleanSharedUrl(input);
    if (/(?:bilibili\.com|b23\.tv|bili2233\.cn)/i.test(sharedUrl)) {
      return resolveBilibili(httpGet, sharedUrl, options);
    }
    if (/(?:douyin\.com|iesdouyin\.com)/i.test(sharedUrl)) {
      return resolveDouyin(httpGet, sharedUrl, options);
    }
    return Promise.reject(new VideoSaverError("UNSUPPORTED_PLATFORM", "目前仅支持 B 站和抖音公开作品", { url: sharedUrl }));
  }

  function loonHttpGet(request) {
    return new Promise(function (resolvePromise, rejectPromise) {
      $httpClient.get(request, function (error, response, body) {
        if (error) {
          rejectPromise(new VideoSaverError("HTTP_FAILED", "网络请求失败", { error: String(error), url: request.url }));
          return;
        }
        resolvePromise({ status: response.status, headers: response.headers || {}, body: body, url: request.url });
      });
    });
  }

  function runLoon() {
    var input = queryValue($request.url, "url");
    var options = (typeof $argument === "object" && $argument) ? Object.assign({}, $argument) : {};
    options._cacheRead = function (key) { return $persistentStore.read(key); };
    resolve(loonHttpGet, input, options).then(function (result) {
      $done({
        response: {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
          body: JSON.stringify(result)
        }
      });
    }).catch(function (error) {
      var payload = {
        ok: false,
        error: error.code || "UNKNOWN",
        message: error.message || String(error),
        details: error.details || null
      };
      $done({
        response: {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
          body: JSON.stringify(payload)
        }
      });
    });
  }

  function collectAwemeItems(value, depth, output) {
    if (!value || depth > 24 || output.length >= 100) return;
    if (Array.isArray(value)) {
      for (var a = 0; a < value.length && output.length < 100; a += 1) {
        collectAwemeItems(value[a], depth + 1, output);
      }
      return;
    }
    if (typeof value !== "object") return;
    if ((value.aweme_id || value.group_id) && value.video) output.push(value);
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length && output.length < 100; i += 1) {
      collectAwemeItems(value[keys[i]], depth + 1, output);
    }
  }

  function runDouyinCapture() {
    try {
      var payload = JSON.parse(String($response.body || ""));
      var items = [];
      collectAwemeItems(payload, 0, items);
      var stored = {};
      for (var i = 0; i < items.length; i += 1) {
        var id = String(items[i].aweme_id || items[i].group_id || "");
        if (!id || stored[id]) continue;
        try {
          var result = douyinItemToResult(items[i], id, "");
          // Persist only the fields needed for downloading. Do not keep the full feed
          // item, author profile, counters, recommendations, or other response data.
          $persistentStore.write(JSON.stringify({ saved_at: Date.now(), result: result }), "loon_video_saver_douyin_" + id);
          stored[id] = true;
        } catch (_) {
          // Ignore image-only or incomplete feed entries.
        }
      }
      console.log("Loon Video Saver cached " + Object.keys(stored).length + " Douyin video(s)");
    } catch (error) {
      console.log("Loon Video Saver capture skipped: " + String(error));
    }
    $done({});
  }

  var api = {
    VideoSaverError: VideoSaverError,
    cleanSharedUrl: cleanSharedUrl,
    extractBvid: extractBvid,
    extractDouyinId: extractDouyinId,
    scanJsonValue: scanJsonValue,
    findAwemeItem: findAwemeItem,
    normalizeDouyinPlayUrl: normalizeDouyinPlayUrl,
    douyinItemToResult: douyinItemToResult,
    collectAwemeItems: collectAwemeItems,
    resolveBilibili: resolveBilibili,
    resolveDouyin: resolveDouyin,
    resolve: resolve,
    runLoon: runLoon
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LoonVideoSaver = api;
  if (typeof $request !== "undefined" && typeof $done === "function") {
    if (typeof $response !== "undefined" && $response && typeof $response.body !== "undefined") runDouyinCapture();
    else runLoon();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
