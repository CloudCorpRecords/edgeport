import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDnsRecord,
  deleteDnsRecord,
  getWorkerScript,
  getZone,
  listAccounts,
  listDnsRecords,
  listKvNamespaces,
  listWorkersScripts,
  listZones,
  purgeCache,
  requireApiKey,
  resolveAccountId,
  updateDnsRecord,
} from "../src/cloudflare.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

function jsonResponse(body: unknown, status = 200, statusText = "OK"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function envelope(result: unknown) {
  return { success: true, errors: [], messages: [], result };
}

interface Captured {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function fakeFetch(captured: Captured, body: unknown = envelope({ id: "x" })): FetchFn {
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    captured.url = url;
    captured.method = init?.method;
    captured.headers = init?.headers;
    captured.body = init?.body;
    return jsonResponse(body);
  };
}

describe("requireApiKey", () => {
  it("rejects a missing or blank token with an error naming CLOUDFLARE_API_TOKEN", () => {
    assert.throws(() => requireApiKey(undefined), /CLOUDFLARE_API_TOKEN/);
    assert.throws(() => requireApiKey("   "), /CLOUDFLARE_API_TOKEN/);
    assert.equal(requireApiKey(" tok "), "tok");
  });

  it("fails before any request when the token is missing", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse(envelope([]));
    };
    await assert.rejects(() => listAccounts(spy, undefined, {}), /CLOUDFLARE_API_TOKEN/);
    assert.equal(called, false);
  });
});

describe("resolveAccountId", () => {
  it("prefers the argument, falls back to the env value, else names CLOUDFLARE_ACCOUNT_ID", () => {
    assert.equal(resolveAccountId("acc_arg", "acc_env"), "acc_arg");
    assert.equal(resolveAccountId(undefined, "acc_env"), "acc_env");
    assert.throws(() => resolveAccountId(undefined, undefined), /CLOUDFLARE_ACCOUNT_ID/);
    assert.throws(() => resolveAccountId("  ", " "), /account_id is required/);
  });
});

describe("listAccounts and listZones", () => {
  it("GETs /accounts with the Bearer token and unwraps the envelope result", async () => {
    const captured: Captured = {};
    const out = (await listAccounts(
      fakeFetch(captured, envelope([{ id: "acc_1", name: "Main" }])),
      "tok",
      {},
    )) as Array<{ id: string }>;
    assert.equal(out[0]?.id, "acc_1");
    const url = new URL(captured.url ?? "");
    assert.equal(url.pathname, "/client/v4/accounts");
    assert.equal(captured.headers?.Authorization, "Bearer tok");
    assert.equal(captured.method, "GET");
  });

  it("GETs /zones with account.id, name and per_page query parameters", async () => {
    const captured: Captured = {};
    await listZones(fakeFetch(captured, envelope([])), "tok", {
      account_id: "acc_1",
      name: "example.com",
      per_page: 5,
    });
    const url = new URL(captured.url ?? "");
    assert.equal(url.pathname, "/client/v4/zones");
    assert.equal(url.searchParams.get("account.id"), "acc_1");
    assert.equal(url.searchParams.get("name"), "example.com");
    assert.equal(url.searchParams.get("per_page"), "5");
  });
});

describe("zones and DNS records", () => {
  it("GETs one zone by id", async () => {
    const captured: Captured = {};
    const out = (await getZone(fakeFetch(captured, envelope({ id: "zone_1" })), "tok", {
      zone_id: "zone_1",
    })) as { id: string };
    assert.equal(out.id, "zone_1");
    assert.equal(new URL(captured.url ?? "").pathname, "/client/v4/zones/zone_1");
  });

  it("lists DNS records with type and name filters", async () => {
    const captured: Captured = {};
    await listDnsRecords(fakeFetch(captured, envelope([])), "tok", {
      zone_id: "zone_1",
      type: "A",
      name: "www.example.com",
    });
    const url = new URL(captured.url ?? "");
    assert.equal(url.pathname, "/client/v4/zones/zone_1/dns_records");
    assert.equal(url.searchParams.get("type"), "A");
    assert.equal(url.searchParams.get("name"), "www.example.com");
  });

  it("creates a DNS record with a JSON body of the provided fields only", async () => {
    const captured: Captured = {};
    await createDnsRecord(fakeFetch(captured, envelope({ id: "rec_1" })), "tok", {
      zone_id: "zone_1",
      type: "A",
      name: "www.example.com",
      content: "192.0.2.10",
      ttl: 300,
      proxied: true,
    });
    assert.equal(captured.method, "POST");
    assert.equal(captured.headers?.["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(captured.body ?? "{}"), {
      type: "A",
      name: "www.example.com",
      content: "192.0.2.10",
      ttl: 300,
      proxied: true,
    });
  });

  it("updates a DNS record with PATCH and only the changed fields", async () => {
    const captured: Captured = {};
    await updateDnsRecord(fakeFetch(captured, envelope({ id: "rec_1" })), "tok", {
      zone_id: "zone_1",
      record_id: "rec_1",
      content: "192.0.2.20",
    });
    const url = new URL(captured.url ?? "");
    assert.equal(url.pathname, "/client/v4/zones/zone_1/dns_records/rec_1");
    assert.equal(captured.method, "PATCH");
    assert.deepEqual(JSON.parse(captured.body ?? "{}"), { content: "192.0.2.20" });
  });

  it("deletes a DNS record with DELETE", async () => {
    const captured: Captured = {};
    await deleteDnsRecord(fakeFetch(captured, envelope({ id: "rec_1" })), "tok", {
      zone_id: "zone_1",
      record_id: "rec_1",
    });
    assert.equal(captured.method, "DELETE");
    assert.equal(
      new URL(captured.url ?? "").pathname,
      "/client/v4/zones/zone_1/dns_records/rec_1",
    );
  });

  it("rejects an empty zone_id before any request", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse(envelope({}));
    };
    await assert.rejects(() => getZone(spy, "tok", { zone_id: " " }), /non-empty/);
    assert.equal(called, false);
  });
});

describe("purgeCache", () => {
  it("POSTs purge_everything to /zones/:id/purge_cache", async () => {
    const captured: Captured = {};
    await purgeCache(fakeFetch(captured, envelope({ id: "zone_1" })), "tok", {
      zone_id: "zone_1",
      purge_everything: true,
    });
    assert.equal(new URL(captured.url ?? "").pathname, "/client/v4/zones/zone_1/purge_cache");
    assert.deepEqual(JSON.parse(captured.body ?? "{}"), { purge_everything: true });
  });

  it("POSTs files, tags and hosts arrays when given", async () => {
    const captured: Captured = {};
    await purgeCache(fakeFetch(captured, envelope({})), "tok", {
      zone_id: "zone_1",
      files: ["https://example.com/a.css"],
      tags: ["product"],
      hosts: ["example.com"],
    });
    assert.deepEqual(JSON.parse(captured.body ?? "{}"), {
      files: ["https://example.com/a.css"],
      tags: ["product"],
      hosts: ["example.com"],
    });
  });
});

describe("account-scoped endpoints", () => {
  it("lists Worker scripts under the env-fallback account id", async () => {
    const captured: Captured = {};
    await listWorkersScripts(fakeFetch(captured, envelope([])), "tok", "acc_env", {});
    assert.equal(
      new URL(captured.url ?? "").pathname,
      "/client/v4/accounts/acc_env/workers/scripts",
    );
  });

  it("lists KV namespaces under an explicit account id", async () => {
    const captured: Captured = {};
    await listKvNamespaces(fakeFetch(captured, envelope([])), "tok", "acc_env", {
      account_id: "acc_arg",
    });
    assert.equal(
      new URL(captured.url ?? "").pathname,
      "/client/v4/accounts/acc_arg/storage/kv/namespaces",
    );
  });

  it("fails naming CLOUDFLARE_ACCOUNT_ID when no account id is available", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse(envelope([]));
    };
    await assert.rejects(
      () => listWorkersScripts(spy, "tok", undefined, {}),
      /CLOUDFLARE_ACCOUNT_ID/,
    );
    assert.equal(called, false);
  });
});

describe("getWorkerScript", () => {
  it("returns a shape summary only and never the script body", async () => {
    const bodyText = "export default { fetch() { return new Response('hi'); } }";
    const rawFetch: FetchFn = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "application/javascript" : null,
      },
      text: async () => bodyText,
      json: async () => {
        throw new Error("not json");
      },
    });
    const out = await getWorkerScript(rawFetch, "tok", undefined, {
      account_id: "acc_1",
      script_name: "hello-worker",
    });
    assert.equal(out.script_name, "hello-worker");
    assert.equal(out.content_type, "application/javascript");
    assert.equal(out.size_bytes, new TextEncoder().encode(bodyText).length);
    assert.equal(out.body_present, true);
    assert.ok(!JSON.stringify(out).includes("Response('hi')"));
  });
});

describe("envelope error handling", () => {
  it("turns a success:false envelope into an error carrying the API error entries", async () => {
    const failing: FetchFn = async () =>
      jsonResponse(
        {
          success: false,
          errors: [{ code: 1001, message: "Zone not found" }],
          messages: [],
          result: null,
        },
        404,
        "Not Found",
      );
    await assert.rejects(() => getZone(failing, "tok", { zone_id: "zone_x" }), /1001 Zone not found/);
  });

  it("surfaces an HTTP failure even without envelope errors", async () => {
    const failing: FetchFn = async () =>
      jsonResponse({ success: false, errors: [], messages: [], result: null }, 500, "Server Error");
    await assert.rejects(() => listAccounts(failing, "tok", {}), /Cloudflare API request failed/);
  });
});
