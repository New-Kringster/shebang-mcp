// Smoke test for tools.js's registerTools(server, apiClient): builds a
// real McpServer + Client pair over an in-memory transport, registers
// tools against a real apiClient (api-client.js) whose only stubbed part
// is global fetch, and drives calls through the MCP protocol exactly as a
// real client would (tools/call over JSON-RPC), rather than reaching into
// tool handlers directly. This exercises both module boundaries at once:
// tools.js's dispatch (name -> schema -> handler) and api-client.js's
// request building (method, path, and — since apiKey is baked into the
// apiClient at construction, not passed per call — the Authorization
// header actually reaching fetch).
import assert from "node:assert/strict";
import { test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApiClient } from "../src/api-client.js";
import { registerTools } from "../src/tools.js";

const API_KEY = "test-key-123";
const BASE_URL = "http://test.local";

/**
 * Builds a fresh McpServer + Client pair, wired to registerTools and a
 * real apiClient backed by a recording, stubbed global fetch. `responses`
 * maps a "METHOD path" key (path relative to the service base, e.g.
 * "GET /projects") to the JSON body fetch should return for that call;
 * any request not present in the map is answered with a 500 so an
 * unexpected call fails loudly instead of silently returning undefined.
 * @param {Record<string, unknown>} [responses]
 * @param {{ localFilesystem?: boolean, statuses?: Record<string, number> }} [options] `localFilesystem`
 *   passed straight through to registerTools -- lets a caller build a
 *   hosted-mode (localFilesystem: false) server/client pair the same way
 *   the dash /api/mcp route does. `statuses` (Stage 20, Task 8) maps the
 *   same "METHOD path" key `responses` uses to a non-200 status code --
 *   needed to exercise base_reload_schema's 409 handling, since every
 *   stub before this task only ever needed to return 200.
 */
async function setup(responses = {}, options = {}) {
  const { statuses = {}, ...registerOptions } = options;
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    calls.push({
      method: init?.method,
      path: parsed.pathname,
      headers: init?.headers ?? {},
      body: init?.body,
    });
    const key = `${init?.method} ${parsed.pathname}`;
    if (!(key in responses)) {
      return new Response(JSON.stringify({ error: `unstubbed request: ${key}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(responses[key]), {
      status: statuses[key] ?? 200,
      headers: { "content-type": "application/json" },
    });
  };

  const apiClient = createApiClient({ apiKey: API_KEY, baseUrl: BASE_URL });
  const server = new McpServer({ name: "shebang-test", version: "0.0.0" });
  registerTools(server, apiClient, registerOptions);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "smoke-test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return {
    client,
    calls,
    async teardown() {
      await client.close();
      await server.close();
      globalThis.fetch = originalFetch;
    },
  };
}

/** Asserts the single recorded call matches the expected service path and
 * that the apiKey configured on this apiClient reached fetch as a bearer
 * Authorization header — the header the tool itself never builds; only
 * api-client.js does, from the apiKey closed over at construction. */
function assertSingleCall(calls, method, path) {
  assert.equal(calls.length, 1, `expected exactly one HTTP call, got ${calls.length}`);
  assert.equal(calls[0].method, method);
  assert.equal(calls[0].path, path);
  assert.equal(calls[0].headers.authorization, `Bearer ${API_KEY}`);
}

test("sherpage_list — GET /api/sherpage/v1/pages, auth header pass-through", async () => {
  const { client, calls, teardown } = await setup({ "GET /api/sherpage/v1/pages": { pages: [] } });
  try {
    const result = await client.callTool({ name: "sherpage_list", arguments: {} });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "GET", "/api/sherpage/v1/pages");
  } finally {
    await teardown();
  }
});

test("store_list_objects — GET /api/sherserve/v1/objects, auth header pass-through", async () => {
  const { client, calls, teardown } = await setup({ "GET /api/sherserve/v1/objects": { objects: [] } });
  try {
    const result = await client.callTool({ name: "store_list_objects", arguments: {} });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "GET", "/api/sherserve/v1/objects");
  } finally {
    await teardown();
  }
});

test("link_list — GET /api/sherlink/v1/links, auth header pass-through", async () => {
  const { client, calls, teardown } = await setup({ "GET /api/sherlink/v1/links": { links: [] } });
  try {
    const result = await client.callTool({ name: "link_list", arguments: {} });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "GET", "/api/sherlink/v1/links");
  } finally {
    await teardown();
  }
});

test("base_list_databases — GET /api/sherbase/v1/databases, auth header pass-through", async () => {
  const { client, calls, teardown } = await setup({ "GET /api/sherbase/v1/databases": { databases: [] } });
  try {
    const result = await client.callTool({ name: "base_list_databases", arguments: {} });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "GET", "/api/sherbase/v1/databases");
  } finally {
    await teardown();
  }
});

test("project_list — GET /api/platform/v1/projects, auth header pass-through", async () => {
  const { client, calls, teardown } = await setup({ "GET /api/platform/v1/projects": { projects: [] } });
  try {
    const result = await client.callTool({ name: "project_list", arguments: {} });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "GET", "/api/platform/v1/projects");
  } finally {
    await teardown();
  }
});

test("key_list — GET /api/platform/v1/keys, auth header pass-through", async () => {
  const { client, calls, teardown } = await setup({ "GET /api/platform/v1/keys": { keys: [] } });
  try {
    const result = await client.callTool({ name: "key_list", arguments: {} });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "GET", "/api/platform/v1/keys");
  } finally {
    await teardown();
  }
});

test("email_send — POST /api/platform/v1/email, auth header pass-through, stubbed response", async () => {
  const { client, calls, teardown } = await setup({
    "POST /api/platform/v1/email": { resend_id: "re_stub_1", remaining_today: 9 },
  });
  try {
    const result = await client.callTool({
      name: "email_send",
      arguments: { to: "a@example.com", subject: "hi", text: "hello" },
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /resend_id: re_stub_1/);
    assertSingleCall(calls, "POST", "/api/platform/v1/email");
  } finally {
    await teardown();
  }
});

// 0.5.0 (Stage 21, Task 4): the Stage 17/19 one-release aliases (app_*,
// base_*_project, key_create_app's app_id, base_run_sql's slug) are gone
// outright, not redirected/delegated — app_list is now simply an unknown
// tool to the server, exactly like any name that was never registered.
test("app_list — removed in 0.5.0, now an unknown tool", async () => {
  const { client, teardown } = await setup();
  try {
    const result = await client.callTool({ name: "app_list", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not found/i);
  } finally {
    await teardown();
  }
});

test("registerTools defaults to localFilesystem: true — store_upload_file present, store_upload_content absent, stdio's 39 tools (0.5.0, after Stage 21 Task 4 dropped the 11 app_*/base_*_project aliases)", async () => {
  const { client, teardown } = await setup();
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 39);
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("store_upload_file"), "store_upload_file must remain registered for the stdio server");
    assert.ok(!names.includes("store_upload_content"), "store_upload_content is hosted-only, must not appear by default");
  } finally {
    await teardown();
  }
});

test("registerTools({ localFilesystem: false }) — store_upload_file absent, store_upload_content present, still 39 tools total", async () => {
  const { client, teardown } = await setup({}, { localFilesystem: false });
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 39);
    const names = tools.map((t) => t.name);
    assert.ok(!names.includes("store_upload_file"), "store_upload_file must never be reachable in hosted mode (no disk access)");
    assert.ok(names.includes("store_upload_content"));
  } finally {
    await teardown();
  }
});

test("store_upload_content — POST /api/sherserve/v1/objects with inline base64 bytes, no filesystem access", async () => {
  const { client, calls, teardown } = await setup(
    {
      "POST /api/sherserve/v1/objects": {
        object: { id: "o1", title: "upload", slug: "up1", access: "private", sizeBytes: 5 },
        url: "https://f.shebang.pro/up1",
      },
    },
    { localFilesystem: false },
  );
  try {
    const result = await client.callTool({
      name: "store_upload_content",
      arguments: { slug: "up1", contentBase64: Buffer.from("hello").toString("base64"), contentType: "text/plain" },
    });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "POST", "/api/sherserve/v1/objects");
  } finally {
    await teardown();
  }
});

test("store_upload_content — text content is accepted in place of contentBase64", async () => {
  const { client, calls, teardown } = await setup(
    {
      "POST /api/sherserve/v1/objects": {
        object: { id: "o2", title: "upload", slug: "up2", access: "private", sizeBytes: 5 },
        url: "https://f.shebang.pro/up2",
      },
    },
    { localFilesystem: false },
  );
  try {
    const result = await client.callTool({
      name: "store_upload_content",
      arguments: { slug: "up2", text: "hello", contentType: "text/plain" },
    });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "POST", "/api/sherserve/v1/objects");
  } finally {
    await teardown();
  }
});

// dogfood fix (REPORT.md #3): project_create/project_set's `color` is now
// a zod enum of the platform's curated palette, and api-client.js
// surfaces a 4xx body's `message` alongside `error` so a server-side
// rejection (e.g. some other invalid field this schema doesn't already
// catch) is never a bare, undetailed error code.

test("project_create — a curated-palette color is accepted and sent through as-is", async () => {
  const { client, calls, teardown } = await setup({
    "POST /api/platform/v1/projects": {
      project: { id: "p1", name: "Postcard", tag: "postcard", color: "#3b82f6", slug: "postcard" },
    },
  });
  try {
    const result = await client.callTool({
      name: "project_create",
      arguments: { name: "Postcard", tag: "postcard", color: "#3b82f6", slug: "postcard" },
    });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "POST", "/api/platform/v1/projects");
    assert.deepEqual(JSON.parse(calls[0].body), { name: "Postcard", tag: "postcard", color: "#3b82f6", slug: "postcard" });
  } finally {
    await teardown();
  }
});

test("project_create — a hex color outside the curated palette is rejected client-side, before any HTTP call", async () => {
  const { client, calls, teardown } = await setup({});
  try {
    const result = await client.callTool({
      name: "project_create",
      arguments: { name: "Postcard", tag: "postcard", color: "#e0754a", slug: "postcard" },
    });
    assert.equal(result.isError, true);
    assert.equal(calls.length, 0, "an out-of-palette color must reject before any HTTP call");
  } finally {
    await teardown();
  }
});

test("project_set — a 400 with both error and message surfaces the detail, not a bare error code (api-client.js merge fix)", async () => {
  const { client, calls, teardown } = await setup(
    { "PATCH /api/platform/v1/projects/p1": { error: "invalid_project", message: "slug 'postcard' is already in use" } },
    { statuses: { "PATCH /api/platform/v1/projects/p1": 400 } },
  );
  try {
    const result = await client.callTool({
      name: "project_set",
      arguments: { id: "p1", slug: "postcard" },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /invalid_project/);
    assert.match(result.content[0].text, /slug 'postcard' is already in use/);
    assertSingleCall(calls, "PATCH", "/api/platform/v1/projects/p1");
  } finally {
    await teardown();
  }
});

// dogfood fix (REPORT.md #2): store_upload_content infers a filename
// extension from contentType when `path`/`slug` don't supply one, and
// fails client-side (no HTTP call) when neither does.

test("store_upload_content — no path, an extensionless slug: the extension is inferred from contentType", async () => {
  const { client, calls, teardown } = await setup(
    {
      "POST /api/sherserve/v1/objects": {
        object: { id: "o3", title: "upload", slug: "postcard-abc123-image", access: "private", sizeBytes: 3 },
        url: "https://f.shebang.pro/postcard-abc123-image",
      },
    },
    { localFilesystem: false },
  );
  try {
    const result = await client.callTool({
      name: "store_upload_content",
      arguments: { slug: "postcard-abc123-image", contentBase64: Buffer.from("abc").toString("base64"), contentType: "image/png" },
    });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "POST", "/api/sherserve/v1/objects");
    const file = calls[0].body.get("file");
    assert.equal(file.name, "postcard-abc123-image.png");
  } finally {
    await teardown();
  }
});

test("store_upload_content — path already has an extension: used as-is, never overridden by contentType", async () => {
  const { client, calls, teardown } = await setup(
    {
      "POST /api/sherserve/v1/objects": {
        object: { id: "o4", title: "upload", slug: "up4", access: "private", sizeBytes: 3 },
        url: "https://f.shebang.pro/up4",
      },
    },
    { localFilesystem: false },
  );
  try {
    const result = await client.callTool({
      name: "store_upload_content",
      arguments: {
        slug: "up4",
        path: "custom-name.jpg",
        contentBase64: Buffer.from("abc").toString("base64"),
        contentType: "image/png",
      },
    });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "POST", "/api/sherserve/v1/objects");
    const file = calls[0].body.get("file");
    assert.equal(file.name, "custom-name.jpg");
  } finally {
    await teardown();
  }
});

test("store_upload_content — no extension anywhere and an unrecognized contentType fails client-side, before any HTTP call", async () => {
  const { client, calls, teardown } = await setup({}, { localFilesystem: false });
  try {
    const result = await client.callTool({
      name: "store_upload_content",
      arguments: {
        slug: "mystery-object",
        contentBase64: Buffer.from("abc").toString("base64"),
        contentType: "application/x-custom-blob",
      },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /path "mystery-object" has no file extension/);
    assert.match(result.content[0].text, /application\/x-custom-blob/);
    assert.equal(calls.length, 0, "an unresolvable extension must reject before any HTTP call");
  } finally {
    await teardown();
  }
});

test("sherpage_delete — confirm-guard rejection never calls the client", async () => {
  const { client, calls, teardown } = await setup({});
  try {
    const result = await client.callTool({
      name: "sherpage_delete",
      arguments: { id: "page-abc", confirm: "wrong-value" },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /confirm must exactly match id/);
    assert.equal(calls.length, 0, "confirm mismatch must reject before any HTTP call");
  } finally {
    await teardown();
  }
});

// Stage 20 (Task 8): Data API fields on base_create_database, and the
// three new tools -- base_rotate_secret, base_enable_api,
// base_reload_schema.

test("base_create_database — POST /api/sherbase/v1/databases, prints the new Data API fields and the secret once", async () => {
  const { client, calls, teardown } = await setup({
    "POST /api/sherbase/v1/databases": {
      project: {
        slug: "myapp",
        dbName: "base_myapp",
        roleName: "base_myapp",
        password: "pw123",
        connection: { pooler: "postgres://base_myapp:pw123@host:6432/base_myapp" },
        api_url: "https://api.shebang.pro/db/myapp",
        publishable_key: "sb_publishable_myapp_abc",
        api_enabled: true,
        secret_key: "sb_secret_myapp_xyz",
      },
    },
  });
  try {
    const result = await client.callTool({ name: "base_create_database", arguments: { slug: "myapp" } });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "POST", "/api/sherbase/v1/databases");
    assert.deepEqual(JSON.parse(calls[0].body), { slug: "myapp" });
    const text = result.content[0].text;
    assert.match(text, /Data API: https:\/\/api\.shebang\.pro\/db\/myapp/);
    assert.match(text, /publishable key: sb_publishable_myapp_abc/);
    assert.match(text, /secret key: sb_secret_myapp_xyz/);
    assert.match(text, /password and secret key are.*shown once/s);
  } finally {
    await teardown();
  }
});

test("base_rotate_secret — POST .../secret with a confirm body, prints the new secret once", async () => {
  const { client, calls, teardown } = await setup({
    "POST /api/sherbase/v1/databases/myapp/secret": { secret_key: "sb_secret_myapp_new" },
  });
  try {
    const result = await client.callTool({
      name: "base_rotate_secret",
      arguments: { database: "myapp", confirm: "myapp" },
    });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "POST", "/api/sherbase/v1/databases/myapp/secret");
    assert.deepEqual(JSON.parse(calls[0].body), { confirm: "myapp" });
    assert.match(result.content[0].text, /New secret key: sb_secret_myapp_new/);
    assert.match(result.content[0].text, /old secret key stops working immediately/);
  } finally {
    await teardown();
  }
});

test("base_rotate_secret — confirm-guard rejection never calls the client", async () => {
  const { client, calls, teardown } = await setup({});
  try {
    const result = await client.callTool({
      name: "base_rotate_secret",
      arguments: { database: "myapp", confirm: "wrong-value" },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /confirm must exactly match database/);
    assert.equal(calls.length, 0, "confirm mismatch must reject before any HTTP call");
  } finally {
    await teardown();
  }
});

test("base_enable_api — POST .../enable, prints api_url/publishable_key and the secret once when newly created", async () => {
  const { client, calls, teardown } = await setup({
    "POST /api/sherbase/v1/databases/myapp/enable": {
      slug: "myapp",
      api_url: "https://api.shebang.pro/db/myapp",
      publishable_key: "sb_publishable_myapp_abc",
      api_enabled: true,
      secret_key: "sb_secret_myapp_xyz",
    },
  });
  try {
    const result = await client.callTool({ name: "base_enable_api", arguments: { database: "myapp" } });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "POST", "/api/sherbase/v1/databases/myapp/enable");
    const text = result.content[0].text;
    assert.match(text, /Enabled the Data API for "myapp"/);
    assert.match(text, /Data API: https:\/\/api\.shebang\.pro\/db\/myapp/);
    assert.match(text, /publishable key: sb_publishable_myapp_abc/);
    assert.match(text, /secret key: sb_secret_myapp_xyz/);
  } finally {
    await teardown();
  }
});

test("base_enable_api — idempotent re-run omits secret_key from the message when the API already returns none", async () => {
  const { client, teardown } = await setup({
    "POST /api/sherbase/v1/databases/myapp/enable": {
      slug: "myapp",
      api_url: "https://api.shebang.pro/db/myapp",
      publishable_key: "sb_publishable_myapp_abc",
      api_enabled: true,
    },
  });
  try {
    const result = await client.callTool({ name: "base_enable_api", arguments: { database: "myapp" } });
    assert.equal(result.isError, undefined);
    assert.doesNotMatch(result.content[0].text, /secret key:/);
  } finally {
    await teardown();
  }
});

test("base_reload_schema — POST .../reload", async () => {
  const { client, calls, teardown } = await setup({
    "POST /api/sherbase/v1/databases/myapp/reload": { ok: true },
  });
  try {
    const result = await client.callTool({ name: "base_reload_schema", arguments: { database: "myapp" } });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "POST", "/api/sherbase/v1/databases/myapp/reload");
    assert.match(result.content[0].text, /Reloaded the Data API schema cache for "myapp"/);
  } finally {
    await teardown();
  }
});

test("base_reload_schema — a 409 from the route (Data API not enabled) maps to a clear enable-first message", async () => {
  const { client, calls, teardown } = await setup(
    { "POST /api/sherbase/v1/databases/myapp/reload": { error: "data_api_disabled" } },
    { statuses: { "POST /api/sherbase/v1/databases/myapp/reload": 409 } },
  );
  try {
    const result = await client.callTool({ name: "base_reload_schema", arguments: { database: "myapp" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Enable the Data API first/);
    assertSingleCall(calls, "POST", "/api/sherbase/v1/databases/myapp/reload");
  } finally {
    await teardown();
  }
});
