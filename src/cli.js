#!/usr/bin/env node
// shebang-mcp CLI: `login`/`status`/`logout` around the shebang platform's
// device login flow, plus a default `serve` that execs the MCP server
// (src/index.js) — so `npx -y github:New-Kringster/shebang-mcp` with no
// args, or as an MCP client's launch command, just works.

import { spawn } from "node:child_process";
import { mkdirSync, chmodSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { homedir, hostname, platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE_URL = "https://dash.shebang.pro";
const CREDENTIALS_PATH = join(homedir(), ".config", "shebang", "credentials.json");
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes, matches the server-side code lifetime

function baseUrlFromArgsOrEnv(args) {
  const flagIndex = args.indexOf("--base-url");
  if (flagIndex !== -1 && args[flagIndex + 1]) return args[flagIndex + 1].replace(/\/+$/, "");
  return (process.env.SHEBANG_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function readCredentialsFile() {
  try {
    const parsed = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCredentialsFile(apiKey, baseUrl) {
  mkdirSync(dirname(CREDENTIALS_PATH), { recursive: true });
  // Unlink any existing entry first, then create fresh with flag "wx"
  // (fail-if-exists) and mode 0600. Overwriting in place is unsafe two
  // ways: writeFileSync's `mode` only applies when it CREATES the file, so
  // an existing file keeps its old (possibly looser) mode until the later
  // chmod — a brief window where the key sits at the wrong permissions; and
  // if an attacker plants a symlink at CREDENTIALS_PATH, an in-place write
  // follows it and writes the key through to the symlink's target. Removing
  // the path first (unlink does not follow the final symlink) and opening
  // with "wx" guarantees we write a brand-new regular file we own, created
  // at 0600 from the outset.
  try {
    unlinkSync(CREDENTIALS_PATH);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  writeFileSync(CREDENTIALS_PATH, JSON.stringify({ api_key: apiKey, base_url: baseUrl }, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  // Belt-and-suspenders: enforce 0600 even if the umask or platform ever
  // widened the create mode.
  chmodSync(CREDENTIALS_PATH, 0o600);
}

function keyPrefix(apiKey) {
  return apiKey.length > 12 ? `${apiKey.slice(0, 12)}…` : apiKey;
}

/** Best-effort browser open: tries the platform opener, spawned detached so
 *  it never blocks the poll loop, and swallows any failure — the verify
 *  URL is always printed too, so a failed or headless open is never fatal. */
function tryOpenBrowser(url) {
  const platform = osPlatform();
  const command = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", shell: platform === "win32" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // no opener available — the printed URL is the fallback path
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, data };
}

async function cmdLogin(args) {
  const baseUrl = baseUrlFromArgsOrEnv(args);
  const deviceName = `${hostname()} agent`;

  let started;
  try {
    started = await postJson(`${baseUrl}/api/agent-login/start`, { device_name: deviceName });
  } catch (err) {
    console.error(`Could not reach ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }
  if (!started.ok || !started.data || typeof started.data.code !== "string") {
    console.error(`Login could not start: ${started.data?.error ?? `HTTP ${started.status}`}`);
    process.exitCode = 1;
    return;
  }

  const { code, poll_secret: pollSecret, verify_url: verifyUrl } = started.data;

  console.log("");
  console.log("  Confirm this code in your browser:");
  console.log("");
  console.log(`    ${code.split("").join(" ")}`);
  console.log("");
  console.log(`  ${verifyUrl}`);
  console.log("");
  console.log("Opening your browser… (if nothing opens, visit the URL above)");
  tryOpenBrowser(verifyUrl);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  process.stdout.write("Waiting for approval");
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let polled;
    try {
      polled = await postJson(`${baseUrl}/api/agent-login/poll`, { code, poll_secret: pollSecret });
    } catch {
      process.stdout.write("x");
      continue;
    }
    if (!polled.ok || !polled.data || typeof polled.data.status !== "string") {
      process.stdout.write("x");
      continue;
    }

    const status = polled.data.status;
    if (status === "pending") {
      process.stdout.write(".");
      continue;
    }
    console.log("");
    if (status === "approved") {
      const apiKey = polled.data.api_key;
      if (typeof apiKey !== "string" || apiKey.length === 0) {
        console.error("Server said approved but returned no key. Try `shebang-mcp login` again.");
        process.exitCode = 1;
        return;
      }
      writeCredentialsFile(apiKey, baseUrl);
      console.log(`Logged in. Key: ${keyPrefix(apiKey)} (master)`);
      console.log(`Saved to ${CREDENTIALS_PATH}`);
      console.log("");
      console.log("Your agent can now use shebang.");
      return;
    }
    if (status === "denied") {
      console.error("Login was denied in the browser. Run `shebang-mcp login` again if this wasn't intentional.");
      process.exitCode = 1;
      return;
    }
    if (status === "expired" || status === "claimed_already") {
      console.error("This login code expired or was already used. Run `shebang-mcp login` again.");
      process.exitCode = 1;
      return;
    }
    console.error(`Unexpected status from server: ${status}`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.error("Timed out waiting for approval (10 minutes). Run `shebang-mcp login` again.");
  process.exitCode = 1;
}

async function cmdStatus() {
  const fromFile = readCredentialsFile();
  const apiKey = process.env.SHEBANG_API_KEY ?? process.env.SHERPAGE_API_KEY ?? fromFile.api_key;
  const baseUrl = (process.env.SHEBANG_BASE_URL ?? fromFile.base_url ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  if (!apiKey) {
    console.log("Not logged in. Run `shebang-mcp login` (or set SHEBANG_API_KEY).");
    process.exitCode = 1;
    return;
  }

  console.log(`Key: ${keyPrefix(apiKey)}`);
  console.log(`Base URL: ${baseUrl}`);

  let response;
  try {
    response = await fetch(`${baseUrl}/api/platform/v1/keys`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    console.error(`Could not reach ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  if (response.status === 200) {
    const data = await response.json().catch(() => null);
    const keys = Array.isArray(data?.keys) ? data.keys : null;
    const count = keys ? keys.length : "unknown";
    console.log(`Tier: master`);
    console.log(`Keys on this account: ${count}`);

    // Best-effort: find this key's own row (matched by its 12-char
    // prefix, the same value the server stores as key_prefix) and resolve
    // its home project id to a slug via GET /projects. Silent on any
    // failure — this is a nice-to-have, not required for status to be
    // useful, and the /keys response only carries the raw project id
    // (projectId), not the slug, so a second call is the only way to
    // print something human-readable here.
    try {
      const ownPrefix = apiKey.slice(0, 12);
      const own = keys?.find((k) => k.keyPrefix === ownPrefix);
      if (own?.projectId) {
        const projectsResponse = await fetch(`${baseUrl}/api/platform/v1/projects`, {
          headers: { authorization: `Bearer ${apiKey}` },
        });
        if (projectsResponse.status === 200) {
          const projectsData = await projectsResponse.json().catch(() => null);
          const project = Array.isArray(projectsData?.projects)
            ? projectsData.projects.find((p) => p.id === own.projectId)
            : undefined;
          if (project?.slug) console.log(`Home project: ${project.slug}`);
        }
      }
    } catch {
      // best-effort only — status is still useful without this line
    }
  } else if (response.status === 403) {
    console.log("Tier: app-scoped key (not master — cannot list account keys)");
  } else if (response.status === 401) {
    console.log("Key invalid or revoked. Run `shebang-mcp login` again.");
    process.exitCode = 1;
  } else {
    console.log(`Unexpected response probing key status: HTTP ${response.status}`);
    process.exitCode = 1;
  }
}

function cmdLogout() {
  if (!existsSync(CREDENTIALS_PATH)) {
    console.log("Not logged in (no credentials file to remove).");
    return;
  }
  unlinkSync(CREDENTIALS_PATH);
  console.log(`Removed ${CREDENTIALS_PATH}.`);
  console.log("");
  console.log(
    "This only forgets the key locally — the key itself is still valid. The server refuses to let a key " +
      "revoke itself while it's the one authenticating the call, so revoke it either from another agent " +
      "holding a master key (the key_revoke tool) or from the shebang.pro dashboard's account page.",
  );
}

function cmdServe() {
  const child = spawn(process.execPath, [join(__dirname, "index.js")], { stdio: "inherit" });
  child.on("exit", (exitCode, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(exitCode ?? 0);
  });
}

async function main() {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "login":
      await cmdLogin(rest);
      break;
    case "status":
      await cmdStatus();
      break;
    case "logout":
      cmdLogout();
      break;
    case "serve":
    case undefined:
      cmdServe();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Usage: shebang-mcp [serve] | login [--base-url URL] | status | logout");
      process.exitCode = 1;
  }
}

main();
