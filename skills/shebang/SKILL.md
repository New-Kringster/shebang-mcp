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

Full docs, for anything this file doesn't cover in enough depth, are at
https://docs.shebang.pro — including an agent-oriented index at
https://docs.shebang.pro/llms.txt, and every page there fetchable as
plain Markdown at `<page-url>.md` instead of rendered HTML.

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

## Projects

A **Project** groups a key's resources — keys, databases, files, links, and
pages — for dashboard organization and access control; it's unrelated to the
`apps`/`project` scope list on a key (`page`/`serve`/`link`/`base`, see
below). Every key has exactly one home Project, which it always reaches in
full. A master key can name any of the account's other Projects (via a
`project` argument, a slug); an app key can only reach a Project it's been
explicitly granted (`read` or `full`, via `project_grant_key`) beyond its
own home Project. Naming a Project the key can't reach fails as
`insufficient_scope`, never a not-found error. Most agents never need to
think about Projects at all — every tool defaults to the key's own home
Project when the optional `project` argument is omitted. Each call is
scoped independently: passing `project` on one call doesn't change what a
*later* call defaults to. Publishing a page with `project: "acme"` and
then calling `link_list` with no `project` still returns your home
Project's links, not `acme`'s — pass `project: "acme"` again on that call
too.

## Master keys vs. app keys

The key `login` mints is a **master** key: full authority over the account
— it can create/read/update/delete anything on every app, and it can mint
and revoke other keys. Treat it like a root credential.

When spinning up a **sub-agent** that only needs part of that authority
(e.g. a worker that only ever uploads files, or one that only manages
links), mint it a scoped **app** key instead of handing out the master key:

```
key_create_app({ name: "file-worker", apps: ["serve"], project: "acme" })
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
`store_upload_file` reads a local path and is stdio-only; the hosted MCP
server (`https://api.shebang.pro/mcp`) has no local filesystem to read
from, so it registers `store_upload_content` in its place — same upload,
bytes supplied inline (`contentBase64` or `text`) instead of a path.

**Short links** (`sherlink` — wraps a page or file behind a short,
optionally custom-aliased URL) — `link_list`, `link_get`, `link_set_access`,
`link_set_alias`, `link_delete`.

**Databases** (`sherbase` — dedicated Postgres databases) —
`base_create_database`, `base_list_databases`, `base_run_sql`,
`base_drop_database`, `base_rotate_secret`, `base_enable_api`,
`base_reload_schema`.

Every database also gets a Supabase-shaped Data API (PostgREST + sherlock
auth) at `api.shebang.pro/db/<slug>`, on by default for new databases —
`base_create_database`/`base_list_databases` return its `api_url` and
`publishable_key` (safe for client code; pair with a signed-in sherlock
session for row-level security) alongside the database's usual
connection details, plus a `secret_key` shown once (server-side only,
bypasses row-level security). `base_enable_api` turns it on for a
database created before this existed; `base_rotate_secret` rotates a
compromised or lost secret key (old one stops working immediately,
`confirm` must match `database`); `base_reload_schema` refreshes the
Data API's schema cache after DDL run outside `base_run_sql` (e.g. over
the direct connection) so new tables/columns show up without waiting for
a restart. The direct/pooler connection strings use `sslrootcert=system`;
clients on libpq < 16 need a CA file instead — download the
[ISRG Root X1 certificate](https://letsencrypt.org/certs/isrgrootx1.pem)
and pass `sslrootcert=<path>`.

Your app's own end users sign up through sherlock directly via
`supabase-js`, never through this MCP server: `signUp({ email, password })`
then `verifyOtp({ email, token: "<6-digit code>", type: "signup" })`
(sherlock emails a code, not a link), or OTP-only sign-in with
`signInWithOtp({ email })` then `verifyOtp({ email, token, type: "email" })`.
The app owner's own shebang.pro account is entirely separate from these
end users.

Your app can also sign users in **by redirect** instead of an embedded
form: send them to sherlock's authorize URL (PKCE, S256 only, scope
`openid email profile`), handle the callback, exchange the code for
tokens (form-encoded), and use the returned `access_token` — a sherlock
user JWT — as `Authorization: Bearer <access_token>` against both the
Data API and `api.shebang.pro`, and `refresh_token` to renew it. Register
a client first, either via dynamic registration against
`<issuer>/oauth/clients/register` or the `oauth_create_client` tool.

**Projects** (`platform` — dashboard organization and access control; see
above) — `project_create`, `project_list`, `project_get`, `project_set`,
`project_resources`, `project_delete`, `project_assign`,
`project_unassign`, `project_grant_key`, `project_revoke_grant`.

**Keys and identity** (`platform` — master-only) — `key_create_app`,
`key_list`, `key_revoke`, `oauth_list_clients`, `oauth_create_client`.

**Email** (`platform` — master-only) — `email_send`. Sends plain text from
the platform's fixed address (reply-to your account, on-behalf-of footer
appended server-side); capped at 10 emails per account per rolling 24
hours, and app keys get 403 — only a master key can call it.

Read `src/tools.js` in this repo for each tool's exact parameters — every
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
`base_drop_database`, `base_rotate_secret`, `key_revoke`) requires a
`confirm` argument that must exactly match the id/slug/code/database
being deleted or rotated; treat that as a genuine confirmation step, not
boilerplate to fill in automatically.

## Visibility

Pages and uploaded files default to `access: "private"` — reachable only
by your own account, whether or not you set `access` at creation. Make one
public with `sherpage_set_access({ id, access: "public" })` for a page, or
`link_set_access({ code_or_id, access: "public" })` for an uploaded file's
short link — or pass `access: "public"` up front at publish/upload time to
skip the second call.

## Common recipes

**Host a page.** Build the bundle in memory (at minimum an `index.html`),
then `sherpage_publish({ title, files: [{ path: "index.html", content,
encoding: "utf8" }] })`. Returns the `p.shebang.pro` URL immediately.

**Share a file with a password.** `store_upload_file({ path:
"/local/path/to/file.pdf", access: "password", password: "…" })`. Anyone
with the URL needs the password to view it.

**Spin up a database.** `base_create_database({ slug: "my-database" })` —
returns a connection string and password shown exactly once; save them.
Then `base_run_sql({ database: slug, sql: "create table ..." })` to set up
schema, run as that database's own role (not a shared superuser).

**Make a short link with a custom alias.** Links are created automatically
alongside a page/file publish; find its `code` via `link_list` or
`sherpage_publish`'s response, then `link_set_alias({ code_or_id: code,
alias: "my-alias" })` to get `sl.shebang.pro/my-alias`.

**Delegate to a sub-agent safely.** Mint it a scoped key
(`key_create_app({ name, apps: [...] })`) rather than sharing the master
key or `~/.config/shebang/credentials.json`.

**Send a notification email.** `email_send({ to, subject, text })` — master
key only, 10/day per account, text only (no HTML/attachments); the
from-address is fixed and reply-to is your own account email.
