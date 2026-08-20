import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";

const { Pool } = pg;

// ── DB Connection ─────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

// ── RÚZ API ───────────────────────────────────────────────────────────────────

const RUZ_API = "https://www.registeruz.sk/cruz-public/api";

async function ruzGet(endpoint, params) {
  const url = new URL(`${RUZ_API}/${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const resp = await fetch(url.toString(), { timeout: 30000 });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`RÚZ API ${endpoint}: HTTP ${resp.status}`);
  return await resp.json();
}

// ── SSH helpers ───────────────────────────────────────────────────────────────

import { execSync } from "child_process";

function ssh(command) {
  return execSync(`ssh root@verifa.sk "${command.replace(/"/g, '\\"')}"`, {
    encoding: "utf-8",
    timeout: 30000,
  });
}

function dockerExec(container, command) {
  return ssh(`docker exec ${container} ${command}`);
}

// ── Tools ─────────────────────────────────────────────────────────────────────

const tools = [
  {
    name: "query_db",
    description: "Execute a read-only SQL query on the Verifa PostgreSQL database. Returns JSON rows.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query (SELECT only)" },
      },
      required: ["sql"],
    },
  },
  {
    name: "ruz_api",
    description: "Call RÚZ API endpoint. Working endpoints: uctovne-jednotky, uctovna-jednotka, uctovna-zavierka, uctovny-vykaz. Search endpoints (ekonomicke-subjekty) may be blocked from server IP.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "API endpoint name (e.g. uctovna-jednotka)" },
        params: { type: "object", description: "Query parameters" },
      },
      required: ["endpoint"],
    },
  },
  {
    name: "ruz_company_financials",
    description: "Fetch all financial statements for a company by ICO from RÚZ API. Returns parsed balance sheet and income statement data for each year.",
    inputSchema: {
      type: "object",
      properties: {
        ico: { type: "string", description: "Company IČO (8 digits)" },
      },
      required: ["ico"],
    },
  },
  {
    name: "check_balance_sheet",
    description: "Check balance sheet equality for a company in the DB. Reports NCA+CA vs totalAssets and equity+ST+LT vs totalAssets for each year.",
    inputSchema: {
      type: "object",
      properties: {
        ico: { type: "string", description: "Company IČO" },
      },
      required: ["ico"],
    },
  },
  {
    name: "docker_logs",
    description: "Get recent Docker container logs from the production server.",
    inputSchema: {
      type: "object",
      properties: {
        container: { type: "string", description: "Container name (e.g. verifa_worker)" },
        lines: { type: "number", description: "Number of lines (default 30)" },
      },
      required: ["container"],
    },
  },
  {
    name: "docker_stats",
    description: "Get Docker container resource usage stats from the production server.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "deploy_worker",
    description: "Deploy worker changes: git pull, rebuild, restart container on production server.",
    inputSchema: {
      type: "object",
      properties: {
        no_cache: { type: "boolean", description: "Use --no-cache for build (default true)" },
      },
    },
  },
];

// ── Tool Handlers ─────────────────────────────────────────────────────────────

async function handleToolCall(name, args) {
  switch (name) {
    case "query_db": {
      const sql = args.sql.trim();
      if (!sql.toUpperCase().startsWith("SELECT") && !sql.toUpperCase().startsWith("WITH")) {
        return { content: [{ type: "text", text: "Error: Only SELECT/WITH queries allowed" }] };
      }
      const result = await pool.query(sql);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    }

    case "ruz_api": {
      const data = await ruzGet(args.endpoint, args.params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "ruz_company_financials": {
      const ico = args.ico;
      // Step 1: Get entity ID
      const units = await ruzGet("uctovne-jednotky", { ico, "zmenene-od": "2000-01-01" });
      if (!units || !units.id) {
        return { content: [{ type: "text", text: `No units found for ICO ${ico}` }] };
      }
      const entityId = units.id[0];

      // Step 2: Get entity detail
      const entity = await ruzGet("uctovna-jednotka", { id: entityId });
      if (!entity) {
        return { content: [{ type: "text", text: `No entity detail for ID ${entityId}` }] };
      }

      const zavierkaIds = entity.idUctovnychZavierok || [];
      const results = [];

      // Step 3: Fetch each zavierka
      for (const zid of zavierkaIds.slice(0, 5)) {
        const z = await ruzGet("uctovna-zavierka", { id: zid });
        if (!z) continue;

        const yearMatch = String(z.obdobieDo || "").match(/20\d{2}/);
        if (!yearMatch) continue;
        const year = parseInt(yearMatch[0]);

        // Step 4: Fetch vykazy, find one with tables
        let tables = null;
        let vykazId = null;
        for (const vid of z.idUctovnychVykazov || []) {
          const v = await ruzGet("uctovny-vykaz", { id: vid });
          if (v && v.obsah && v.obsah.tabulky && v.obsah.tabulky.length > 0) {
            tables = v.obsah.tabulky;
            vykazId = vid;
            break;
          }
        }

        if (!tables) {
          results.push({ year, note: "No tables found (PDF-only vykaz)" });
          continue;
        }

        // Parse tables
        const parsed = parseTables(tables);
        results.push({ year, vykazId, zavierkaId: zid, ...parsed });
      }

      return { content: [{ type: "text", text: JSON.stringify({ entityId, entityName: entity.nazov, statements: results }, null, 2) }] };
    }

    case "check_balance_sheet": {
      const ico = args.ico;
      const result = await pool.query(`
        SELECT year, "totalAssets", "currentAssets", "nonCurrentAssets",
               equity, "shortTermLiabilities", "longTermLiabilities",
               "ltReserves", "stReserves", "stBankLoans"
        FROM "FinancialStatement"
        WHERE "companyIco" = $1
        ORDER BY year DESC
      `, [ico]);

      const rows = result.rows.map(r => {
        const left = (parseFloat(r.nonCurrentAssets) || 0) + (parseFloat(r.currentAssets) || 0);
        const right = (parseFloat(r.equity) || 0) + (parseFloat(r.shortTermLiabilities) || 0) + (parseFloat(r.longTermLiabilities) || 0);
        const ta = parseFloat(r.totalAssets) || 0;
        return {
          ...r,
          leftSum: left,
          rightSum: right,
          leftDiff: ta - left,
          rightDiff: ta - right,
          leftDiffPct: ta > 0 ? ((ta - left) / ta * 100).toFixed(2) + "%" : "N/A",
          rightDiffPct: ta > 0 ? ((ta - right) / ta * 100).toFixed(2) + "%" : "N/A",
        };
      });

      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }

    case "docker_logs": {
      const lines = args.lines || 30;
      const output = dockerExec(args.container, `bash -c 'tail -n ${lines} /tmp/*.log 2>/dev/null || true'`);
      return { content: [{ type: "text", text: output }] };
    }

    case "docker_stats": {
      const output = ssh("docker stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.MemPerc}}'");
      return { content: [{ type: "text", text: output }] };
    }

    case "deploy_worker": {
      const noCache = args.no_cache !== false ? "--no-cache" : "";
      const output = ssh(`cd /opt/scripta && git pull && docker compose build worker ${noCache} && docker compose up -d worker`);
      return { content: [{ type: "text", text: output }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  }
}

// ── RÚZ Table Parser ──────────────────────────────────────────────────────────

function normalizeStr(s) {
  if (!s) return "";
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function getNazov(t) {
  const n = t.nazov;
  if (typeof n === "object") return normalizeStr(n.sk || n.en || "");
  return normalizeStr(String(n || ""));
}

function findTable(tables, kind) {
  for (let i = 0; i < tables.length; i++) {
    const nazov = getNazov(tables[i]);
    if (kind === "aktiv" && (nazov.includes("aktiv") || nazov.includes("asset"))) return i;
    if (kind === "pasiv" && (nazov.includes("pasiv") || nazov.includes("liabilit"))) return i;
    if (kind === "income" && (nazov.includes("zisk") || nazov.includes("income"))) return i;
  }
  return -1;
}

function toFloat(val) {
  if (val === null || val === undefined || val === "" || val === 0) return null;
  const f = parseFloat(val);
  return isNaN(f) ? null : f;
}

function extractVal(tables, tableIdx, rowNum, offset, dataCols, current = true) {
  if (tableIdx < 0 || tableIdx >= tables.length) return null;
  const data = tables[tableIdx].data;
  if (!data || data.length === 0) return null;
  const idx = rowNum - offset;
  if (idx < 0) return null;

  const first = data[0];
  if (!Array.isArray(first) && dataCols > 0) {
    // Flat array
    const start = idx * dataCols;
    if (start + dataCols > data.length) return null;
    const row = data.slice(start, start + dataCols);
    return toFloat(row[current ? 0 : 1]);
  } else {
    // List-of-lists
    if (idx >= data.length) return null;
    const row = data[idx];
    if (!row) return null;
    if (Array.isArray(row)) {
      const dataStart = row.length > dataCols ? row.length - dataCols : 0;
      return toFloat(row[dataStart + (current ? 0 : 1)]);
    }
    return toFloat(row);
  }
}

function parseTables(tables) {
  const aktivIdx = findTable(tables, "aktiv");
  const pasivIdx = findTable(tables, "pasiv");
  const incomeIdx = findTable(tables, "income");

  const ACTIV_OFFSET = 1, PASIV_OFFSET = 79, INCOME_OFFSET = 1;
  const ACTIV_COLS = 4, PASIV_COLS = 2, INCOME_COLS = 2;

  const ta = extractVal(tables, aktivIdx, 1, ACTIV_OFFSET, ACTIV_COLS);
  const nca = extractVal(tables, aktivIdx, 2, ACTIV_OFFSET, ACTIV_COLS);
  const ca = extractVal(tables, aktivIdx, 33, ACTIV_OFFSET, ACTIV_COLS);
  const eq = extractVal(tables, pasivIdx, 80, PASIV_OFFSET, PASIV_COLS);
  const sl = extractVal(tables, pasivIdx, 122, PASIV_OFFSET, PASIV_COLS);
  const ll = extractVal(tables, pasivIdx, 102, PASIV_OFFSET, PASIV_COLS);

  const hasIncome = incomeIdx >= 0;
  const trzby = hasIncome ? extractVal(tables, incomeIdx, 1, INCOME_OFFSET, INCOME_COLS) : null;
  const spotreba = hasIncome ? extractVal(tables, incomeIdx, 12, INCOME_OFFSET, INCOME_COLS) : null;
  const sluzby = hasIncome ? extractVal(tables, incomeIdx, 14, INCOME_OFFSET, INCOME_COLS) : null;
  const opCosts = hasIncome ? extractVal(tables, incomeIdx, 10, INCOME_OFFSET, INCOME_COLS) : null;

  let cogsProxy = null;
  if (spotreba !== null || sluzby !== null) {
    cogsProxy = (spotreba || 0) + (sluzby || 0);
  }
  let hrubaMarza = null;
  if (trzby !== null && cogsProxy !== null && cogsProxy > 0) {
    hrubaMarza = trzby - cogsProxy;
  }
  if (hrubaMarza === null && hasIncome) {
    hrubaMarza = extractVal(tables, incomeIdx, 28, INCOME_OFFSET, INCOME_COLS);
  }

  return {
    totalAssets: ta, nonCurrentAssets: nca, currentAssets: ca,
    equity: eq, shortTermLiabilities: sl, longTermLiabilities: ll,
    revenue: trzby, materialConsumption: spotreba, servicesCosts: sluzby,
    operatingCosts: opCosts, grossProfit: hrubaMarza,
  };
}

// ── Server Setup ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "verifa-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    return await handleToolCall(name, args || {});
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }] };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Verifa MCP Server running on stdio");
