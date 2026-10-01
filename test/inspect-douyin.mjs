const id = process.argv[2];
const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
for (const path of ["share/video", "share/slides", "share/note"]) {
  const url = `https://www.iesdouyin.com/${path}/${id}/`;
  const response = await fetch(url, { headers: { "User-Agent": ua, Referer: "https://www.douyin.com/" }, redirect: "follow" });
  const body = await response.text();
  console.log(JSON.stringify({
    path,
    status: response.status,
    final: response.url,
    length: body.length,
    router: body.indexOf("_ROUTER_DATA"),
    universal: body.indexOf("__UNIVERSAL_DATA_FOR_REHYDRATION__"),
    render: body.indexOf("RENDER_DATA"),
    title: (body.match(/<title>(.*?)<\/title>/i) || [])[1] || null,
    sample: body.slice(0, 120)
  }));
}
