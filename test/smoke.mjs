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
 * @param {{ localFilesystem?: boolean }} [options] passed straight through
 *   to registerTools -- lets a caller build a hosted-mode (localFilesystem:
 *   false) server/client pair the same way the dash /api/mcp route does.
 */
async function setup(responses = {}, options = {}) {
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
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const apiClient = createApiClient({ apiKey: API_KEY, baseUrl: BASE_URL });
  const server = new McpServer({ name: "shebang-test", version: "0.0.0" });
  registerTools(server, apiClient, options);

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
  const { client, calls, teardown } = await setup({ "GET /api/sherbase/v1/databases": { projects: [] } });
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

test("app_list — hidden alias for project_list, reaches the same handler", async () => {
  const { client, calls, teardown } = await setup({ "GET /api/platform/v1/projects": { projects: [] } });
  try {
    const result = await client.callTool({ name: "app_list", arguments: {} });
    assert.equal(result.isError, undefined);
    assertSingleCall(calls, "GET", "/api/platform/v1/projects");
  } finally {
    await teardown();
  }
});

test("registerTools defaults to localFilesystem: true — store_upload_file present, store_upload_content absent, stdio's 47 tools unchanged", async () => {
  const { client, teardown } = await setup();
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 47);
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("store_upload_file"), "store_upload_file must remain registered for the stdio server");
    assert.ok(!names.includes("store_upload_content"), "store_upload_content is hosted-only, must not appear by default");
  } finally {
    await teardown();
  }
});

test("registerTools({ localFilesystem: false }) — store_upload_file absent, store_upload_content present, still 47 tools total", async () => {
  const { client, teardown } = await setup({}, { localFilesystem: false });
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 47);
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
