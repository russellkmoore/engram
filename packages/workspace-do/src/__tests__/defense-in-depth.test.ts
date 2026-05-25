/**
 * STO-07 test stubs — assertOwnsWorkspace defense-in-depth.
 *
 * RED scaffold for Plan 02-05 (defense-in-depth). Two cases:
 *
 *   1. POSITIVE — when `ctx.id.name === workspace_id`, the helper does NOT
 *      throw. Plan 02-05 will iterate this for every public method on
 *      WorkspaceDO (a missing method = unverified guard, per PATTERNS.md §11
 *      drift risk).
 *
 *   2. NEGATIVE — when `ctx.id.name !== workspace_id`, the helper throws
 *      `McpError` with `code === ErrorCode.InvalidRequest` (-32600 per the
 *      MCP JSON-RPC spec). The assertion shape — `McpError` instance check
 *      AND code check — is locked in by Wave-0 acceptance criteria so Plan
 *      02-05 knows exactly what to satisfy. Do NOT generically `.toBeInstanceOf(Error)`.
 *
 * @module @engram/workspace-do/__tests__/defense-in-depth
 */
import { describe, it, expect } from "vitest";

// Wave-0 NOTE: implementation imports resolved in Plan 02-05.
//   import { runInDurableObject } from "cloudflare:test";
//   import { env } from "cloudflare:workers";
//   import { WorkspaceDO } from "../index.js";
//   import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

describe("assertOwnsWorkspace (STO-07)", () => {
  it.skip("passes when ctx.id.name === workspace_id (POSITIVE — STO-07, Plan 02-05)", () => {
    // const id = env.WORKSPACE.idFromName("ws-alice");
    // await runInDurableObject(env.WORKSPACE.get(id), async (instance) => {
    //   expect(() =>
    //     instance.listMemoryTypes({ workspace_id: "ws-alice" }),
    //   ).not.toThrow();
    // });
    expect.fail("not yet implemented — Plan 02-05");
  });

  it.skip("throws McpError(InvalidRequest -32600) on workspace mismatch (NEGATIVE — STO-07, Plan 02-05)", () => {
    // const id = env.WORKSPACE.idFromName("ws-alice");
    // await runInDurableObject(env.WORKSPACE.get(id), async (instance) => {
    //   try {
    //     instance.listMemoryTypes({ workspace_id: "ws-bob" });
    //     expect.fail("expected throw");
    //   } catch (err) {
    //     expect(err).toBeInstanceOf(McpError);             // SHAPE-LOCK
    //     expect((err as McpError).code).toBe(ErrorCode.InvalidRequest); // -32600
    //   }
    // });
    expect.fail("not yet implemented — Plan 02-05");
  });
});
