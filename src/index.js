#!/usr/bin/env node
// shebang MCP server: a pure HTTP client over the shebang platform's public
// /api/{sherpage,platform,sherbase,sherserve,sherlink}/v1 routes. No
// Supabase SDK, no database credentials — an agent machine holds only an
// shb_… API key (SHEBANG_API_KEY; SHERPAGE_API_KEY accepted as a legacy
// alias for the same key).

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
const API_BASE = `${BASE_URL}/api/sherpage/v1`;

/**
 * Thin fetch wrapper for the sherpage v1 API.
 * @param {"GET"|"POST"|"PATCH"|"DELETE"} method
 * @param {string} path - path under /api/sherpage/v1, e.g. "/pages" or "/pages/abc"
 * @param {unknown} [body]
 * @returns {Promise<{ok: boolean, status: number, data: unknown}>}
 */
async function apiRequest(method, path, body) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ToolError(`request to sherpage API failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 204) {
    return { ok: true, status: 204, data: null };
  }

  let data;
  const text = await response.text();
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = { error: text || "invalid response from sherpage API" };
  }

  return { ok: response.ok, status: response.status, data };
}

/** Readable tool error: status + error field, never a stack trace. */
class ToolError extends Error {}

/**
 * Calls apiRequest and throws a ToolError with a readable message if the
 * response was not ok.
 * @param {"GET"|"POST"|"PATCH"|"DELETE"} method
 * @param {string} path
 * @param {unknown} [body]
 */
async function apiCall(method, path, body) {
  const result = await apiRequest(method, path, body);
  if (!result.ok) {
    const errorField =
      result.data && typeof result.data === "object" && "error" in result.data
        ? result.data.error
        : JSON.stringify(result.data);
    throw new ToolError(`sherpage API error ${result.status}: ${errorField}`);
  }
  return result.data;
}

// Platform API lives at a different base path than sherpage's v1 API, but
// shares the same host, key, and error style — a separate pair of
// request/call helpers mirroring apiRequest/apiCall above, rather than
// overloading them with a variable base.
const PLATFORM_API_BASE = `${BASE_URL}/api/platform/v1`;

/**
 * Thin fetch wrapper for the platform v1 API.
 * @param {"GET"|"POST"|"DELETE"} method
 * @param {string} path - path under /api/platform/v1, e.g. "/oauth-clients" or "/keys/abc"
 * @param {unknown} [body]
 * @returns {Promise<{ok: boolean, status: number, data: unknown}>}
 */
async function platformApiRequest(method, path, body) {
  let response;
  try {
    response = await fetch(`${PLATFORM_API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ToolError(`request to platform API failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 204) {
    return { ok: true, status: 204, data: null };
  }

  let data;
  const text = await response.text();
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = { error: text || "invalid response from platform API" };
  }

  return { ok: response.ok, status: response.status, data };
}

/**
 * Calls platformApiRequest and throws a ToolError with a readable message
 * if the response was not ok.
 * @param {"GET"|"POST"|"DELETE"} method
 * @param {string} path
 * @param {unknown} [body]
 */
async function platformApiCall(method, path, body) {
  const result = await platformApiRequest(method, path, body);
  if (!result.ok) {
    const errorField =
      result.data && typeof result.data === "object" && "error" in result.data
        ? result.data.error
        : JSON.stringify(result.data);
    throw new ToolError(`platform API error ${result.status}: ${errorField}`);
  }
  return result.data;
}

// sherbase API lives at yet another base path than sherpage/platform, but
// shares the same host, key, and error style — a third pair of
// request/call helpers mirroring apiRequest/apiCall and
// platformApiRequest/platformApiCall above.
const SHERBASE_API_BASE = `${BASE_URL}/api/sherbase/v1`;

/**
 * Thin fetch wrapper for the sherbase v1 API.
 * @param {"GET"|"POST"|"DELETE"} method
 * @param {string} path - path under /api/sherbase/v1, e.g. "/projects" or "/projects/abc"
 * @param {unknown} [body]
 * @returns {Promise<{ok: boolean, status: number, data: unknown}>}
 */
async function sherbaseApiRequest(method, path, body) {
  let response;
  try {
    response = await fetch(`${SHERBASE_API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ToolError(`request to sherbase API failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 204) {
    return { ok: true, status: 204, data: null };
  }

  let data;
  const text = await response.text();
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = { error: text || "invalid response from sherbase API" };
  }

  return { ok: response.ok, status: response.status, data };
}

/**
 * Calls sherbaseApiRequest and throws a ToolError with a readable message
 * if the response was not ok.
 * @param {"GET"|"POST"|"DELETE"} method
 * @param {string} path
 * @param {unknown} [body]
 */
async function sherbaseApiCall(method, path, body) {
  const result = await sherbaseApiRequest(method, path, body);
  if (!result.ok) {
    const errorField =
      result.data && typeof result.data === "object" && "error" in result.data
        ? result.data.error
        : JSON.stringify(result.data);
    throw new ToolError(`sherbase API error ${result.status}: ${errorField}`);
  }
  return result.data;
}

// sherserve API lives at yet another base path than sherpage/platform/sherbase,
// but shares the same host, key, and error style — a fourth pair of
// request/call helpers mirroring the three above. Unlike the others, its
// upload endpoint takes multipart/form-data (a FormData body) rather than
// JSON, so this pair skips JSON-encoding whenever body is a FormData
// instance and lets fetch set its own multipart content-type/boundary.
const SHERSERVE_API_BASE = `${BASE_URL}/api/sherserve/v1`;

/**
 * Thin fetch wrapper for the sherserve v1 API.
 * @param {"GET"|"POST"|"PATCH"|"DELETE"} method
 * @param {string} path - path under /api/sherserve/v1, e.g. "/objects" or "/objects/abc"
 * @param {unknown|FormData} [body] - a FormData body is sent as multipart; anything else as JSON
 * @returns {Promise<{ok: boolean, status: number, data: unknown}>}
 */
async function sherserveApiRequest(method, path, body) {
  const isFormData = body instanceof FormData;
  let response;
  try {
    response = await fetch(`${SHERSERVE_API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        ...(body !== undefined && !isFormData ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    });
  } catch (err) {
    throw new ToolError(`request to sherserve API failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 204) {
    return { ok: true, status: 204, data: null };
  }

  let data;
  const text = await response.text();
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = { error: text || "invalid response from sherserve API" };
  }

  return { ok: response.ok, status: response.status, data };
}

/**
 * Calls sherserveApiRequest and throws a ToolError with a readable message
 * if the response was not ok.
 * @param {"GET"|"POST"|"PATCH"|"DELETE"} method
 * @param {string} path
 * @param {unknown|FormData} [body]
 */
async function sherserveApiCall(method, path, body) {
  const result = await sherserveApiRequest(method, path, body);
  if (!result.ok) {
    const errorField =
      result.data && typeof result.data === "object" && "error" in result.data
        ? result.data.error
        : JSON.stringify(result.data);
    throw new ToolError(`sherserve API error ${result.status}: ${errorField}`);
  }
  return result.data;
}

// sherlink API lives at yet another base path than sherpage/platform/
// sherbase/sherserve, but shares the same host, key, and error style — a
// fifth pair of request/call helpers mirroring the four above.
const SHERLINK_API_BASE = `${BASE_URL}/api/sherlink/v1`;

/**
 * Thin fetch wrapper for the sherlink v1 API.
 * @param {"GET"|"PATCH"|"DELETE"} method
 * @param {string} path - path under /api/sherlink/v1, e.g. "/links" or "/links/abc"
 * @param {unknown} [body]
 * @returns {Promise<{ok: boolean, status: number, data: unknown}>}
 */
async function sherlinkApiRequest(method, path, body) {
  let response;
  try {
    response = await fetch(`${SHERLINK_API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ToolError(`request to sherlink API failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 204) {
    return { ok: true, status: 204, data: null };
  }

  let data;
  const text = await response.text();
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = { error: text || "invalid response from sherlink API" };
  }

  return { ok: response.ok, status: response.status, data };
}

/**
 * Calls sherlinkApiRequest and throws a ToolError with a readable message
 * if the response was not ok.
 * @param {"GET"|"PATCH"|"DELETE"} method
 * @param {string} path
 * @param {unknown} [body]
 */
async function sherlinkApiCall(method, path, body) {
  const result = await sherlinkApiRequest(method, path, body);
  if (!result.ok) {
    const errorField =
      result.data && typeof result.data === "object" && "error" in result.data
        ? result.data.error
        : JSON.stringify(result.data);
    throw new ToolError(`sherlink API error ${result.status}: ${errorField}`);
  }
  return result.data;
}

const OBJECT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * store_get_object/store_delete_object accept either a slug or an id, but
 * the HTTP API only addresses objects by id (GET/PATCH/DELETE
 * /objects/[id] 404s on anything that isn't a UUID — there is no
 * slug-keyed route). Resolves a slug to its id by scanning the list
 * endpoint (active, then archived) before the id-keyed call.
 * @param {string} slugOrId
 * @returns {Promise<string>}
 */
async function resolveObjectId(slugOrId) {
  if (OBJECT_ID_RE.test(slugOrId)) return slugOrId;
  for (const status of ["active", "archived"]) {
    const result = await sherserveApiCall("GET", `/objects?status=${status}`);
    const match = (result.objects ?? []).find((o) => o.slug === slugOrId);
    if (match) return match.id;
  }
  throw new ToolError(`no object found with slug "${slugOrId}"`);
}

const LINK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * link_get/link_set_access/link_set_alias/link_delete accept a code,
 * custom alias, or id, but the HTTP API only addresses links by id
 * (GET/PATCH/DELETE /links/[id] 404s on anything that isn't a UUID — there
 * is no code- or alias-keyed route). Resolves a code or alias to its id by
 * scanning the list endpoint before the id-keyed call.
 * @param {string} codeOrId
 * @returns {Promise<string>}
 */
async function resolveLinkId(codeOrId) {
  if (LINK_ID_RE.test(codeOrId)) return codeOrId;
  const result = await sherlinkApiCall("GET", "/links");
  const match = (result.links ?? []).find((l) => l.code === codeOrId || l.alias === codeOrId);
  if (match) return match.id;
  throw new ToolError(`no link found with code or alias "${codeOrId}"`);
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function errorResult(err) {
  const message = err instanceof ToolError || err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

const server = new McpServer({ name: "shebang", version: "0.1.0" });

const fileSchema = z.object({
  path: z.string().describe("File path within the bundle, e.g. index.html or assets/app.js"),
  content: z.string().describe("File content, encoded per the encoding field"),
  encoding: z.enum(["utf8", "base64"]).describe("How content is encoded"),
});

const accessSchema = z.enum(["private", "password", "allow_list", "public"]);

server.tool(
  "sherpage_publish",
  "Publish a new sherpage: uploads a bundle of files and returns the public page URL.",
  {
    title: z.string().min(1).max(200).describe("Page title"),
    slug: z.string().optional().describe("Optional URL slug; derived from the title if omitted or invalid"),
    access: accessSchema.optional().describe("Access level; defaults to private"),
    entrypoint: z.string().optional().describe("Entry file served at the page root; defaults to index.html"),
    expiresAt: z.string().optional().describe("ISO 8601 timestamp after which the page stops serving"),
    maxViews: z.number().int().positive().optional().describe("Maximum number of views before the page stops serving"),
    password: z.string().optional().describe("Password required to view the page; required when access is 'password'"),
    allow: z
      .array(z.string())
      .optional()
      .describe("Allow-list entries for access 'allow_list': emails or @handles"),
    files: z.array(fileSchema).min(1).describe("Bundle files to upload"),
  },
  async ({ title, slug, access, entrypoint, expiresAt, maxViews, password, allow, files }) => {
    try {
      const body = {
        title,
        ...(slug !== undefined ? { slug } : {}),
        ...(access !== undefined ? { access } : {}),
        ...(entrypoint !== undefined ? { entrypoint } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(maxViews !== undefined ? { maxViews } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(allow !== undefined ? { allow } : {}),
        files,
      };
      const page = await apiCall("POST", "/pages", body);
      return textResult(
        `Published "${title}" at ${page.url}\nid: ${page.id}, slug: ${page.slug}, access: ${page.access}, ` +
          `files: ${page.fileCount}, size: ${page.sizeBytes} bytes`,
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "sherpage_update",
  "Update a sherpage's title, slug, expiry, or view budget. Returns the page URL.",
  {
    id: z.string().describe("Page id"),
    title: z.string().min(1).max(200).optional().describe("New title"),
    slug: z.string().optional().describe("New slug"),
    expiresAt: z.string().nullable().optional().describe("New ISO 8601 expiry timestamp, or null to clear it"),
    maxViews: z.number().int().positive().nullable().optional().describe("New max-views budget, or null to clear it"),
  },
  async ({ id, title, slug, expiresAt, maxViews }) => {
    try {
      const body = {
        ...(title !== undefined ? { title } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(maxViews !== undefined ? { maxViews } : {}),
      };
      const page = await apiCall("PATCH", `/pages/${id}`, body);
      return textResult(`Updated "${page.title}" at ${page.url}\naccess: ${page.access}, status: ${page.status}`);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "sherpage_list",
  "List your sherpages. Returns each page's URL.",
  {
    status: z.enum(["active", "archived"]).optional().describe("Filter by status; defaults to active"),
  },
  async ({ status }) => {
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const result = await apiCall("GET", `/pages${query}`);
      const pages = result.pages ?? [];
      if (pages.length === 0) {
        return textResult(`No ${status ?? "active"} pages found.`);
      }
      const lines = pages.map(
        (p) => `- ${p.title} — ${p.url} (id: ${p.id}, access: ${p.access}, status: ${p.status})`,
      );
      return textResult(`${pages.length} page(s):\n${lines.join("\n")}`);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "sherpage_get",
  "Get details for one sherpage by id. Returns the page URL.",
  {
    id: z.string().describe("Page id"),
  },
  async ({ id }) => {
    try {
      const page = await apiCall("GET", `/pages/${id}`);
      return textResult(
        `"${page.title}" at ${page.url}\naccess: ${page.access}, status: ${page.status}, ` +
          `files: ${page.fileCount}, size: ${page.sizeBytes} bytes, views: ${page.viewCount}` +
          `${page.maxViews !== null ? ` / ${page.maxViews}` : ""}, expiresAt: ${page.expiresAt ?? "never"}`,
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "sherpage_set_access",
  "Change a sherpage's access level (and password, if applicable). Returns the page URL.",
  {
    id: z.string().describe("Page id"),
    access: accessSchema.describe("New access level"),
    password: z
      .string()
      .nullable()
      .optional()
      .describe("Password to set when access is 'password'; pass null to clear a previously-set password"),
  },
  async ({ id, access, password }) => {
    try {
      const body = { access, ...(password !== undefined ? { password } : {}) };
      const page = await apiCall("PATCH", `/pages/${id}`, body);
      return textResult(`Access for "${page.title}" (${page.url}) is now "${page.access}".`);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "sherpage_archive",
  "Archive (or restore) a sherpage. Returns the page URL.",
  {
    id: z.string().describe("Page id"),
    restore: z.boolean().optional().describe("Set true to restore an archived page back to active instead"),
  },
  async ({ id, restore }) => {
    try {
      const body = { status: restore ? "active" : "archived" };
      const page = await apiCall("PATCH", `/pages/${id}`, body);
      return textResult(`"${page.title}" (${page.url}) is now ${page.status}.`);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "sherpage_delete",
  "Permanently deletes the page and its link — pass confirm equal to the id. Irreversible — requires " +
    "confirm to exactly match id.",
  {
    id: z.string().describe("Page id"),
    confirm: z.string().min(1).describe("Must exactly equal id to confirm the delete"),
  },
  async ({ id, confirm }) => {
    try {
      if (confirm !== id) {
        throw new ToolError(`confirm must exactly match id ("${id}") to delete a page`);
      }
      const page = await apiCall("GET", `/pages/${id}`);
      await apiCall("DELETE", `/pages/${id}`);
      return textResult(`Deleted "${page.title}" (${page.url}).`);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "oauth_list_clients",
  "List registered sherlock OAuth clients (id, name, redirect URIs, type). Requires a platform-admin shb_ key.",
  {},
  async () => {
    try {
      const result = await platformApiCall("GET", "/oauth-clients");
      const clients = result.clients ?? [];
      if (clients.length === 0) {
        return textResult("No OAuth clients found.");
      }
      const lines = clients.map(
        (c) => `- ${c.name} — client_id: ${c.client_id}, type: ${c.client_type}, redirect_uris: ${c.redirect_uris.join(", ")}`,
      );
      return textResult(`${clients.length} OAuth client(s):\n${lines.join("\n")}`);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "oauth_create_client",
  "Register a new sherlock OAuth client. Requires a platform-admin shb_ key. The response includes a client_secret " +
    "shown only this once — sherlock never stores or returns it again, so save it now.",
  {
    name: z.string().min(1).max(60).describe("Client display name"),
    redirect_uris: z.array(z.string()).min(1).describe("Allowed redirect URIs (https, or http on localhost)"),
    client_type: z
      .enum(["confidential", "public"])
      .optional()
      .describe("Client type; defaults to confidential (issues a client_secret)"),
  },
  async ({ name, redirect_uris, client_type }) => {
    try {
      const body = { name, redirect_uris, client_type: client_type ?? "confidential" };
      const result = await platformApiCall("POST", "/oauth-clients", body);
      const client = result.client;
      const secretLine =
        client.client_secret !== undefined
          ? `\nclient_secret: ${client.client_secret}\nThis secret is shown once and cannot be retrieved again — save it now.`
          : "";
      return textResult(
        `Created "${client.name}" — client_id: ${client.client_id}, type: ${client.client_type}, ` +
          `redirect_uris: ${client.redirect_uris.join(", ")}${secretLine}`,
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "key_create_app",
  "Mint a new scoped APP api key, typically for a sub-agent. Requires a master shb_ key. The response " +
    "includes the plaintext key shown only this once — sherlock never stores or returns it again, so copy " +
    "it now and hand it to the sub-agent; a lost key must be revoked (key_revoke) and re-minted.",
  {
    name: z.string().min(1).max(60).describe("Key display name"),
    apps: z
      .array(z.enum(["page", "serve", "link", "base"]))
      .min(1)
      .describe("Scopes to grant: a non-empty subset of page, serve, link, base"),
  },
  async ({ name, apps }) => {
    try {
      const result = await platformApiCall("POST", "/keys", { name, apps });
      return textResult(
        `Created APP key "${result.name}" — tier: ${result.tier}, apps: ${result.apps.join(", ")}, ` +
          `prefix: ${result.keyPrefix}\nkey: ${result.key}\n` +
          `This key is shown once and cannot be retrieved again — copy it now and hand it to the sub-agent.`,
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "key_list",
  "List every api key on your account: id, name, prefix, tier, apps, created-by lineage, and " +
    "created/last-used/revoked timestamps. Never includes hashes or plaintext keys. Requires a master shb_ key.",
  {},
  async () => {
    try {
      const result = await platformApiCall("GET", "/keys");
      const keys = result.keys ?? [];
      return textResult(JSON.stringify(keys, null, 2));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "key_revoke",
  "Permanently revoke an api key by id. Requires a master shb_ key. A master key can revoke any other key " +
    "on the account, including other master keys — full account authority — except the key currently " +
    "authenticating this call. Irreversible — requires confirm to exactly match keyId.",
  {
    keyId: z.string().min(1).describe("Key id to revoke"),
    confirm: z.string().min(1).describe("Must exactly equal keyId to confirm the revoke"),
  },
  async ({ keyId, confirm }) => {
    try {
      if (confirm !== keyId) {
        throw new ToolError(`confirm must exactly match keyId ("${keyId}") to revoke a key`);
      }
      const result = await platformApiRequest("DELETE", `/keys/${encodeURIComponent(keyId)}`);
      if (!result.ok) {
        const errorField =
          result.data && typeof result.data === "object" && "error" in result.data
            ? result.data.error
            : JSON.stringify(result.data);
        if (result.status === 400 && errorField === "cannot_revoke_current_key") {
          throw new ToolError(
            "cannot revoke this key: it is the key this agent is currently using to authenticate. " +
              "Revoke it from another agent or the dashboard instead.",
          );
        }
        throw new ToolError(`platform API error ${result.status}: ${errorField}`);
      }
      return textResult(`Revoked key ${keyId}.`);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "base_list_projects",
  "List your sherbase Postgres projects (slug, database name, created date).",
  {},
  async () => {
    try {
      const result = await sherbaseApiCall("GET", "/projects");
      const projects = result.projects ?? [];
      return textResult(JSON.stringify(projects, null, 2));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "base_create_project",
  "Provision a new sherbase Postgres project (a dedicated database and role). The response includes a " +
    "password and connection string shown only this once — sherbase never stores or returns them again, " +
    "so save them now.",
  {
    slug: z.string().min(1).describe("URL-safe project slug; used to name the database and role"),
  },
  async ({ slug }) => {
    try {
      const result = await sherbaseApiCall("POST", "/projects", { slug });
      const project = result.project;
      return textResult(
        `Created project "${project.slug}" — database: ${project.dbName}, role: ${project.roleName}\n` +
          `password: ${project.password}\n` +
          `connection string: ${project.connection.pooler}\n` +
          `This password and connection string are shown once and cannot be retrieved again — save them now.`,
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "base_run_sql",
  "Run a single SQL statement against a sherbase project's database, as that project's own role. Returns " +
    "rows, row count, and field names as JSON.",
  {
    slug: z.string().min(1).describe("Project slug"),
    sql: z.string().min(1).describe("A single SQL statement to execute"),
  },
  async ({ slug, sql }) => {
    try {
      const result = await sherbaseApiCall("POST", `/projects/${encodeURIComponent(slug)}/query`, { sql });
      const { rows, rowCount, fields } = result;
      return textResult(JSON.stringify({ rows, rowCount, fields }, null, 2));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "base_drop_project",
  "Permanently drop a sherbase project: deletes its database, role, and registry row. Irreversible — " +
    "requires confirm to exactly match slug.",
  {
    slug: z.string().min(1).describe("Project slug to drop"),
    confirm: z.string().min(1).describe("Must exactly equal slug to confirm the drop"),
  },
  async ({ slug, confirm }) => {
    try {
      if (confirm !== slug) {
        throw new ToolError(`confirm must exactly match slug ("${slug}") to drop a project`);
      }
      await sherbaseApiCall("DELETE", `/projects/${encodeURIComponent(slug)}`, { confirm });
      return textResult(`Dropped project "${slug}".`);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "store_upload_file",
  "Upload a local file to sherserve as a new object. Returns the f. URL.",
  {
    path: z.string().min(1).describe("Local filesystem path to the file to upload"),
    slug: z.string().optional().describe("Optional URL slug; derived from the title if omitted or invalid"),
    title: z.string().optional().describe("Object title; defaults to the uploaded filename"),
    access: accessSchema.optional().describe("Access level; defaults to private"),
    password: z.string().optional().describe("Password required to view the object; required when access is 'password'"),
    expiresAt: z.string().optional().describe("ISO 8601 timestamp after which the object stops serving"),
    maxViews: z.number().int().positive().optional().describe("Maximum number of views before the object stops serving"),
    allow: z
      .array(z.string())
      .optional()
      .describe("Allow-list entries for access 'allow_list': emails or @handles"),
  },
  async ({ path, slug, title, access, password, expiresAt, maxViews, allow }) => {
    try {
      let bytes;
      try {
        bytes = await readFile(path);
      } catch (err) {
        throw new ToolError(`could not read file at "${path}": ${err instanceof Error ? err.message : String(err)}`);
      }
      const form = new FormData();
      form.append("file", new Blob([bytes]), basename(path));
      if (slug !== undefined) form.append("slug", slug);
      if (title !== undefined) form.append("title", title);
      if (access !== undefined) form.append("access", access);
      if (password !== undefined) form.append("password", password);
      if (expiresAt !== undefined) form.append("expiresAt", expiresAt);
      if (maxViews !== undefined) form.append("maxViews", String(maxViews));
      if (allow !== undefined) for (const entry of allow) form.append("allow", entry);

      const result = await sherserveApiCall("POST", "/objects", form);
      const object = result.object;
      const passwordNote = access === "password" || password !== undefined ? ", password: set" : "";
      return textResult(
        `Uploaded "${object.title}" to ${result.url}\n` +
          `id: ${object.id}, slug: ${object.slug}, access: ${object.access}${passwordNote}, ` +
          `size: ${object.sizeBytes} bytes`,
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "store_list_objects",
  "List your sherserve objects (active status). Returns each object's f. URL.",
  {},
  async () => {
    try {
      const result = await sherserveApiCall("GET", "/objects");
      const objects = result.objects ?? [];
      return textResult(JSON.stringify(objects, null, 2));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "store_get_object",
  "Get details for one sherserve object by slug or id. Returns the object's f. URL.",
  {
    slug: z.string().optional().describe("Object slug (either slug or id is required)"),
    id: z.string().optional().describe("Object id (either slug or id is required)"),
  },
  async ({ slug, id }) => {
    try {
      const input = id ?? slug;
      if (!input) throw new ToolError("either slug or id is required");
      const objectId = await resolveObjectId(input);
      const object = await sherserveApiCall("GET", `/objects/${objectId}`);
      return textResult(JSON.stringify(object, null, 2));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "store_delete_object",
  "Permanently delete a sherserve object and its file. Irreversible — requires confirm to exactly " +
    "match the slug or id passed in.",
  {
    slug: z.string().optional().describe("Object slug (either slug or id is required)"),
    id: z.string().optional().describe("Object id (either slug or id is required)"),
    confirm: z.string().min(1).describe("Must exactly equal the slug or id passed in to confirm the delete"),
  },
  async ({ slug, id, confirm }) => {
    try {
      const input = id ?? slug;
      if (!input) throw new ToolError("either slug or id is required");
      if (confirm !== input) {
        throw new ToolError(`confirm must exactly match ${id !== undefined ? "id" : "slug"} ("${input}") to delete an object`);
      }
      const objectId = await resolveObjectId(input);
      await sherserveApiCall("DELETE", `/objects/${objectId}`);
      return textResult(`Deleted object "${input}".`);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "link_list",
  "List your sherlink short links across all apps (sherpage pages and sherserve files). Returns each " +
    "link's short URL, wrapped resource, access, and status as JSON.",
  {},
  async () => {
    try {
      const result = await sherlinkApiCall("GET", "/links");
      const links = result.links ?? [];
      return textResult(JSON.stringify(links, null, 2));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "link_get",
  "Get details for one sherlink short link by its code, custom alias, or id. Returns the link as JSON.",
  {
    code_or_id: z.string().min(1).describe("Link code, custom alias, or id"),
  },
  async ({ code_or_id }) => {
    try {
      const id = await resolveLinkId(code_or_id);
      const link = await sherlinkApiCall("GET", `/links/${id}`);
      return textResult(JSON.stringify(link, null, 2));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "link_set_access",
  "Change a sherlink short link's access level, password, expiry, or view budget. Returns the updated " +
    "link as JSON.",
  {
    code_or_id: z.string().min(1).describe("Link code, custom alias, or id"),
    access: accessSchema.optional().describe("New access level"),
    password: z
      .string()
      .nullable()
      .optional()
      .describe("Password to set when access is 'password'; pass null to clear a previously-set password"),
    expires_at: z.string().nullable().optional().describe("New ISO 8601 expiry timestamp, or null to clear it"),
    max_views: z.number().int().positive().nullable().optional().describe("New max-views budget, or null to clear it"),
  },
  async ({ code_or_id, access, password, expires_at, max_views }) => {
    try {
      const id = await resolveLinkId(code_or_id);
      const body = {
        ...(access !== undefined ? { access } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(expires_at !== undefined ? { expiresAt: expires_at } : {}),
        ...(max_views !== undefined ? { maxViews: max_views } : {}),
      };
      const link = await sherlinkApiCall("PATCH", `/links/${id}`, body);
      return textResult(JSON.stringify(link, null, 2));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "link_set_alias",
  "Set or clear a sherlink short link's custom alias (the sl.shebang.pro/<alias> vanity path). Returns " +
    "the updated link as JSON.",
  {
    code_or_id: z.string().min(1).describe("Link code, custom alias, or id"),
    alias: z.string().nullable().describe("New custom alias, or null to clear it"),
  },
  async ({ code_or_id, alias }) => {
    try {
      const id = await resolveLinkId(code_or_id);
      const link = await sherlinkApiCall("PATCH", `/links/${id}`, { alias });
      return textResult(JSON.stringify(link, null, 2));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "link_delete",
  "Permanently deletes the page/file and its link — not just the short URL. Deleting a sherlink link " +
    "cascades to the underlying sherpage page or sherserve object and its storage, which are removed along " +
    "with the link. This cannot be undone. Irreversible — requires confirm to exactly match the code, " +
    "alias, or id passed in.",
  {
    code_or_id: z.string().min(1).describe("Link code, custom alias, or id"),
    confirm: z.string().min(1).describe("Must exactly equal code_or_id to confirm the delete"),
  },
  async ({ code_or_id, confirm }) => {
    try {
      if (confirm !== code_or_id) {
        throw new ToolError(`confirm must exactly match code_or_id ("${code_or_id}") to delete a link`);
      }
      const id = await resolveLinkId(code_or_id);
      await sherlinkApiCall("DELETE", `/links/${id}`);
      return textResult(`Deleted link "${code_or_id}" and its underlying page/file — this cannot be undone.`);
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
