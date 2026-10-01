import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const saver = require("../src/video-saver.js");

async function httpGet(request) {
  const response = await fetch(request.url, {
    method: "GET",
    headers: request.headers || {},
    redirect: request["auto-redirect"] === false ? "manual" : "follow"
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
    url: request.url
  };
}

const target = process.argv[2] || "https://www.bilibili.com/video/BV13x41117TL";
const result = await saver.resolve(httpGet, target, {});
const mediaCheck = await fetch(result.url, {
  method: "GET",
  headers: { ...result.headers, Range: "bytes=0-1" },
  redirect: "follow"
});
console.log(JSON.stringify({
  result: { ...result, url: result.url.slice(0, 160) + "..." },
  media: {
    status: mediaCheck.status,
    contentType: mediaCheck.headers.get("content-type"),
    contentRange: mediaCheck.headers.get("content-range")
  }
}, null, 2));
