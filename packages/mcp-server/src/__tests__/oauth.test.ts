/**
 * GREEN tests for `packages/mcp-server/src/oauth.ts` (OAuth `defaultHandler`).
 *
 * Wave 2 (Plan 03-04) turn of the Wave 0 RED stubs. Tests directly invoke
 * `defaultHandler.fetch(request, env, ctx)` with a mock env — no DO needed
 * since defaultHandler is a plain `ExportedHandler`. The `agents/mcp`
 * `McpAgent` path (`/mcp`) is OUT of scope for this file; OAuthProvider
 * dispatches that to `EngramMcp.serve("/mcp")` instead.
 *
 * Defense-in-depth contracts asserted GREEN:
 *   - T-03-JWT (Spoofing): unauthenticated `/` and `/health` succeed without
 *     any Authorization header — D-08 public routes by design. The library
 *     dispatches these to defaultHandler because they don't match
 *     `apiRoute: "/mcp"`.
 *   - T-03-PROPS (Spoofing/EoP): `/authorize` calls
 *     `env.OAUTH_PROVIDER.completeAuthorization` with `props === {
 *     workspace_id, user_id }` — EXACTLY 2 keys, sourced ONLY from the
 *     `ENGRAM_IDENTITIES` KV record. Asserted via `Object.keys(props)`
 *     ordering AND a deep-equal on the props value.
 *   - T-03-KV-LEAK (Information Disclosure): the 403 body on missing KV
 *     contains "Unknown OAuth subject" but NEVER any JSON.stringify of the
 *     KV value (the KV value is null on miss anyway; the structural
 *     assertion is in oauth.ts).
 *   - T-03-PARSE (Tampering): malformed KV JSON triggers a 500 with the
 *     SANITIZED literal "Internal error: corrupt identity record" — never
 *     echoing the raw value content.
 *
 * Test-pool note: the workerd test pool (`@cloudflare/vitest-pool-workers`)
 * runs these tests inside a real Workers isolate. Calling
 * `defaultHandler.fetch(request, env, ctx)` works the same as in production
 * because the handler is a POJO with a `fetch` method — no DO binding
 * resolution required. Mocks are built inline via `vi.fn()`.
 *
 * @module @engram/mcp-server/__tests__/oauth
 */
import { describe, it, expect, vi } from "vitest";

import { defaultHandler } from "../oauth.js";

// ---------------------------------------------------------------------------
// Mock-env helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock env satisfying `defaultHandler.fetch`'s second-arg shape.
 *
 * Returns:
 *   - ENGRAM_IDENTITIES.get: `vi.fn()` (default resolves null — override per case)
 *   - OAUTH_PROVIDER.{parseAuthRequest, lookupClient, completeAuthorization}:
 *     `vi.fn()` with sensible defaults (clientId "test-sub", redirect cb URL)
 *
 * The return type is loose (`unknown`) because defaultHandler's `Env` is the
 * production-typed `EngramOAuthEnv` and our mocks satisfy only the surface
 * the handler actually touches. We cast at the call site.
 */
function makeMockEnv(
  overrides: {
    identityGet?: ReturnType<typeof vi.fn>;
    parseAuthRequest?: ReturnType<typeof vi.fn>;
    lookupClient?: ReturnType<typeof vi.fn>;
    completeAuthorization?: ReturnType<typeof vi.fn>;
  } = {},
): {
  ENGRAM_IDENTITIES: { get: ReturnType<typeof vi.fn> };
  OAUTH_PROVIDER: {
    parseAuthRequest: ReturnType<typeof vi.fn>;
    lookupClient: ReturnType<typeof vi.fn>;
    completeAuthorization: ReturnType<typeof vi.fn>;
  };
} {
  return {
    ENGRAM_IDENTITIES: {
      get: overrides.identityGet ?? vi.fn().mockResolvedValue(null),
    },
    OAUTH_PROVIDER: {
      parseAuthRequest:
        overrides.parseAuthRequest ?? vi.fn().mockResolvedValue({ clientId: "test-sub" }),
      lookupClient: overrides.lookupClient ?? vi.fn().mockResolvedValue(undefined),
      completeAuthorization:
        overrides.completeAuthorization ??
        vi.fn().mockResolvedValue({ redirectTo: "https://example.dev/cb?code=x" }),
    },
  };
}

/**
 * Invoke `defaultHandler.fetch` with the mock env. Wraps the type-coercion at
 * the boundary so individual tests stay readable.
 */
async function callFetch(request: Request, env: ReturnType<typeof makeMockEnv>): Promise<Response> {
  // defaultHandler.fetch is declared with the production Env type. The mock
  // env satisfies only the subset of fields the handler touches; the cast
  // here is a TS-level narrowing only.
  const fetcher = defaultHandler.fetch;
  if (fetcher === undefined) {
    throw new Error("defaultHandler.fetch is undefined");
  }
  // ExecutionContext is intentionally undefined-cast — the handler omits the
  // ctx parameter (see oauth.ts comment), so it never touches the value.
  // The Request cast bridges `Request<unknown, CfProperties>` (constructed
  // via `new Request(url)`) and the handler's
  // `Request<unknown, IncomingRequestCfProperties>` expected shape; the
  // handler reads only `request.url`, so the extra Cloudflare-incoming
  // fields are never accessed.
  const result = fetcher.call(
    defaultHandler,
    request as unknown as Parameters<typeof fetcher>[0],
    env as unknown as Parameters<typeof fetcher>[1],
    undefined as unknown as Parameters<typeof fetcher>[2],
  );
  return await result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("oauth defaultHandler — public routes (D-08)", () => {
  it("GET / returns 200 with project info JSON (name, version, mcp, oauth)", async () => {
    const env = makeMockEnv();
    const response = await callFetch(new Request("https://example.dev/"), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("application/json");

    const body = await response.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      name: "engram-mcp-server",
      mcp: "/mcp",
      oauth: "/.well-known/oauth-protected-resource",
    });
    expect(typeof body.version).toBe("string");

    // OAuthHelpers are not consulted for the public route.
    expect(env.OAUTH_PROVIDER.parseAuthRequest).not.toHaveBeenCalled();
    expect(env.OAUTH_PROVIDER.completeAuthorization).not.toHaveBeenCalled();
    expect(env.ENGRAM_IDENTITIES.get).not.toHaveBeenCalled();
  });

  it("GET /health returns 200 with status:'ok' JSON", async () => {
    const env = makeMockEnv();
    const response = await callFetch(new Request("https://example.dev/health"), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("application/json");

    const body = await response.json<Record<string, unknown>>();
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(typeof body.timestamp).toBe("number");

    // Health route does NOT touch OAuth or KV.
    expect(env.OAUTH_PROVIDER.parseAuthRequest).not.toHaveBeenCalled();
    expect(env.ENGRAM_IDENTITIES.get).not.toHaveBeenCalled();
  });
});

describe("oauth defaultHandler — /authorize flow (T-03-PROPS / T-03-KV-LEAK / T-03-PARSE)", () => {
  it("with valid ENGRAM_IDENTITIES KV entry: completeAuthorization receives KV-sourced props ONLY, returns 302", async () => {
    const identityGet = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ workspace_id: "ws-1", user_id: "user-1" }));
    const completeAuthorization = vi
      .fn()
      .mockResolvedValue({ redirectTo: "https://example.dev/cb?code=ok" });
    const env = makeMockEnv({ identityGet, completeAuthorization });

    const response = await callFetch(
      new Request("https://example.dev/authorize?client_id=test-sub"),
      env,
    );

    // 302 redirect (Response.redirect returns 302 by default).
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.dev/cb?code=ok");

    // ENGRAM_IDENTITIES.get called with the OAuth `sub` (== clientId in v0.1).
    expect(identityGet).toHaveBeenCalledTimes(1);
    expect(identityGet).toHaveBeenCalledWith("test-sub");

    // completeAuthorization called exactly once with KV-sourced props.
    expect(completeAuthorization).toHaveBeenCalledTimes(1);
    const callArg = completeAuthorization.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg).toBeDefined();
    const props = callArg?.props as Record<string, unknown> | undefined;
    expect(props).toEqual({ workspace_id: "ws-1", user_id: "user-1" });

    // T-03-PROPS structural lock: EXACTLY 2 keys on props — no extras
    // (e.g., no leak of `sub`, `metadata.label`, or request-derived fields).
    expect(Object.keys(props ?? {}).sort()).toEqual(["user_id", "workspace_id"]);

    // userId arg also derives from identity (NOT from the request).
    expect(callArg?.userId).toBe("user-1");
  });

  it("with missing ENGRAM_IDENTITIES KV entry: returns 403 with 'Unknown OAuth subject', completeAuthorization NOT called (T-03-KV-LEAK)", async () => {
    const identityGet = vi.fn().mockResolvedValue(null);
    const completeAuthorization = vi.fn();
    const env = makeMockEnv({ identityGet, completeAuthorization });

    const response = await callFetch(
      new Request("https://example.dev/authorize?client_id=unknown-sub"),
      env,
    );

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toContain("Unknown OAuth subject");
    // The sub IS echoed (it's the requester's own client id, not a secret).
    expect(text).toContain("test-sub"); // mock parseAuthRequest returns clientId: "test-sub"
    // Bootstrap pointer in the message tells Russell what to do.
    expect(text).toContain("kv:bootstrap");
    // T-03-KV-LEAK: the body must NEVER contain JSON-stringified identity
    // value content. On the miss path the value is null anyway, but lock the
    // invariant here so a future refactor that decides to "echo the value
    // for debugging" trips immediately.
    expect(text).not.toContain("workspace_id");
    expect(text).not.toContain("user_id");

    expect(completeAuthorization).not.toHaveBeenCalled();
  });

  it("with malformed ENGRAM_IDENTITIES KV value (JSON.parse fails): returns 500 with SANITIZED message — never echoes the raw value (T-03-PARSE)", async () => {
    const identityGet = vi.fn().mockResolvedValue("this-is-not-json {{{");
    const completeAuthorization = vi.fn();
    const env = makeMockEnv({ identityGet, completeAuthorization });

    const response = await callFetch(
      new Request("https://example.dev/authorize?client_id=test-sub"),
      env,
    );

    expect(response.status).toBe(500);
    const text = await response.text();
    // The sanitized message must be the exact literal — no parser detail,
    // no raw value content.
    expect(text).toBe("Internal error: corrupt identity record");
    // T-03-PARSE structural: raw value content must NEVER appear in the body.
    expect(text).not.toContain("this-is-not-json");
    expect(text).not.toContain("{{{");

    expect(completeAuthorization).not.toHaveBeenCalled();
  });
});

describe("oauth defaultHandler — fall-through", () => {
  it("unknown path returns 404", async () => {
    const env = makeMockEnv();
    const response = await callFetch(new Request("https://example.dev/some-random-path"), env);

    expect(response.status).toBe(404);
    // OAuthProvider helpers not consulted for unknown paths.
    expect(env.OAUTH_PROVIDER.parseAuthRequest).not.toHaveBeenCalled();
    expect(env.ENGRAM_IDENTITIES.get).not.toHaveBeenCalled();
  });
});
