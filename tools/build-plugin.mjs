import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const scriptUrl = process.argv[2];
if (!scriptUrl || !/^https?:\/\//i.test(scriptUrl)) {
  console.error("Usage: node tools/build-plugin.mjs <public-video-saver.js-url>");
  process.exit(2);
}
const template = fs.readFileSync(path.join(root, "VideoSaver.plugin.template"), "utf8");
const output = template.replaceAll("__SCRIPT_URL__", scriptUrl.replaceAll('"', "%22"));
if (output.includes("__SCRIPT_URL__")) throw new Error("Plugin template replacement failed");
fs.writeFileSync(path.join(root, "VideoSaver.plugin"), output, "utf8");
console.log(path.join(root, "VideoSaver.plugin"));
