/**
 * edgeport core: a core subset of the Cloudflare API v4.
 *
 * Requests go to https://api.cloudflare.com/client/v4 with the API
 * token from CLOUDFLARE_API_TOKEN sent as a Bearer token. Every JSON
 * endpoint answers in the Cloudflare envelope
 * { success, errors, messages, result }: when success is false the
 * core throws with the envelope's error entries, and on success it
 * returns the unwrapped result value.
 *
 * Account-scoped endpoints (Workers scripts, KV namespaces, R2
 * buckets) take an account_id argument, falling back to the
 * CLOUDFLARE_ACCOUNT_ID value the caller passes in (read from the
 * environment by the MCP/CLI layers). A missing token, or a missing
 * account id where one is required, is an error before any request is
 * made and names the variable to set.
 *
 * get_worker_script deliberately returns only a shape summary of the
 * download (content type, byte size, whether a body was present): the
 * script body itself is code owned by the account holder and is not
 * reproduced, summarised, or invented here.
 *
 * All HTTP goes through an injected FetchFn so request building and
 * envelope handling are fully testable offline.
 */
import type {
  CreateDnsRecordOptions,
  DeleteDnsRecordOptions,
  FetchFn,
  GetWorkerScriptOptions,
  GetZoneOptions,
  ListAccountsOptions,
  ListDnsRecordsOptions,
  ListKvNamespacesOptions,
  ListR2BucketsOptions,
  ListWorkersScriptsOptions,
  ListZonesOptions,
  PurgeCacheOptions,
  UpdateDnsRecordOptions,
  WorkerScriptSummary,
} from "./types.js";

export const VERSION = "0.1.0";

export const API_BASE = "https://api.cloudflare.com/client/v4";

export const API_KEY_ENV = "CLOUDFLARE_API_TOKEN";

export const ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID";

/** The honest missing-key error. Names the variable, never a value. */
export function requireApiKey(apiKey: string | undefined): string {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN environment variable is required: set CLOUDFLARE_API_TOKEN to a Cloudflare API token and retry",
    );
  }
  return key;
}

/**
 * Resolve an account id from the explicit argument first, then the
 * CLOUDFLARE_ACCOUNT_ID fallback the caller supplies.
 */
export function resolveAccountId(
  accountId: string | undefined,
  envAccountId: string | undefined,
): string {
  const fromArg = typeof accountId === "string" ? accountId.trim() : "";
  if (fromArg) return fromArg;
  const fromEnv = typeof envAccountId === "string" ? envAccountId.trim() : "";
  if (fromEnv) return fromEnv;
  throw new Error(
    "account_id is required: pass account_id or set CLOUDFLARE_ACCOUNT_ID to a Cloudflare account id and retry",
  );
}

function requireString(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envelopeErrors(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) return "";
  const parts: string[] = [];
  for (const entry of payload.errors) {
    if (isRecord(entry)) {
      const code = typeof entry.code === "number" || typeof entry.code === "string" ? String(entry.code) : "";
      const message = typeof entry.message === "string" ? entry.message : "";
      const text = [code, message].filter(Boolean).join(" ");
      if (text) parts.push(text);
    } else if (typeof entry === "string") {
      parts.push(entry);
    }
  }
  return parts.join("; ");
}

interface CallOptions {
  method: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
}

async function callCloudflare(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  call: CallOptions,
): Promise<unknown> {
  const key = requireApiKey(apiKey);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(call.query ?? {})) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  const url = `${API_BASE}${call.path}${qs ? `?${qs}` : ""}`;
  const isWrite = call.method !== "GET" && call.method !== "DELETE";
  let response;
  try {
    response = await fetchFn(url, {
      method: call.method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(isWrite ? { "Content-Type": "application/json" } : {}),
      },
      ...(isWrite ? { body: JSON.stringify(call.body ?? {}) } : {}),
    });
  } catch (err) {
    throw new Error(
      `Cloudflare API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `Cloudflare API request failed: HTTP ${response.status} with a response that was not valid JSON`,
    );
  }
  const detail = envelopeErrors(payload);
  if (isRecord(payload) && payload.success === false) {
    throw new Error(
      `Cloudflare API request failed: ${detail || `HTTP ${response.status}`}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Cloudflare API request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail ? `: ${detail}` : ""}`,
    );
  }
  if (isRecord(payload) && "result" in payload) return payload.result;
  return payload;
}

export async function listAccounts(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ListAccountsOptions,
): Promise<unknown> {
  return callCloudflare(fetchFn, apiKey, {
    method: "GET",
    path: "/accounts",
    query: { per_page: options.per_page },
  });
}

export async function listZones(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ListZonesOptions,
): Promise<unknown> {
  return callCloudflare(fetchFn, apiKey, {
    method: "GET",
    path: "/zones",
    query: {
      "account.id": options.account_id,
      name: options.name,
      per_page: options.per_page,
    },
  });
}

export async function getZone(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: GetZoneOptions,
): Promise<unknown> {
  const zoneId = encodeURIComponent(requireString(options.zone_id, "zone_id"));
  return callCloudflare(fetchFn, apiKey, { method: "GET", path: `/zones/${zoneId}` });
}

export async function listDnsRecords(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ListDnsRecordsOptions,
): Promise<unknown> {
  const zoneId = encodeURIComponent(requireString(options.zone_id, "zone_id"));
  return callCloudflare(fetchFn, apiKey, {
    method: "GET",
    path: `/zones/${zoneId}/dns_records`,
    query: { type: options.type, name: options.name, per_page: options.per_page },
  });
}

export async function createDnsRecord(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CreateDnsRecordOptions,
): Promise<unknown> {
  const zoneId = encodeURIComponent(requireString(options.zone_id, "zone_id"));
  const body: Record<string, unknown> = {
    type: requireString(options.type, "type"),
    name: requireString(options.name, "name"),
    content: requireString(options.content, "content"),
  };
  if (options.ttl !== undefined) body.ttl = options.ttl;
  if (options.proxied !== undefined) body.proxied = options.proxied;
  if (options.comment !== undefined) body.comment = options.comment;
  return callCloudflare(fetchFn, apiKey, {
    method: "POST",
    path: `/zones/${zoneId}/dns_records`,
    body,
  });
}

export async function updateDnsRecord(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: UpdateDnsRecordOptions,
): Promise<unknown> {
  const zoneId = encodeURIComponent(requireString(options.zone_id, "zone_id"));
  const recordId = encodeURIComponent(requireString(options.record_id, "record_id"));
  const body: Record<string, unknown> = {};
  if (options.type !== undefined) body.type = options.type;
  if (options.name !== undefined) body.name = options.name;
  if (options.content !== undefined) body.content = options.content;
  if (options.ttl !== undefined) body.ttl = options.ttl;
  if (options.proxied !== undefined) body.proxied = options.proxied;
  if (options.comment !== undefined) body.comment = options.comment;
  return callCloudflare(fetchFn, apiKey, {
    method: "PATCH",
    path: `/zones/${zoneId}/dns_records/${recordId}`,
    body,
  });
}

export async function deleteDnsRecord(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: DeleteDnsRecordOptions,
): Promise<unknown> {
  const zoneId = encodeURIComponent(requireString(options.zone_id, "zone_id"));
  const recordId = encodeURIComponent(requireString(options.record_id, "record_id"));
  return callCloudflare(fetchFn, apiKey, {
    method: "DELETE",
    path: `/zones/${zoneId}/dns_records/${recordId}`,
  });
}

export async function purgeCache(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: PurgeCacheOptions,
): Promise<unknown> {
  const zoneId = encodeURIComponent(requireString(options.zone_id, "zone_id"));
  const body: Record<string, unknown> = {};
  if (options.purge_everything !== undefined) body.purge_everything = options.purge_everything;
  if (options.files !== undefined) body.files = options.files;
  if (options.tags !== undefined) body.tags = options.tags;
  if (options.hosts !== undefined) body.hosts = options.hosts;
  return callCloudflare(fetchFn, apiKey, {
    method: "POST",
    path: `/zones/${zoneId}/purge_cache`,
    body,
  });
}

export async function listWorkersScripts(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  envAccountId: string | undefined,
  options: ListWorkersScriptsOptions,
): Promise<unknown> {
  const accountId = encodeURIComponent(resolveAccountId(options.account_id, envAccountId));
  return callCloudflare(fetchFn, apiKey, {
    method: "GET",
    path: `/accounts/${accountId}/workers/scripts`,
  });
}

/**
 * Download a Worker script and report only its shape: content type,
 * byte size, and whether a body came back. The body is never returned.
 */
export async function getWorkerScript(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  envAccountId: string | undefined,
  options: GetWorkerScriptOptions,
): Promise<WorkerScriptSummary> {
  const key = requireApiKey(apiKey);
  const accountId = encodeURIComponent(resolveAccountId(options.account_id, envAccountId));
  const scriptName = encodeURIComponent(requireString(options.script_name, "script_name"));
  const url = `${API_BASE}/accounts/${accountId}/workers/scripts/${scriptName}`;
  let response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "*/*" },
    });
  } catch (err) {
    throw new Error(
      `Cloudflare API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Cloudflare API request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
    );
  }
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  return {
    script_name: options.script_name,
    content_type: response.headers.get("content-type"),
    size_bytes: new TextEncoder().encode(body).length,
    body_present: body.length > 0,
  };
}

export async function listKvNamespaces(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  envAccountId: string | undefined,
  options: ListKvNamespacesOptions,
): Promise<unknown> {
  const accountId = encodeURIComponent(resolveAccountId(options.account_id, envAccountId));
  return callCloudflare(fetchFn, apiKey, {
    method: "GET",
    path: `/accounts/${accountId}/storage/kv/namespaces`,
  });
}

export async function listR2Buckets(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  envAccountId: string | undefined,
  options: ListR2BucketsOptions,
): Promise<unknown> {
  const accountId = encodeURIComponent(resolveAccountId(options.account_id, envAccountId));
  return callCloudflare(fetchFn, apiKey, {
    method: "GET",
    path: `/accounts/${accountId}/r2/buckets`,
  });
}

/** Render an API result as the JSON text block MCP clients display. */
export function formatResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
