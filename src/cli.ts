#!/usr/bin/env node
/**
 * edgeport CLI.
 *
 *   edgeport list-accounts [--per-page n]
 *   edgeport list-zones [--account-id <id>] [--name <name>]
 *   edgeport get-zone --zone-id <id>
 *   edgeport list-dns --zone-id <id> [--type <type>] [--name <name>]
 *   edgeport purge-cache --zone-id <id> [--everything]
 *   edgeport list-workers [--account-id <id>]
 *   edgeport list-kv [--account-id <id>]
 *   edgeport list-r2 [--account-id <id>]
 *   edgeport mcp
 *
 * Reads the API token from CLOUDFLARE_API_TOKEN and the account
 * fallback from CLOUDFLARE_ACCOUNT_ID.
 * Exit codes: 0 success, 1 API error, 2 usage error.
 */
import {
  ACCOUNT_ID_ENV,
  API_KEY_ENV,
  formatResult,
  getZone,
  listAccounts,
  listDnsRecords,
  listKvNamespaces,
  listR2Buckets,
  listWorkersScripts,
  listZones,
  purgeCache,
  VERSION,
} from "./cloudflare.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  edgeport list-accounts [--per-page n]
  edgeport list-zones [--account-id <id>] [--name <name>]
  edgeport get-zone --zone-id <id>
  edgeport list-dns --zone-id <id> [--type <type>] [--name <name>]
  edgeport purge-cache --zone-id <id> [--everything]
  edgeport list-workers [--account-id <id>]
  edgeport list-kv [--account-id <id>]
  edgeport list-r2 [--account-id <id>]
  edgeport mcp
  edgeport --version`);
  process.exit(2);
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function numFlag(args: string[], name: string): number | undefined {
  const raw = flagValue(args, name);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const apiKey = process.env[API_KEY_ENV];
  const envAccountId = process.env[ACCOUNT_ID_ENV];
  const known = [
    "list-accounts",
    "list-zones",
    "get-zone",
    "list-dns",
    "purge-cache",
    "list-workers",
    "list-kv",
    "list-r2",
  ];
  if (!known.includes(cmd)) usage();
  try {
    let out: unknown;
    if (cmd === "list-accounts") {
      out = await listAccounts(fetchFn, apiKey, { per_page: numFlag(rest, "--per-page") });
    } else if (cmd === "list-zones") {
      out = await listZones(fetchFn, apiKey, {
        account_id: flagValue(rest, "--account-id"),
        name: flagValue(rest, "--name"),
      });
    } else if (cmd === "get-zone") {
      const zoneId = flagValue(rest, "--zone-id");
      if (!zoneId) usage();
      out = await getZone(fetchFn, apiKey, { zone_id: zoneId });
    } else if (cmd === "list-dns") {
      const zoneId = flagValue(rest, "--zone-id");
      if (!zoneId) usage();
      out = await listDnsRecords(fetchFn, apiKey, {
        zone_id: zoneId,
        type: flagValue(rest, "--type"),
        name: flagValue(rest, "--name"),
      });
    } else if (cmd === "purge-cache") {
      const zoneId = flagValue(rest, "--zone-id");
      if (!zoneId) usage();
      out = await purgeCache(fetchFn, apiKey, {
        zone_id: zoneId,
        purge_everything: rest.includes("--everything") ? true : undefined,
      });
    } else if (cmd === "list-workers") {
      out = await listWorkersScripts(fetchFn, apiKey, envAccountId, {
        account_id: flagValue(rest, "--account-id"),
      });
    } else if (cmd === "list-kv") {
      out = await listKvNamespaces(fetchFn, apiKey, envAccountId, {
        account_id: flagValue(rest, "--account-id"),
      });
    } else {
      out = await listR2Buckets(fetchFn, apiKey, envAccountId, {
        account_id: flagValue(rest, "--account-id"),
      });
    }
    console.log(formatResult(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
