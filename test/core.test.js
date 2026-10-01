"use strict";

const assert = require("node:assert/strict");
const saver = require("../src/video-saver.js");

assert.equal(
  saver.cleanSharedUrl("复制链接 https://v.douyin.com/AbCdE/ 打开抖音"),
  "https://v.douyin.com/AbCdE/"
);
assert.equal(saver.extractBvid("https://www.bilibili.com/video/BV13x41117TL?p=1"), "BV13x41117TL");
assert.equal(saver.extractDouyinId("https://www.douyin.com/video/7690698488891362579"), "7690698488891362579");
assert.equal(saver.extractDouyinId("https://www.douyin.com/jingxuan?modal_id=7690698488891362579"), "7690698488891362579");
assert.equal(
  saver.normalizeDouyinPlayUrl("https://example.test/playwm/?watermark=1&ratio=720p"),
  "https://example.test/play/?watermark=0&ratio=1080p"
);

const fixture = '<script>window._ROUTER_DATA = {"loaderData":{"video_1/page":{"videoInfoRes":{"item_list":[{"aweme_id":"1234567890123456789","desc":"fixture","video":{"play_addr":{"url_list":["https://example.test/playwm/?ratio=720p"]}}}]}}}};</script>';
const router = saver.scanJsonValue(fixture, "_ROUTER_DATA");
const item = saver.findAwemeItem(router, 0);
assert.equal(item.aweme_id, "1234567890123456789");
assert.equal(item.desc, "fixture");

const items = [];
saver.collectAwemeItems({ feed: [item, { aweme_id: "2", images: [] }] }, 0, items);
assert.equal(items.length, 1);
assert.equal(saver.douyinItemToResult(item, item.aweme_id, "fixture").platform, "douyin");

(async () => {
  const cached = JSON.stringify({ saved_at: Date.now(), item });
  const result = await saver.resolveDouyin(
    async () => { throw new Error("cache path must not access network"); },
    "https://www.douyin.com/video/1234567890123456789",
    { _cacheRead: () => cached }
  );
  assert.equal(result.resolved_from, "loon_cache");
  assert.equal(result.id, "1234567890123456789");

  const minimalCached = JSON.stringify({
    saved_at: Date.now(),
    result: saver.douyinItemToResult(item, item.aweme_id, "")
  });
  const minimalResult = await saver.resolveDouyin(
    async () => { throw new Error("minimal cache path must not access network"); },
    "https://www.douyin.com/video/1234567890123456789",
    { _cacheRead: () => minimalCached }
  );
  assert.equal(minimalResult.resolved_from, "loon_cache");
  assert.equal(minimalResult.source_url, "https://www.douyin.com/video/1234567890123456789");

  const biliRequests = [];
  const biliResult = await saver.resolveBilibili(async (request) => {
    biliRequests.push(request);
    if (request.url.includes("/x/web-interface/view")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          code: 0,
          data: { title: "fixture", pages: [{ cid: 42, part: "P1" }] }
        })
      };
    }
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        code: 0,
        data: { quality: 64, durl: [{ url: "https://cdn.example/video.mp4", size: 10 }] }
      })
    };
  }, "https://www.bilibili.com/video/BV13x41117TL", {
    bilibili_cookie: "SESSDATA=private"
  });
  assert.equal(biliRequests[0].headers.Cookie, "SESSDATA=private");
  assert.equal(biliResult.headers.Cookie, undefined);
  assert.equal(biliResult.url, "https://cdn.example/video.mp4");
  console.log("core tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
