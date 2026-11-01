# edgeport

edgeport is a small doorway into a Cloudflare account. From one bin an
agent can see which accounts and zones a token can reach, read and
change DNS records, purge cached content, and inventory the account's
Worker scripts, KV namespaces, and R2 buckets. It runs from the
command line or as an MCP server for agents.

A Cloudflare API token is required. Put it in the
`CLOUDFLARE_API_TOKEN` environment variable; it is sent to the API as
a Bearer token and never appears in output. Account-scoped tools
(Worker scripts, KV, R2) take an `account_id` argument, and when that
is omitted they fall back to `CLOUDFLARE_ACCOUNT_ID`. When a required
variable is missing, the call fails with an error that names it.

This is a core subset of the Cloudflare API, not the whole surface:
Workers bindings deep configuration, observability and Logpush,
rulesets and firewall rules, Pages and deployments, Stream and
Images, AI and Vectorize, and the hosted documentation search tool
are out of scope.

## Install

```bash
npx @reneturcios/edgeport list-zones
```

Or run the container image:

```bash
docker run -i -e CLOUDFLARE_API_TOKEN ghcr.io/cloudcorprecords/edgeport
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
export CLOUDFLARE_API_TOKEN="your api token"
export CLOUDFLARE_ACCOUNT_ID="your account id"   # optional fallback

edgeport list-accounts
edgeport list-zones --name example.com
edgeport get-zone --zone-id <zone id>
edgeport list-dns --zone-id <zone id> --type A
edgeport purge-cache --zone-id <zone id> --everything
edgeport list-workers
edgeport list-kv
edgeport list-r2

edgeport --version
```

Exit codes: `0` on success, `1` when an API call fails (including a
missing `CLOUDFLARE_API_TOKEN` or a `success: false` envelope), `2`
for usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/edgeport mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "edgeport": {
      "command": "npx",
      "args": ["-y", "@reneturcios/edgeport", "mcp"],
      "env": { "CLOUDFLARE_API_TOKEN": "your api token" }
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `list_accounts` | `per_page` (integer, optional) | Accounts the token can access, from the envelope's result. |
| `list_zones` | `account_id`, `name`, `per_page` (all optional) | Zones, optionally filtered by account or name. |
| `get_zone` | `zone_id` (required) | One zone's details. |
| `list_dns_records` | `zone_id` (required), `type`, `name`, `per_page` (optional) | DNS records in the zone. |
| `create_dns_record` | `zone_id`, `type`, `name`, `content` (required), `ttl`, `proxied`, `comment` (optional) | The created record. |
| `update_dns_record` | `zone_id`, `record_id` (required), any record field (optional) | The updated record; only the fields given are sent. |
| `delete_dns_record` | `zone_id`, `record_id` (required) | The delete result. |
| `purge_cache` | `zone_id` (required), `purge_everything`, `files`, `tags`, `hosts` (optional) | The purge result for the zone. |
| `list_workers_scripts` | `account_id` (optional) | Worker scripts in the account. |
| `get_worker_script` | `script_name` (required), `account_id` (optional) | A shape summary only: content type, byte size, body present. The script body is never returned. |
| `list_kv_namespaces` | `account_id` (optional) | Workers KV namespaces in the account. |
| `list_r2_buckets` | `account_id` (optional) | R2 buckets in the account. |

Every JSON response is unwrapped from Cloudflare's
`{success, errors, result}` envelope. A `success: false` envelope is
reported as a tool error carrying the API's own error entries.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
