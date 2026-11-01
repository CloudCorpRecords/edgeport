# edgeport — Build Report

MCP Rebuild 100, Tier B. Clean-room rebuild of the Cloudflare MCP
server, built from the public tool spec captured in
`harness/fixtures/cloudflare-tools-original.json` only. The fixture is
docs-derived from the public Cloudflare API v4 documentation and the
documented Cloudflare MCP tool surface, and is marked
`"_source": core-subset ...` — edgeport implements a **12-tool core
subset**. Omitted groups: Workers bindings deep config,
observability/logpush, rulesets/firewall, pages/deployments,
stream/images, AI/vectorize, docs-search hosted tool. Parity below is
claimed only against the 12-tool subset, never against the full
Cloudflare surface. Local build only — nothing pushed or published,
and no live network call was made or claimed at any point.

Identity: repo `edgeport`, npm `@reneturcios/edgeport`,
MCP name `io.github.CloudCorpRecords/edgeport`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `edgeport: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Zones, DNS, cache purge, Workers, KV,
  and R2 through the Cloudflare API." = **72 chars** (≤100 ✓);
  npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/edgeport:0.1.0` carries **no** `version`
  field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/edgeport"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`list-accounts`, `list-zones`,
  `get-zone`, `list-dns`, `purge-cache`, `list-workers`, `list-kv`,
  `list-r2`, `mcp`, `--version`; exit 2 usage / 1 API error),
  `src/mcp.ts`, `src/types.ts`, `src/cloudflare.ts` (core logic,
  `VERSION = "0.1.0"`)
- `test/cloudflare.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to edgeport)

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals, per the standing fleet rule: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys that are absent from the public spec and
  break exact schema parity. Zod still validates every `tools/call`.
- The 12 tools map to Cloudflare API v4 endpoints under
  `https://api.cloudflare.com/client/v4` (`/accounts`, `/zones`,
  `/zones/:id`, `/zones/:id/dns_records` with POST/PATCH/DELETE,
  `/zones/:id/purge_cache`, `/accounts/:id/workers/scripts`,
  `/accounts/:id/storage/kv/namespaces`, `/accounts/:id/r2/buckets`).
  The token from `CLOUDFLARE_API_TOKEN` is sent as
  `Authorization: Bearer <token>`; writes are JSON bodies.
- Envelope handling: every JSON response is checked for the
  Cloudflare `{success, errors, result}` envelope — `success: false`
  throws with the envelope's error entries (code + message), and on
  success the unwrapped `result` is returned.
- Account-scoped tools take an `account_id` argument and fall back to
  `CLOUDFLARE_ACCOUNT_ID`; with neither available they fail before
  any request with an error naming `CLOUDFLARE_ACCOUNT_ID` (verified
  live over stdio, see below). A missing token likewise names
  `CLOUDFLARE_API_TOKEN`.
- `get_worker_script` returns a shape summary only (content type,
  byte size, body present) — the script body is never returned,
  reproduced, or invented.
- All HTTP flows through an injectable `FetchFn` (types.ts). The test
  suite uses a fake fetch returning hand-written Cloudflare-shaped
  JSON fixtures — **no live call was performed during this build**.

## Verification (exact outputs, all foreground)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced, including `dist/cli.js` with the
`#!/usr/bin/env node` shebang.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 19
ℹ pass 19
ℹ fail 0
```
Covers: missing/blank token error naming CLOUDFLARE_API_TOKEN (and no
request made without a token), account-id resolution (argument over
env fallback, error naming CLOUDFLARE_ACCOUNT_ID), accounts/zones
GET shaping with query parameters, zone get, DNS list filters, DNS
create JSON body with provided-fields-only, DNS update PATCH with
changed-fields-only, DNS delete, cache purge with
purge_everything and with files/tags/hosts arrays, account-scoped
Workers/KV paths, the worker-script shape summary (asserting the
body text never appears in the output), a `success: false` envelope
surfacing its error entries, and HTTP failure propagation.

### 3. CLI / MCP smoke
`--version` → `0.1.0`; unknown command exits 2 with Usage. MCP
`initialize` over stdio → `serverInfo: {"name":"edgeport",
"version":"0.1.0"}`. A `tools/call` for `list_accounts` with
`CLOUDFLARE_API_TOKEN` unset returned `isError: true` with text
"CLOUDFLARE_API_TOKEN environment variable is required: set
CLOUDFLARE_API_TOKEN to a Cloudflare API token and retry"; a
`list_r2_buckets` call with a token set but no account id returned
`isError: true` naming `CLOUDFLARE_ACCOUNT_ID`. CLI calls against the
live API were **not** run (offline build rule for this wave).

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
```
$ python3 parity.py --original fixtures/cloudflare-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/edgeport/dist/cli.js mcp" \
    --out .../builds/edgeport/parity-out
verdict=PASS parity_pct=100.0 original_tools=12 rebuild_tools=12 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
Parity is 100.0% **against the labelled 12-tool core subset** (see
fixture `_source`), not against the full Cloudflare surface.
Original side is tools-file mode, so `fixture_results` records
`SKIPPED-TOOLS-FILE-MODE` — expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was copied from payport's and edited with the
file edit tool: top-level `name`, root package `name`, and root
package `bin` key changed payport -> edgeport (dependency ranges are
identical, so the tree is unchanged). **Clean lockfile regen required
before publish** (regenerate with no `node_modules` present); do not
publish from this lockfile as-is. `node_modules` here is a `cp -a`
copy of payport's (ownership-preservation warnings during the copy
were cosmetic; `.bin/tsc` / `.bin/tsx` verified working).

## Gaps / honest notes

- Core subset: the omitted groups listed above are not implemented.
  In particular there is no Workers bindings deep configuration, no
  rulesets/firewall editing, no Pages/deployments, and no hosted
  docs-search tool.
- No live Cloudflare API call was made (VM egress is blocked and no
  token is available in this environment). Request construction and
  envelope handling are written against the documented endpoint paths
  and payload shapes as captured in the hand-written test fixtures;
  live payload drift is unverified until the publish wave.
- `get_worker_script`'s summary depends on the download endpoint
  returning the script as the response body; if the live API wraps
  the script in a multipart response, the byte size will describe
  that multipart payload — flagged as a first check at publish-wave
  live smoke. The body is still never returned either way.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
