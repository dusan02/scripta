#!/usr/bin/env node
/**
 * Google Search Console monitor for Verifa.sk
 *
 * Requirements:
 *   - GSC_SERVICE_ACCOUNT_FILE env var pointing to a service account JSON file
 *   - Service account must have access to verifa.sk GSC property
 *   - googleapis npm package: npm install googleapis
 *
 * Usage:
 *   GSC_SERVICE_ACCOUNT_FILE=/path/to/service-account.json node scripts/gsc-monitor.mjs
 *   GSC_SERVICE_ACCOUNT_FILE=/path/to/service-account.json node scripts/gsc-monitor.mjs --url=/firmy/ubytovanie-a-stravovanie
 *
 * Setup:
 *   1. Go to Google Cloud Console → IAM → Service Accounts → Create
 *   2. Create JSON key, download it
 *   3. Add service account email as a user in GSC (verifa.sk property)
 *   4. Set GSC_SERVICE_ACCOUNT_FILE env var to path of JSON file
 */

const https = require("https");

const SITE_URL = "https://verifa.sk";
const SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"];

function getEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`ERROR: ${name} env var not set`);
    console.error("");
    console.error("Setup:");
    console.error("  1. Create a service account in Google Cloud Console");
    console.error("  2. Download JSON key file");
    console.error("  3. Add service account email to GSC users for verifa.sk");
    console.error("  4. Run: GSC_SERVICE_ACCOUNT_FILE=/path/to/key.json node scripts/gsc-monitor.mjs");
    process.exit(1);
  }
  return v;
}

async function getAccessToken(serviceAccountFile) {
  const fs = require("fs");
  const crypto = require("crypto");

  const key = JSON.parse(fs.readFileSync(serviceAccountFile, "utf-8"));
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: key.client_email,
    scope: SCOPES.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: expiry,
    iat: now,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  const signature = sign.sign(key.private_key, "base64url");

  const jwt = `${data}.${signature}`;

  // Exchange JWT for access token
  return new Promise((resolve, reject) => {
    const postData = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
    const req = https.request(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            if (json.access_token) resolve(json.access_token);
            else reject(new Error(`Token exchange failed: ${body}`));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function gscApi(path, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/${path}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve({ raw: body, statusCode: res.statusCode });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function gscApiPost(path, body, accessToken) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = https.request(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        let respBody = "";
        res.on("data", (d) => (respBody += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(respBody));
          } catch (e) {
            resolve({ raw: respBody, statusCode: res.statusCode });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  const serviceAccountFile = getEnv("GSC_SERVICE_ACCOUNT_FILE");
  const specificUrl = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1];

  console.log("=== Verifa.sk GSC Monitor ===\n");

  try {
    const token = await getAccessToken(serviceAccountFile);
    console.log("✅ Authenticated\n");

    // 1. List sitemaps
    console.log("--- Sitemaps ---");
    const sitemaps = await gscApi("sitemaps", token);
    if (sitemaps.sitemap) {
      for (const sm of sitemaps.sitemap) {
        console.log(`  ${sm.path}`);
        console.log(`    Last submitted: ${sm.lastSubmitted?.lastSubmitted || "N/A"}`);
        console.log(`    Last downloaded: ${sm.lastDownloaded?.lastDownloaded || "N/A"}`);
        console.log(`    Errors: ${sm.errors || 0}`);
        console.log(`    Indexed: ${sm.contents?.indexed || "N/A"}`);
        console.log(`    Submitted: ${sm.contents?.submitted || "N/A"}`);
      }
    } else {
      console.log("  No sitemaps submitted yet");
      console.log("  → Submit: https://verifa.sk/sitemap.xml");
    }

    // 2. Search analytics (last 28 days)
    console.log("\n--- Search Analytics (last 28 days) ---");
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
    const analytics = await gscApiPost(
      "searchAnalytics/query",
      {
        startDate,
        endDate,
        dimensions: ["page"],
        rowLimit: 20,
      },
      token
    );
    if (analytics.rows) {
      console.log(`  Total rows: ${analytics.rows.length}`);
      for (const row of analytics.rows.slice(0, 10)) {
        console.log(`  ${row.keys[0]}`);
        console.log(`    Impressions: ${row.impressions}, Clicks: ${row.clicks}, CTR: ${(row.ctr * 100).toFixed(2)}%, Position: ${row.position.toFixed(1)}`);
      }
    } else {
      console.log("  No data yet (site may not be verified or no data collected)");
    }

    // 3. URL inspection (if --url= provided)
    if (specificUrl) {
      console.log(`\n--- URL Inspection: ${specificUrl} ---`);
      const fullUrl = specificUrl.startsWith("http") ? specificUrl : `${SITE_URL}${specificUrl}`;
      const inspection = await gscApiPost(
        "searchAnalytics/query",
        {
          startDate,
          endDate,
          dimensions: ["page"],
          dimensionFilterGroups: [{ filters: [{ dimension: "page", expression: fullUrl }] }],
          rowLimit: 1,
        },
        token
      );
      if (inspection.rows && inspection.rows.length > 0) {
        const r = inspection.rows[0];
        console.log(`  URL: ${r.keys[0]}`);
        console.log(`  Impressions: ${r.impressions}, Clicks: ${r.clicks}, CTR: ${(r.ctr * 100).toFixed(2)}%, Position: ${r.position.toFixed(1)}`);
      } else {
        console.log("  No data for this URL yet");
      }
    }

    // 4. Index coverage summary
    console.log("\n--- Index Coverage Summary ---");
    const indexStats = await gscApiPost(
      "searchAnalytics/query",
      {
        startDate,
        endDate,
        dimensions: [],
        rowLimit: 1,
      },
      token
    );
    if (indexStats.rows && indexStats.rows.length > 0) {
      const r = indexStats.rows[0];
      console.log(`  Total impressions: ${r.impressions}`);
      console.log(`  Total clicks: ${r.clicks}`);
      console.log(`  Average CTR: ${(r.ctr * 100).toFixed(2)}%`);
      console.log(`  Average position: ${r.position.toFixed(1)}`);
    } else {
      console.log("  No data yet");
    }

    console.log("\n=== GSC Monitor Complete ===");
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}

main();
