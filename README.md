# shebang-mcp

One MCP server and CLI for hosting pages, sharing files, making short links,
running a Postgres database, and managing API keys — all through a single
`shb_…` key, for accounts on [shebang.pro](https://shebang.pro).

## Quickstart

**Claude Code:**

```
claude mcp add shebang -- npx -y github:New-Kringster/shebang-mcp
npx -y github:New-Kringster/shebang-mcp login
```

**Any other stdio-based MCP harness**, add this server entry:

```json
{
  "mcpServers": {
    "shebang": {
      "command": "npx",
      "args": ["-y", "github:New-Kringster/shebang-mcp"]
    }
  }
}
```

then run `npx -y github:New-Kringster/shebang-mcp login` once from a
terminal on the same machine (or set `SHEBANG_API_KEY` directly — see
[Env vars](#env-vars)).

npm registry publish is planned but not live yet — install via the GitHub
shorthand above until then.

## The login flow

`login` starts a device-authorization flow against the shebang platform:

1. The CLI calls the platform, gets back a short code and a verify URL, and
   prints both — then tries to open your browser to that URL automatically.
2. In the browser, you sign in to your shebang.pro account (if not already)
   and see a page showing the device name and the same code the terminal
   printed — check they match, then click **Approve** (or **Deny**).
3. The CLI has been polling in the background; once approved, it writes the
   issued key to `~/.config/shebang/credentials.json` (mode `0600`) and
   prints the key's prefix.

From then on, every harness on that machine that runs this server picks the
key up automatically — no per-project configuration.

```
$ npx -y github:New-Kringster/shebang-mcp login

  Confirm this code in your browser:

    x 7 w y 6 x 3 a

  https://dash.shebang.pro/authorize-agent?code=x7wy6x3a

Opening your browser… (if nothing opens, visit the URL above)
Waiting for approval....
Logged in. Key: shb_examplexxxxxxxx… (master)
Saved to ~/.config/shebang/credentials.json

Your agent can now use shebang.
```

`shebang-mcp status` shows the current key's prefix and tier;
`shebang-mcp logout` deletes the local credentials file (it does **not**
revoke the key — see below).

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
| `store_upload_file` | Upload a local file as a new object |
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

**Databases** (`sherbase`)

| Tool | What it does |
| --- | --- |
| `base_create_database` | Provision a new Postgres database (database + role) |
| `base_list_databases` | List your databases |
| `base_run_sql` | Run one SQL statement against a database |
| `base_drop_database` | Permanently drop a database — irreversible |

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

## Migrating from 0.1.x

0.2.0 renames the App concept to Project and renames the sherbase database
tools to match. Old tool names still work for one release (registered but
undocumented — see below), so an already-configured agent doesn't break
mid-upgrade; update to the new names when convenient.

**Renamed tools:**

| Old (0.1.x) | New (0.2.0) |
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

**Renamed arguments:**

- `base_run_sql`'s first argument is renamed `slug` → `database`. The old
  `slug` name still works if you pass it instead.
- `app_assign`/`app_unassign`'s `app_id` argument is renamed `id` on the
  new `project_assign`/`project_unassign` tools; the old alias tools keep
  accepting `app_id`.
- `key_create_app`'s old `app_id` (a Project id) argument still works for
  one release; prefer its new `project` (a Project slug) argument. Passing
  both and naming different projects is a `400`.

**New:** every resource tool (`sherpage_*`, `store_*`, `link_*`,
`base_list_databases`, `base_create_database`) gained an optional
`project` argument (a Project slug) to act on a Project other than your
key's home Project, where the underlying platform route supports it.
`key_create_app` gained an optional `project` argument for the same
reason. `project_grant_key` and `project_revoke_grant` are new.

**Alias window:** the old `app_*` and `base_list_projects`/
`base_create_project`/`base_drop_project` names are registered and fully
callable through 0.2.0, but are no longer documented here or in
`skills/shebang/SKILL.md` — treat them as deprecated and migrate off them
before the next release removes them.

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
