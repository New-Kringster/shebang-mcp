#!/usr/bin/env node
// shebang MCP server: a pure HTTP client over the shebang platform's public
// /api/{sherpage,platform,sherbase,sherserve,sherlink}/v1 routes. No
// Supabase SDK, no database credentials — an agent machine holds only an
// shb_… API key (SHEBANG_API_KEY; SHERPAGE_API_KEY accepted as a legacy
// alias for the same key).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApiClient } from "./api-client.js";
import { registerTools } from "./tools.js";

// shebang: read the reported server version from package.json instead of
// a hardcoded literal, same as the dash hosted route already does
// (apps/dash/src/app/api/mcp/route.ts imports { version } from
// "shebang-mcp/package.json") -- one source of truth, so a version bump
// can't drift between what's published and what a connected client sees.
// createRequire rather than a JSON import assertion: this file runs
// directly via `node src/index.js` (no bundler), so it needs to work
// under whatever Node version a caller's `npx` resolves, not just the
// newest ones with import-attribute support.
const { version: SHEBANG_MCP_VERSION } = createRequire(import.meta.url)("../package.json");

/**
 * Reads ~/.config/shebang/credentials.json synchronously, if present and
 * parseable — the file the public shebang-mcp CLI's `login` command writes
 * ({api_key, base_url}). Final fallback behind the SHEBANG_* / SHERPAGE_*
 * env vars, so "log in once, every harness picks it up" without extra config.
 * Silent on any failure (missing file, bad JSON, wrong shape): this is a
 * best-effort convenience, not a required config source.
 * @returns {{api_key?: string, base_url?: string}}
 */
function readCredentialsFile() {
  try {
    const path = join(homedir(), ".config", "shebang", "credentials.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const credentials = readCredentialsFile();

const API_KEY = process.env.SHEBANG_API_KEY ?? process.env.SHERPAGE_API_KEY ?? credentials.api_key;
if (!API_KEY) {
  console.error(
    "shebang-mcp: missing API key. Set SHEBANG_API_KEY (or legacy SHERPAGE_API_KEY) to an shb_… API key " +
      "minted from the account page, or run `npx -y github:New-Kringster/shebang-mcp login` to write " +
      "~/.config/shebang/credentials.json, and try again.",
  );
  process.exit(1);
}

const BASE_URL = (
  process.env.SHEBANG_BASE_URL ?? process.env.SHERPAGE_BASE_URL ?? credentials.base_url ?? "https://dash.shebang.pro"
).replace(/\/+$/, "");

const apiClient = createApiClient({ apiKey: API_KEY, baseUrl: BASE_URL });
const server = new McpServer({ name: "shebang", version: SHEBANG_MCP_VERSION });
registerTools(server, apiClient);

const transport = new StdioServerTransport();
await server.connect(transport);
