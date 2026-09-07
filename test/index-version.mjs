// Group C(4): src/index.js (the stdio entry point) must report the same
// version package.json carries, not a separately hardcoded literal that
// can drift on a version bump. This is the one place in the repo that
// can only be verified by actually spawning the process -- index.js
// calls `await server.connect(new StdioServerTransport())`, which blocks
// on real stdio, so there is no way to import and unit-test its module
// body directly the way tools.js's registerTools is tested in smoke.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const { version: PACKAGE_VERSION } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

test("src/index.js reports package.json's version as its MCP serverInfo.version", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(REPO_ROOT, "src", "index.js")],
    env: {
      ...process.env,
      // index.js exits immediately without an API key -- a fake shb_ key
      // is enough to reach `await server.connect(transport)`; no tool is
      // ever called, so no network request is ever made.
      SHEBANG_API_KEY: "shb_test-fake-key",
    },
  });
  const client = new Client({ name: "index-version-test-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const serverVersion = client.getServerVersion();
    assert.equal(serverVersion?.name, "shebang");
    assert.equal(serverVersion?.version, PACKAGE_VERSION);
  } finally {
    await client.close();
  }
});
