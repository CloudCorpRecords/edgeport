/**
 * edgeport types.
 *
 * Each operation mirrors one documented Cloudflare API v4 endpoint.
 * Account-scoped operations accept an optional account_id; when it is
 * omitted the core falls back to the CLOUDFLARE_ACCOUNT_ID environment
 * value supplied by the caller. Responses from Cloudflare arrive in
 * the standard { success, errors, messages, result } envelope, and the
 * core unwraps and returns the result value.
 *
 * HTTP access is described by a minimal response surface so tests can
 * inject a fake fetch and never touch the network.
 */

export interface ListAccountsOptions {
  per_page?: number;
}

export interface ListZonesOptions {
  account_id?: string;
  name?: string;
  per_page?: number;
}

export interface GetZoneOptions {
  zone_id: string;
}

export interface ListDnsRecordsOptions {
  zone_id: string;
  type?: string;
  name?: string;
  per_page?: number;
}

export interface CreateDnsRecordOptions {
  zone_id: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
}

export interface UpdateDnsRecordOptions {
  zone_id: string;
  record_id: string;
  type?: string;
  name?: string;
  content?: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
}

export interface DeleteDnsRecordOptions {
  zone_id: string;
  record_id: string;
}

export interface PurgeCacheOptions {
  zone_id: string;
  purge_everything?: boolean;
  files?: string[];
  tags?: string[];
  hosts?: string[];
}

export interface ListWorkersScriptsOptions {
  account_id?: string;
}

export interface GetWorkerScriptOptions {
  account_id?: string;
  script_name: string;
}

export interface ListKvNamespacesOptions {
  account_id?: string;
}

export interface ListR2BucketsOptions {
  account_id?: string;
}

/** Shape-only summary returned for a Worker script download. */
export interface WorkerScriptSummary {
  script_name: string;
  content_type: string | null;
  size_bytes: number;
  body_present: boolean;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;
