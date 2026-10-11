/**
 * IndexNow — submit the full sitemap URL set to Bing/Yandex (and downstream
 * DuckDuckGo/Yahoo/Ecosia). Runs as a PM2 cron job on the VPS; also usable
 * manually: `node scripts/indexnow.mjs`.
 *
 * Key verification file: frontend/public/<INDEXNOW_KEY>.txt served at site root.
 */

const HOST = 'verifa.sk';
const KEY = '9141a55f71827fa50be4dda1ffbcc66e';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITEMAP = `https://${HOST}/sitemap.xml`;
const CHUNK = 10000; // IndexNow max URLs per POST

async function fetchXml(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.text();
}

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

async function collectUrls(sitemapUrl, depth = 0) {
  const xml = await fetchXml(sitemapUrl);
  // Sitemap index → recurse into child sitemaps (verifa.sk serves one).
  if (xml.includes('<sitemapindex')) {
    const children = locs(xml);
    const nested = await Promise.all(children.map((c) => collectUrls(c, depth + 1)));
    return nested.flat();
  }
  return locs(xml);
}

async function main() {
  const urls = await collectUrls(SITEMAP);
  if (urls.length === 0) throw new Error('sitemap returned 0 URLs — refusing to submit empty list');
  console.log(`[indexnow] ${urls.length} URLs from sitemap`);

  for (let i = 0; i < urls.length; i += CHUNK) {
    const urlList = urls.slice(i, i + CHUNK);
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
      signal: AbortSignal.timeout(30000),
    });
    console.log(`[indexnow] batch ${Math.floor(i / CHUNK) + 1}: ${urlList.length} URLs -> ${r.status}`);
  }
}

main().catch((e) => {
  console.error(`[indexnow] failed: ${e.message}`);
  process.exit(1);
});
