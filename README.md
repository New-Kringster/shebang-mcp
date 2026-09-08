# shebang-mcp

One MCP server and CLI for hosting pages, sharing files, making short links,
running a Postgres database, and managing API keys — all through a single
`shb_…` key, for accounts on [shebang.pro](https://shebang.pro).

Full docs live at [docs.shebang.pro](https://docs.shebang.pro), with an
agent-oriented index at
[docs.shebang.pro/llms.txt](https://docs.shebang.pro/llms.txt) — and every
page there is also available as plain Markdown at `<page-url>.md`.

## Quickstart

**Claude Code:**

```
claude mcp add shebang -- npx -y shebang-mcp
npx -y shebang-mcp login
```

**Any other stdio-based MCP harness**, add this server entry:

```json
{
  "mcpServers": {
    "shebang": {
      "command": "npx",
      "args": ["-y", "shebang-mcp"]
    }
  }
}
```

then run `npx -y shebang-mcp login` once from a terminal on the same
machine (or set `SHEBANG_API_KEY` directly — see
[Env vars](#env-vars)).

`shebang-mcp` is on npm: [npmjs.com/package/shebang-mcp](https://www.npmjs.com/package/shebang-mcp).
To install from source instead — for example, to run the latest commit
on `main` ahead of the next published release —
`npx -y github:New-Kringster/shebang-mcp` runs that commit instead of
the published release.

## The login flow

`login` runs an [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628) device
authorization flow against the shebang platform:

1. The CLI calls the platform, gets back a short user code and a
   verification URL, and prints both — then tries to open your browser to
   that URL automatically.
2. In the browser, you sign in to your shebang.pro account (if not already)
   and see a page showing the device name and the same user code the
   terminal printed — check they match, then click **Approve** (or
   **Deny**).
3. The CLI has been polling in the background (honouring the server's
   advertised interval, and backing off further if told to `slow_down`);
   once approved, it writes the issued key to
   `~/.config/shebang/credentials.json` (mode `0600`) and prints the key's
   prefix.

From then on, every harness on that machine that runs this server picks the
key up automatically — no per-project configuration.

```
$ npx -y shebang-mcp login

  Confirm this code in your browser:

    x 7 w y 6 x 3 a

  https://dash.shebang.pro/authorize-agent?user_code=x7wy6x3a

Opening your browser… (if nothing opens, visit the URL above)
Waiting for approval....
Logged in. Key: shb_examplexxxxxxxx… (master)
Saved to ~/.config/shebang/credentials.json

Your agent can now use shebang.
```

`shebang-mcp status` shows the current key's prefix and tier;
`shebang-mcp logout` deletes the local credentials file (it does **not**
revoke the key — see below).

### Device flow endpoints

Two dash endpoints back the flow above, both accepting either
`application/x-www-form-urlencoded` (per the RFC) or JSON:

- `POST /api/agent-login/device_authorization` — `{client_name}` (optional,
  defaults to `"agent"`) → `{device_code, user_code, verification_uri,
  verification_uri_complete, expires_in, interval}`.
- `POST /api/agent-login/token` — `{grant_type:
  "urn:ietf:params:oauth:grant-type:device_code", device_code}` → `200
  {access_token, token_type: "shb", scope: "master", expires_in: null}` once,
  or a `400` with `{error}` ∈ `authorization_pending`, `slow_down` (with a
  grown `interval`), `access_denied`, `expired_token`, `invalid_grant`,
  `invalid_request`, `unsupported_grant_type`.

## Key tiers

- **Master** — what `login` mints. Full authority over the account: every
  app, plus minting and revoking other keys. One master key per login.
- **App** — scoped to a subset of `page`, `serve`, `link`, `base`. Mint one
  for a sub-agent via the `key_create_app` tool so it only gets the access
  it needs; the plaintext key is shown exactly once in the response.

A key cannot revoke itself while it's the one authenticating the call —
revoke a key from a *different* key (usually the master that minted it, via
the `key_revoke` tool) or from the shebang.pro dashboard's account page.
`shebang-mcp logout` only forgets the key locally; it prints this same
reminder.

On the wire, a `shb_…` key is sent as `Authorization: Bearer shb_...` —
on the platform API directly, and by every tool in this MCP server.

## Tool reference

**Pages** (`sherpage`)

| Tool | What it does |
| --- | --- |
| `sherpage_publish` | Publish a new page from a bundle of files |
| `sherpage_list` | List your pages |
| `sherpage_get` | Get one page's details |
| `sherpage_update` | Update title/slug/expiry/view budget |
| `sherpage_set_access` | Change access level (private/password/allow-list/public) |
| `sherpage_archive` | Archive or restore a page |
| `sherpage_delete` | Permanently delete a page and its files |

**Files** (`sherserve`)

| Tool | What it does |
| --- | --- |
| `store_upload_file` | Upload a local file as a new object (stdio only — see [Hosted MCP](#hosted-mcp)) |
| `store_list_objects` | List your uploaded objects |
| `store_get_object` | Get one object's details by slug or id |
| `store_delete_object` | Permanently delete an object and its file |

**Short links** (`sherlink`)

| Tool | What it does |
| --- | --- |
| `link_list` | List all your short links across apps |
| `link_get` | Get one link's details by code, alias, or id |
| `link_set_access` | Change access, password, expiry, or view budget |
| `link_set_alias` | Set or clear a custom vanity alias |
| `link_delete` | Delete a link **and** the page/file it wraps — irreversible |

**Projects** (`platform`, master-only unless noted)

A Project groups your keys, databases, files, links, and pages for
dashboard organization and access control. A key always reaches its own
home Project in full; a master key, or an app key holding a grant, can
also reach another Project (at `read` or `full` level).

### How projects scope your calls

Every tool defaults to the calling key's own home Project — you never have
to pass `project` for normal use. To target a *different* Project, pass
`project` (a slug) to that call: a master key can name any of the account's
other Projects; an app key can only reach one it's been explicitly granted
`read` or `full` access to via `project_grant_key` (naming one it can't
reach fails as `insufficient_scope`, never a not-found error, so existence
is never leaked to a key that can't reach it). Each call is scoped
independently — passing `project` on one call doesn't change what a later
call defaults to, so a tool like `link_list` still returns your home
Project's links unless you pass `project` again on that call too, even
right after publishing something into a different Project.

| Tool | What it does |
| --- | --- |
| `project_create` | Create a new Project (name, tag, color, slug) |
| `project_list` | List every Project on the account |
| `project_get` | Get one Project's details by id |
| `project_set` | Update a Project's name, tag, color, slug, or OAuth client |
| `project_resources` | List every key, database, file, link, and page in a Project |
| `project_delete` | Permanently delete a Project by id — irreversible |
| `project_assign` | Attribute an existing resource to a Project |
| `project_unassign` | Move a resource to your account's default Project |
| `project_grant_key` | Grant a key `read` or `full` access to another Project |
| `project_revoke_grant` | Revoke a key's grant on another Project |

`project_create`/`project_set`'s `color` must be one of the platform's
curated palette, not an arbitrary hex value:

`#ef4444` `#f97316` `#f59e0b` `#84cc16` `#22c55e` `#14b8a6` `#06b6d4`
`#3b82f6` `#6366f1` `#8b5cf6` `#a855f7` `#ec4899`

**Databases** (`sherbase`)

| Tool | What it does |
| --- | --- |
| `base_create_database` | Provision a new Postgres database (database + role) |
| `base_list_databases` | List your databases |
| `base_run_sql` | Run one SQL statement against a database |
| `base_drop_database` | Permanently drop a database — irreversible |
| `base_rotate_secret` | Rotate a database's Data API secret key — old one stops working immediately |
| `base_enable_api` | Enable the Data API for a database created before it had one |
| `base_reload_schema` | Reload a database's Data API schema cache after DDL run outside `base_run_sql` |

**Keys** (master-only)

| Tool | What it does |
| --- | --- |
| `key_create_app` | Mint a scoped app key, typically for a sub-agent — optionally bound to a Project (`project`, a slug) at birth |
| `key_list` | List every key on the account (never hashes or plaintext) |
| `key_revoke` | Permanently revoke a key by id — irreversible |

**Email** (master-only)

| Tool | What it does |
| --- | --- |
| `email_send` | Send a plain-text email from the platform's address, reply-to your account — limited to 10/day |

**OAuth** (master-only)

| Tool | What it does |
| --- | --- |
| `oauth_list_clients` | List registered sherlock OAuth clients |
| `oauth_create_client` | Register a new OAuth client (returns a one-time secret) |

## Visibility

Pages and uploaded files default to `access: "private"` — reachable only by
your own account — whether or not you set `access` at creation. To make one
public:

- **A page** — `sherpage_set_access({ id, access: "public" })`.
- **An uploaded file** — via the short link that `store_upload_file`/
  `store_upload_content` creates for it automatically:
  `link_set_access({ code_or_id, access: "public" })`.

Or pass `access: "public"` up front, at `sherpage_publish`/`store_upload_file`/
`store_upload_content` time, to skip the second call.

## Data API

Every database created with `base_create_database` gets a Supabase-shaped
Data API on by default — a PostgREST endpoint plus sherlock-backed auth —
at `https://api.shebang.pro/db/<slug>`. Databases created before this
existed don't have it until you call `base_enable_api {database}`, which
returns the same fields `base_create_database` does: `api_url`,
`publishable_key`, and (only the first time) `secret_key`, shown once and
never retrievable again.

- **`publishable_key`** (`sb_publishable_…`) is safe to ship in client
  code — pair it with a signed-in user's sherlock session for row-level
  security to apply per-user.
- **`secret_key`** (`sb_secret_…`) bypasses row-level security entirely —
  server-side only, never in a browser. Lost or compromised, rotate it
  with `base_rotate_secret {database, confirm}` (`confirm` must exactly
  equal `database`); the old secret stops working immediately.

Point `supabase-js` at it like a normal Supabase project:

```js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://api.shebang.pro/db/<slug>",
  "sb_publishable_<slug>_…",
);

// Sign in through sherlock — the platform's own auth — same as any
// Supabase Auth call:
await supabase.auth.signInWithPassword({ email, password });

const { data, error } = await supabase.from("todos").select("*");
```

### Sign in with sherlock (redirect)

Use this when you want your app to send users to sherlock to sign in and
get them back with tokens — no password form lives in your app, and a
user already signed in to one shebang app is signed in to every other
app on the same sherlock account.

**1. Register a client.** Dynamic client registration, against the
issuer's discovery document
(`https://auth.shebang.pro/auth/v1/.well-known/openid-configuration`):

```bash
curl -X POST https://auth.shebang.pro/auth/v1/oauth/clients/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My app",
    "redirect_uris": ["https://myapp.example.com/callback"],
    "token_endpoint_auth_method": "none"
  }'
```

`token_endpoint_auth_method: "none"` registers a **public** client (a
browser app or CLI, with no secret to protect); use `"client_secret_post"`
instead for a **confidential** client (a server that can hold one), and
the response includes a `client_secret`. Or skip the curl and call the
MCP `oauth_create_client` tool, which does the same registration.

**2. Send the user to the authorize URL**, with a PKCE challenge (S256
only — plain isn't supported) and a `state` you'll check on the way back:

```
https://auth.shebang.pro/auth/v1/oauth/authorize
  ?response_type=code
  &client_id=<client_id>
  &redirect_uri=<redirect_uri>
  &scope=openid email profile
  &code_challenge=<S256 challenge>
  &code_challenge_method=S256
  &state=<random state>
```

The consent screen the user sees names your app and lists these scopes.

**3. Handle the callback** at your `redirect_uri` (`?code=...&state=...`),
check `state` matches what you sent, then exchange the code for tokens
(form-encoded):

```bash
curl -X POST https://auth.shebang.pro/auth/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=<code>" \
  --data-urlencode "redirect_uri=<redirect_uri>" \
  --data-urlencode "client_id=<client_id>" \
  --data-urlencode "code_verifier=<verifier>"
```

You get back `access_token`, `refresh_token`, and `id_token` (a JWT
carrying the user's `email` and `sub`). The `access_token` is a sherlock
user JWT (`aud: "authenticated"`) — pass it as a Bearer token to your
database's Data API, or to `api.shebang.pro` (the platform API), and
either accepts it as that signed-in user.

**4. Use the access token with supabase-js**, so row-level security sees
the signed-in user:

```js
const supabase = createClient(api_url, publishable_key, {
  global: { headers: { Authorization: `Bearer ${access_token}` } },
});
```

**5. Refresh** when the access token expires:

```bash
curl -X POST https://auth.shebang.pro/auth/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=<refresh_token>" \
  --data-urlencode "client_id=<client_id>"
```

**6. Log out** by dropping the tokens client-side; sherlock sessions end
with sign-out-everywhere, not a per-app revoke.

This is an alternative to the embedded-form flow — signing in directly
via `supabase-js` calls like `signInWithPassword`, or `signUp`/
`verifyOtp` (see above, and Sign-up for your app's users below). Pick
redirect for one account shared across apps with no password handling
in your own code; pick embedded when you want the sign-in form itself
to live inside your app's UI.

### Sign-up for your app's users

Your app's end users sign up through sherlock — the platform's own auth —
directly via `supabase-js`, never through this MCP server. Two supported
flows:

- **Email + password**, confirmed with a 6-digit code sent by email (not a
  confirmation link): `supabase.auth.signUp({ email, password })`, then
  `supabase.auth.verifyOtp({ email, token: "<6-digit code>", type: "signup" })`.
- **OTP-only sign-in** (no password at all): `supabase.auth.signInWithOtp({ email })`,
  then `supabase.auth.verifyOtp({ email, token: "<6-digit code>", type: "email" })`.

The app owner's own shebang.pro account (the one `login` authenticates as)
is entirely separate from these end users — signing a user up in your
app's database never touches the owner's platform account.

If a table or column you just created over `base_run_sql`, the direct
connection, or the pooler isn't showing up on the Data API yet, call
`base_reload_schema {database}` to refresh PostgREST's schema cache
without waiting for the gateway to restart on its own. Calling it before
the Data API is enabled returns a clear "enable the Data API first"
error instead of a confusing one.

The direct connection and pooler strings shown in the dashboard use
`sslmode=verify-full` and `sslrootcert=system`. Clients older than libpq
16 need a CA file instead of `sslrootcert=system`: download the
[ISRG Root X1 certificate](https://letsencrypt.org/certs/isrgrootx1.pem)
and use `sslrootcert=<path>`.

## Migrating from 0.3.x

0.4.0 is additive — no tool was renamed or removed. `base_list_databases`
and `base_create_database` gain `api_url`, `publishable_key`, and
`api_enabled` fields on every database they return (`base_create_database`
additionally returns `secret_key` once, on a newly created database's
first Data API key pair). Three new tools cover the sherbase Data API
this release ships: `base_rotate_secret`, `base_enable_api`, and
`base_reload_schema` — see [Data API](#data-api). Every 0.3.x call keeps
working unchanged.

## Migrating from 0.4.0

0.5.0 removes the one-release aliases 0.2.0 and 0.4.0 introduced. Nothing
here was renamed or changed shape — these names simply stop working.
Update any already-configured agent before upgrading.

**Removed tools** (registered but undocumented since 0.2.0/0.4.0 — call
the tool in the "Use instead" column):

| Removed | Use instead |
| --- | --- |
| `app_create` | `project_create` |
| `app_list` | `project_list` |
| `app_get` | `project_get` |
| `app_set` | `project_set` |
| `app_resources` | `project_resources` |
| `app_delete` | `project_delete` |
| `app_assign` | `project_assign` |
| `app_unassign` | `project_unassign` |
| `base_list_projects` | `base_list_databases` |
| `base_create_project` | `base_create_database` |
| `base_drop_project` | `base_drop_database` |

**Removed arguments:**

- `base_run_sql`'s deprecated `slug` argument alias is gone — pass
  `database` (now required).
- `key_create_app`'s deprecated `app_id` (a Project id) argument is gone —
  pass `project` (a Project slug). The underlying `POST
  /api/platform/v1/keys` route now 400s `invalid_body` if `app_id` is
  present in the request body at all.

**Removed response field:** `base_list_databases`'s result (and the
underlying `GET .../databases` routes) no longer carry the duplicate
`projects` key — read `databases`, which has carried the identical array
since 0.2.0.

## 0.5.1

`project_create`/`project_set`'s `color` is now a curated enum with a
client-side rejection message listing every accepted value, `store_upload_content`
infers a file extension from `contentType` when the path has none, and this
README gained the docs noted above (project scoping, visibility, sign-up).

## Hosted MCP

`https://api.shebang.pro/mcp` runs the same `registerTools` this package
exports, over the same tool schemas — with one difference: **local file
paths are not available on the hosted server.** `store_upload_file` reads
a path off whatever filesystem the MCP server process can see; over
stdio that's your own machine, but the hosted server runs inside
shebang's own dash container, so a `path` argument there would name a
file on shebang's infrastructure, not yours. The hosted endpoint omits
`store_upload_file` entirely and registers `store_upload_content` in its
place — upload by supplying the bytes directly (`contentBase64` or
`text`) instead of a path. Every other tool is identical between the two
servers.

## Env vars

| Variable | Purpose |
| --- | --- |
| `SHEBANG_API_KEY` | The `shb_…` key to authenticate with. Takes priority over the credentials file. `SHERPAGE_API_KEY` is accepted as a legacy alias for the same value. |
| `SHEBANG_BASE_URL` | Platform base URL; defaults to `https://dash.shebang.pro`. |
| `~/.config/shebang/credentials.json` | Written by `login` (`{ api_key, base_url }`, mode `0600`); read when the env vars above are unset. |

## The platform

The MCP server and CLI in this repo are a client only — no secrets, no
server code, nothing that talks to a database directly. The platform itself
(accounts, keys, pages, files, links, databases, OAuth) is operated at
[shebang.pro](https://shebang.pro); an account there is required to use
this client.

## License

MIT — see [LICENSE](./LICENSE).
