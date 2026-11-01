# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- MCP server (`edgeport mcp`, stdio) with 12 tools covering a core
  subset of the Cloudflare API v4: accounts, zones, DNS records
  (list/create/update/delete), cache purge, Worker script listing and
  shape-only download summary, KV namespace listing, and R2 bucket
  listing.
- CLI: `edgeport list-accounts`, `list-zones`, `get-zone`, `list-dns`,
  `purge-cache`, `list-workers`, `list-kv`, and `list-r2`; the API
  token is read from `CLOUDFLARE_API_TOKEN` and the account fallback
  from `CLOUDFLARE_ACCOUNT_ID`.
- Calls go to `https://api.cloudflare.com/client/v4` with the token
  sent as a Bearer token; the Cloudflare `{success, errors, result}`
  envelope is unwrapped, and a `success: false` envelope becomes an
  error carrying the API's error entries.
- A missing `CLOUDFLARE_API_TOKEN` (or a missing account id where one
  is required) fails honestly with an error naming the variable,
  before any request is made.
- All HTTP goes through an injectable fetch function, so the test
  suite runs entirely on hand-written fixtures with no network access.
