// `shebang-mcp login` drives the RFC 8628 device flow (Stage 21 Task 3):
// POST device_authorization, then poll POST token honouring `interval`
// and `slow_down`. This spins up a real HTTP stub server (node:http, no
// mocking of fetch/postJson) and spawns the real cli.js as a child
// process with $HOME redirected to a scratch directory, so the whole
// login command runs exactly as a user would invoke it -- only the
// dash server underneath is faked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "src", "cli.js");

/** A tiny stub of the two device-flow endpoints. `handlers.deviceAuthorization`
 *  and `handlers.token` are called with the parsed JSON request body and
 *  must return `{status, body}`; `token` is called once per poll, so a
 *  handler that closes over a counter can script a pending -> slow_down ->
 *  approved sequence. */
function startServer(handlers) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      // malformed bodies aren't exercised by these tests
    }

    const handler =
      req.method === "POST" && req.url === "/api/agent-login/device_authorization"
        ? handlers.deviceAuthorization
        : req.method === "POST" && req.url === "/api/agent-login/token"
          ? handlers.token
          : null;

    if (!handler) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const { status, body: responseBody } = handler(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(responseBody));
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function deviceAuthorizationSuccess(userCode) {
  return () => ({
    status: 200,
    body: {
      device_code: `dc-${userCode}`,
      user_code: userCode,
      verification_uri: "http://stub.local/authorize-agent",
      verification_uri_complete: `http://stub.local/authorize-agent?user_code=${userCode}`,
      expires_in: 600,
      // Kept tiny (50ms) so these tests don't wait on a realistic 3s
      // cadence -- cli.js honours whatever the server sends, so this is
      // exercising the same code path a real 3s interval would.
      interval: 0.05,
    },
  });
}

function runCli(baseUrl, homeDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, "login", "--base-url", baseUrl], {
      env: { ...process.env, HOME: homeDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function scratchHome() {
  return mkdtempSync(join(tmpdir(), "shebang-cli-login-test-"));
}

test("login: pending -> slow_down -> approved delivers the key and writes credentials once", async () => {
  let pollCount = 0;
  const server = await startServer({
    deviceAuthorization: deviceAuthorizationSuccess("abcd2345"),
    token: () => {
      pollCount += 1;
      if (pollCount === 1) return { status: 400, body: { error: "authorization_pending" } };
      if (pollCount === 2) return { status: 400, body: { error: "slow_down", interval: 0.05 } };
      return {
        status: 200,
        body: { access_token: "shb_testtoken1234567890", token_type: "shb", scope: "master", expires_in: null },
      };
    },
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const homeDir = scratchHome();

  try {
    const { code, stdout } = await runCli(baseUrl, homeDir);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /Logged in\. Key: shb_testtok/);
    assert.ok(pollCount >= 3, `expected at least 3 polls (pending, slow_down, approved), got ${pollCount}`);

    const credsPath = join(homeDir, ".config", "shebang", "credentials.json");
    assert.ok(existsSync(credsPath));
    const creds = JSON.parse(readFileSync(credsPath, "utf8"));
    assert.equal(creds.api_key, "shb_testtoken1234567890");
    assert.equal(creds.base_url, baseUrl);
  } finally {
    server.close();
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("login: access_denied exits 1 and never writes credentials", async () => {
  const server = await startServer({
    deviceAuthorization: deviceAuthorizationSuccess("efgh2345"),
    token: () => ({ status: 400, body: { error: "access_denied" } }),
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const homeDir = scratchHome();

  try {
    const { code, stderr } = await runCli(baseUrl, homeDir);
    assert.equal(code, 1);
    assert.match(stderr, /denied/i);
    assert.equal(existsSync(join(homeDir, ".config", "shebang", "credentials.json")), false);
  } finally {
    server.close();
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("login: expired_token exits 1 with the expired/reused message", async () => {
  const server = await startServer({
    deviceAuthorization: deviceAuthorizationSuccess("ijkl2345"),
    token: () => ({ status: 400, body: { error: "expired_token" } }),
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const homeDir = scratchHome();

  try {
    const { code, stderr } = await runCli(baseUrl, homeDir);
    assert.equal(code, 1);
    assert.match(stderr, /expired or was already used/i);
  } finally {
    server.close();
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("login: invalid_grant (unknown/claimed device_code) exits 1 with the same expired/reused message", async () => {
  const server = await startServer({
    deviceAuthorization: deviceAuthorizationSuccess("mnop2345"),
    token: () => ({ status: 400, body: { error: "invalid_grant" } }),
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const homeDir = scratchHome();

  try {
    const { code, stderr } = await runCli(baseUrl, homeDir);
    assert.equal(code, 1);
    assert.match(stderr, /expired or was already used/i);
  } finally {
    server.close();
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("login: unwritable credentials directory prints the key once in full and exits 1", async () => {
  // The key is delivered exactly once by the server (claimDeviceCode is
  // exactly-once) -- a failure to save it locally must not just eat it.
  // Pre-create ~/.config read+execute-only (no write) so writeCredentialsFile's
  // mkdirSync/writeFileSync under it fails with EACCES, without needing root
  // or touching any real filesystem outside this test's own scratch dir.
  const server = await startServer({
    deviceAuthorization: deviceAuthorizationSuccess("uvwx2345"),
    token: () => ({
      status: 200,
      body: { access_token: "shb_unwritablehometoken1", token_type: "shb", scope: "master", expires_in: null },
    }),
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const homeDir = scratchHome();
  const configDir = join(homeDir, ".config");
  mkdirSync(configDir, { recursive: true });
  chmodSync(configDir, 0o500);

  try {
    const { code, stdout, stderr } = await runCli(baseUrl, homeDir);
    const combined = stdout + stderr;
    assert.equal(code, 1);
    // The full key, not just its prefix, appears exactly once -- this is
    // the user's only chance to capture it.
    const occurrences = combined.split("shb_unwritablehometoken1").length - 1;
    assert.equal(occurrences, 1, `expected the key to appear exactly once, got ${occurrences} in:\n${combined}`);
    assert.match(combined, /\.config[\\/]shebang[\\/]credentials\.json/);
    assert.equal(existsSync(join(configDir, "shebang", "credentials.json")), false);
  } finally {
    chmodSync(configDir, 0o700);
    server.close();
    rmSync(homeDir, { recursive: true, force: true });
  }
});
