/**
 * edgeport MCP server. Tools (12, the documented Cloudflare API v4
 * core subset): list_accounts, list_zones, get_zone, list_dns_records,
 * create_dns_record, update_dns_record, delete_dns_record,
 * purge_cache, list_workers_scripts, get_worker_script,
 * list_kv_namespaces, list_r2_buckets.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"), which
 * breaks exact tool-list/schema parity with the spec. This file serves
 * tools/list with the spec's exact input schemas as explicit literals,
 * while zod still validates every tools/call argument set.
 *
 * The API token is read from CLOUDFLARE_API_TOKEN at call time (and
 * CLOUDFLARE_ACCOUNT_ID as the account fallback); a missing value
 * returns an honest isError result naming the variable instead of
 * failing the handshake.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ACCOUNT_ID_ENV,
  API_KEY_ENV,
  createDnsRecord,
  deleteDnsRecord,
  formatResult,
  getWorkerScript,
  getZone,
  listAccounts,
  listDnsRecords,
  listKvNamespaces,
  listR2Buckets,
  listWorkersScripts,
  listZones,
  purgeCache,
  updateDnsRecord,
  VERSION,
} from "./cloudflare.js";
import type { FetchFn } from "./types.js";

const ListAccountsArgs = z.object({ per_page: z.number().int().optional() });
const ListZonesArgs = z.object({
  account_id: z.string().optional(),
  name: z.string().optional(),
  per_page: z.number().int().optional(),
});
const GetZoneArgs = z.object({ zone_id: z.string() });
const ListDnsRecordsArgs = z.object({
  zone_id: z.string(),
  type: z.string().optional(),
  name: z.string().optional(),
  per_page: z.number().int().optional(),
});
const CreateDnsRecordArgs = z.object({
  zone_id: z.string(),
  type: z.string(),
  name: z.string(),
  content: z.string(),
  ttl: z.number().int().optional(),
  proxied: z.boolean().optional(),
  comment: z.string().optional(),
});
const UpdateDnsRecordArgs = z.object({
  zone_id: z.string(),
  record_id: z.string(),
  type: z.string().optional(),
  name: z.string().optional(),
  content: z.string().optional(),
  ttl: z.number().int().optional(),
  proxied: z.boolean().optional(),
  comment: z.string().optional(),
});
const DeleteDnsRecordArgs = z.object({ zone_id: z.string(), record_id: z.string() });
const PurgeCacheArgs = z.object({
  zone_id: z.string(),
  purge_everything: z.boolean().optional(),
  files: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  hosts: z.array(z.string()).optional(),
});
const ListWorkersScriptsArgs = z.object({ account_id: z.string().optional() });
const GetWorkerScriptArgs = z.object({
  account_id: z.string().optional(),
  script_name: z.string(),
});
const ListKvNamespacesArgs = z.object({ account_id: z.string().optional() });
const ListR2BucketsArgs = z.object({ account_id: z.string().optional() });

const TOOLS = [
  {
    name: "list_accounts",
    description: "List Cloudflare accounts accessible with the API token.",
    inputSchema: {
      type: "object" as const,
      properties: { per_page: { type: "integer", description: "Maximum number of accounts to return per page of results." } },
      required: [] as string[],
    },
  },
  {
    name: "list_zones",
    description: "List zones, optionally filtered by account or name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        account_id: { type: "string", description: "Cloudflare account identifier to restrict the zone list to zones in that account." },
        name: { type: "string", description: "Zone (domain) name to filter the zone list by exact name match." },
        per_page: { type: "integer", description: "Maximum number of zones to return per page of results." },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_zone",
    description: "Get one zone by its id.",
    inputSchema: {
      type: "object" as const,
      properties: { zone_id: { type: "string", description: "Identifier of the Cloudflare zone to retrieve." } },
      required: ["zone_id"],
    },
  },
  {
    name: "list_dns_records",
    description: "List DNS records in a zone, optionally filtered by type or name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        zone_id: { type: "string", description: "Identifier of the zone whose DNS records should be listed." },
        type: { type: "string", description: "DNS record type (such as A, AAAA, CNAME, or MX) to filter records by." },
        name: { type: "string", description: "DNS record name to filter records by." },
        per_page: { type: "integer", description: "Maximum number of DNS records to return per page of results." },
      },
      required: ["zone_id"],
    },
  },
  {
    name: "create_dns_record",
    description: "Create a DNS record in a zone.",
    inputSchema: {
      type: "object" as const,
      properties: {
        zone_id: { type: "string", description: "Identifier of the zone in which to create the DNS record." },
        type: { type: "string", description: "DNS record type to create, such as A, AAAA, CNAME, or MX." },
        name: { type: "string", description: "Name of the DNS record, such as a hostname within the zone." },
        content: { type: "string", description: "Content of the DNS record, such as an IP address or target hostname." },
        ttl: { type: "integer", description: "Time to live in seconds for the DNS record, where 1 means automatic." },
        proxied: { type: "boolean", description: "Whether Cloudflare should proxy traffic through its network for this record." },
        comment: { type: "string", description: "Optional comment describing the DNS record." },
      },
      required: ["zone_id", "type", "name", "content"],
    },
  },
  {
    name: "update_dns_record",
    description: "Update a DNS record in a zone.",
    inputSchema: {
      type: "object" as const,
      properties: {
        zone_id: { type: "string", description: "Identifier of the zone containing the DNS record to update." },
        record_id: { type: "string", description: "Identifier of the DNS record to update." },
        type: { type: "string", description: "New DNS record type, such as A, AAAA, CNAME, or MX." },
        name: { type: "string", description: "New name for the DNS record, such as a hostname within the zone." },
        content: { type: "string", description: "New content for the DNS record, such as an IP address or target hostname." },
        ttl: { type: "integer", description: "New time to live in seconds for the DNS record, where 1 means automatic." },
        proxied: { type: "boolean", description: "Whether Cloudflare should proxy traffic through its network for this record." },
        comment: { type: "string", description: "New comment describing the DNS record." },
      },
      required: ["zone_id", "record_id"],
    },
  },
  {
    name: "delete_dns_record",
    description: "Delete a DNS record from a zone.",
    inputSchema: {
      type: "object" as const,
      properties: {
        zone_id: { type: "string", description: "Identifier of the zone containing the DNS record to delete." },
        record_id: { type: "string", description: "Identifier of the DNS record to delete." },
      },
      required: ["zone_id", "record_id"],
    },
  },
  {
    name: "purge_cache",
    description: "Purge cached content for a zone, by file, tag, host, or everything.",
    inputSchema: {
      type: "object" as const,
      properties: {
        zone_id: { type: "string", description: "Identifier of the zone whose cache should be purged." },
        purge_everything: { type: "boolean", description: "Whether to purge all cached content for the zone." },
        files: { type: "array", items: { type: "string" }, description: "List of URLs whose cached content should be purged." },
        tags: { type: "array", items: { type: "string" }, description: "List of cache tags whose associated cached content should be purged." },
        hosts: { type: "array", items: { type: "string" }, description: "List of hostnames whose cached content should be purged." },
      },
      required: ["zone_id"],
    },
  },
  {
    name: "list_workers_scripts",
    description: "List Worker scripts in an account.",
    inputSchema: {
      type: "object" as const,
      properties: { account_id: { type: "string", description: "Identifier of the account whose Worker scripts should be listed, falling back to CLOUDFLARE_ACCOUNT_ID when omitted." } },
      required: [] as string[],
    },
  },
  {
    name: "get_worker_script",
    description: "Get a Worker script's metadata and shape only, without its body.",
    inputSchema: {
      type: "object" as const,
      properties: {
        account_id: { type: "string", description: "Identifier of the account containing the Worker script, falling back to CLOUDFLARE_ACCOUNT_ID when omitted." },
        script_name: { type: "string", description: "Name of the Worker script to inspect." },
      },
      required: ["script_name"],
    },
  },
  {
    name: "list_kv_namespaces",
    description: "List Workers KV namespaces in an account.",
    inputSchema: {
      type: "object" as const,
      properties: { account_id: { type: "string", description: "Identifier of the account whose KV namespaces should be listed, falling back to CLOUDFLARE_ACCOUNT_ID when omitted." } },
      required: [] as string[],
    },
  },
  {
    name: "list_r2_buckets",
    description: "List R2 buckets in an account.",
    inputSchema: {
      type: "object" as const,
      properties: { account_id: { type: "string", description: "Identifier of the account whose R2 buckets should be listed, falling back to CLOUDFLARE_ACCOUNT_ID when omitted." } },
      required: [] as string[],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "edgeport", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const apiKey = process.env[API_KEY_ENV];
  const envAccountId = process.env[ACCOUNT_ID_ENV];
  try {
    let out: unknown;
    if (name === "list_accounts") {
      out = await listAccounts(fetchFn, apiKey, ListAccountsArgs.parse(args ?? {}));
    } else if (name === "list_zones") {
      out = await listZones(fetchFn, apiKey, ListZonesArgs.parse(args ?? {}));
    } else if (name === "get_zone") {
      out = await getZone(fetchFn, apiKey, GetZoneArgs.parse(args ?? {}));
    } else if (name === "list_dns_records") {
      out = await listDnsRecords(fetchFn, apiKey, ListDnsRecordsArgs.parse(args ?? {}));
    } else if (name === "create_dns_record") {
      out = await createDnsRecord(fetchFn, apiKey, CreateDnsRecordArgs.parse(args ?? {}));
    } else if (name === "update_dns_record") {
      out = await updateDnsRecord(fetchFn, apiKey, UpdateDnsRecordArgs.parse(args ?? {}));
    } else if (name === "delete_dns_record") {
      out = await deleteDnsRecord(fetchFn, apiKey, DeleteDnsRecordArgs.parse(args ?? {}));
    } else if (name === "purge_cache") {
      out = await purgeCache(fetchFn, apiKey, PurgeCacheArgs.parse(args ?? {}));
    } else if (name === "list_workers_scripts") {
      out = await listWorkersScripts(fetchFn, apiKey, envAccountId, ListWorkersScriptsArgs.parse(args ?? {}));
    } else if (name === "get_worker_script") {
      out = await getWorkerScript(fetchFn, apiKey, envAccountId, GetWorkerScriptArgs.parse(args ?? {}));
    } else if (name === "list_kv_namespaces") {
      out = await listKvNamespaces(fetchFn, apiKey, envAccountId, ListKvNamespacesArgs.parse(args ?? {}));
    } else if (name === "list_r2_buckets") {
      out = await listR2Buckets(fetchFn, apiKey, envAccountId, ListR2BucketsArgs.parse(args ?? {}));
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatResult(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
