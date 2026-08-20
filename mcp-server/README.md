# Verifa MCP Server

MCP server providing tools for Verifa development:

## Tools

- **query_db** — Execute read-only SQL queries on the production PostgreSQL database
- **ruz_api** — Call RÚZ API endpoints (uctovne-jednotky, uctovna-jednotka, uctovna-zavierka, uctovny-vykaz)
- **ruz_company_financials** — Fetch and parse all financial statements for a company by ICO
- **check_balance_sheet** — Check balance sheet equality (aktíva = pasíva) for a company in DB
- **docker_logs** — Get recent Docker container logs from production
- **docker_stats** — Get Docker container resource usage stats
- **deploy_worker** — Deploy worker changes (git pull, rebuild, restart)

## Setup

```bash
cd mcp-server
npm install
```

## Configuration

Add to your MCP client config (e.g. Windsurf settings):

```json
{
  "mcpServers": {
    "verifa": {
      "command": "node",
      "args": ["/Users/dusanbaran/Desktop/Projects/scripta/mcp-server/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://verifa:7LFo1xE2KbGbhiXcwSdnsZArsNCody9@verifa.sk:5432/verifa"
      }
    }
  }
}
```

## Usage

Once connected, Cascade can directly:
- Query the DB without writing /tmp/check_company*.py scripts
- Fetch RÚZ data without scp + ssh + docker exec cycles
- Check balance sheets with a single call
- Deploy changes with a single command
