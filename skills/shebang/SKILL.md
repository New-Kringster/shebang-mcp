---
name: shebang
description: Use whenever an agent needs to host a web page, share a file with someone, spin up a Postgres database, create a short link, or manage its own API keys — via the shebang MCP server. Triggers on "host a page", "publish this as a page", "share this file", "give me a link to this file", "make a short link", "create a database", "run SQL against my database", "mint an API key for a sub-agent", "shebang", "sherpage", "sherbase", "sherserve", "sherlink", or any 401/missing-API-key error from a shebang_/sherpage_/store_/base_/link_/key_/oauth_ tool call (run `npx -y github:New-Kringster/shebang-mcp login` to fix it).
---

# shebang

shebang is one account, one API key, and one MCP server covering five
things an agent commonly needs while working: hosting **pages**, sharing
**files**, minting **short links**, running a **Postgres database**, and
managing its own **identity** (API keys, OAuth clients). All of it is
reachable through the `shebang-mcp` server's tools — no separate accounts,
no separate SDKs.

## Login-if-401

Every tool call in this server needs an `shb_…` API key. If a tool call
fails with something like "missing API key" or `401`/`invalid_api_key`, run:

```
npx -y github:New-Kringster/shebang-mcp login
```

This starts a device-login flow: it prints a code and a URL, tries to open
a browser, and polls until a human approves it there. On approval it writes
`~/.config/shebang/credentials.json` (mode 0600) and every future tool call
in this server (or any other harness pointed at the same machine) picks the
key up automatically — log in once, not per-project. If a browser isn't
available on this machine, open the printed URL from any other device and
approve there; the CLI keeps polling either way.

## Master keys vs. app keys

The key `login` mints is a **master** key: full authority over the account
— it can create/read/update/delete anything on every app, and it can mint
and revoke other keys. Treat it like a root credential.

When spinning up a **sub-agent** that only needs part of that authority
(e.g. a worker that only ever uploads files, or one that only manages
links), mint it a scoped **app** key instead of handing out the master key:

```
key_create_app({ name: "file-worker", apps: ["serve"] })
```

`apps` is a non-empty subset of `page`, `serve`, `link`, `base` — pick only
what the sub-agent needs. The plaintext key is returned exactly once in
that response; copy it into the sub-agent's environment immediately, it
cannot be retrieved again. An app key can never mint a master key and can
never call the key-management or OAuth-client tools (`key_list`,
`key_create_app`, `key_revoke`, `oauth_*`) — those are master-only.

A key can't revoke itself mid-use — if a sub-agent's key needs to go, revoke
it from a different key (usually the master that minted it, via
`key_revoke`) or from the account page on the dashboard.

## Tool map, by app

**Pages** (`sherpage` — static bundles, e.g. a built site or a single HTML
file) — `sherpage_publish`, `sherpage_list`, `sherpage_get`,
`sherpage_update`, `sherpage_set_access`, `sherpage_archive`,
`sherpage_delete`.

**Files** (`sherserve` — single-file uploads) — `store_upload_file`,
`store_list_objects`, `store_get_object`, `store_delete_object`.

**Short links** (`sherlink` — wraps a page or file behind a short,
optionally custom-aliased URL) — `link_list`, `link_get`, `link_set_access`,
`link_set_alias`, `link_delete`.

**Databases** (`sherbase` — dedicated Postgres projects) —
`base_create_project`, `base_list_projects`, `base_run_sql`,
`base_drop_project`.

**Keys and identity** (`platform` — master-only) — `key_create_app`,
`key_list`, `key_revoke`, `oauth_list_clients`, `oauth_create_client`.

Read `src/index.js` in this repo for each tool's exact parameters — every
tool has a full Zod schema and description string; this table is a map, not
a substitute for the schema.

## The link model: sl. / p. / f.

Every page (`p.shebang.pro/...`) and every uploaded file
(`f.shebang.pro/...`) gets its own direct URL. A **short link**
(`sl.shebang.pro/<code>`, or a custom alias) is a separate, optional wrapper
around one of those — created implicitly when you publish/upload, and
manageable on its own via the `link_*` tools (access level, password,
expiry, view budget, custom alias).

**`link_delete` is destructive beyond the link itself.** Deleting a sherlink
link cascades to and permanently deletes the underlying sherpage page or
sherserve file *and its storage* — not just the short URL. There is no
"unwrap the link but keep the file" operation. `link_delete` (like every
other destructive tool here — `sherpage_delete`, `store_delete_object`,
`base_drop_project`, `key_revoke`) requires a `confirm` argument that must
exactly match the id/slug/code being deleted; treat that as a genuine
confirmation step, not boilerplate to fill in automatically.

## Common recipes

**Host a page.** Build the bundle in memory (at minimum an `index.html`),
then `sherpage_publish({ title, files: [{ path: "index.html", content,
encoding: "utf8" }] })`. Returns the `p.shebang.pro` URL immediately.

**Share a file with a password.** `store_upload_file({ path:
"/local/path/to/file.pdf", access: "password", password: "…" })`. Anyone
with the URL needs the password to view it.

**Spin up a database.** `base_create_project({ slug: "my-project" })` —
returns a connection string and password shown exactly once; save them.
Then `base_run_sql({ slug, sql: "create table ..." })` to set up schema, run
as that project's own role (not a shared superuser).

**Make a short link with a custom alias.** Links are created automatically
alongside a page/file publish; find its `code` via `link_list` or
`sherpage_publish`'s response, then `link_set_alias({ code_or_id: code,
alias: "my-alias" })` to get `sl.shebang.pro/my-alias`.

**Delegate to a sub-agent safely.** Mint it a scoped key
(`key_create_app({ name, apps: [...] })`) rather than sharing the master
key or `~/.config/shebang/credentials.json`.
