/**
 * GREEN — `packages/mcp-server/src/error-mapping.ts` (mapToMcpError + sanitize).
 *
 * Wave 1 (Plan 03-02) ships this dedicated test file (mirrors the Phase 2
 * `packages/workspace-do/src/__tests__/` per-module convention — one
 * test file per source file with a single concern). The 7 cases below
 * cover the four `mapToMcpError` dispatch branches plus the three sanitize
 * scrubbers.
 *
 * Test surface:
 *   - Pass-through for McpError (referential equality)
 *   - NotFoundError → InvalidParams (-32602)
 *   - Error → InternalError (-32603), sanitized
 *   - non-Error → InternalError (-32603) with "Internal error" literal
 *   - sanitize strips /Users/... paths
 *   - sanitize strips 32+ char hex
 *   - sanitize truncates to ≤ 500 chars
 *
 * Threat model: T-03-LEAK mitigation evidence — the path + hex scrubber
 * cases give CI a concrete tripwire if the regexes ever regress.
 *
 * @module @engram/mcp-server/__tests__/error-mapping
 */
import { describe, it, expect } from "vitest";

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { NotFoundError } from "@engram/workspace-do";

import { mapToMcpError } from "../error-mapping.js";

describe("mapToMcpError dispatch", () => {
  it("passes McpError through unchanged (referential equality)", () => {
    const input = new McpError(ErrorCode.InvalidRequest, "preserve me");
    const output = mapToMcpError(input);
    expect(output).toBe(input);
  });

  it("maps NotFoundError → McpError(InvalidParams = -32602) with original message", () => {
    const input = new NotFoundError("block", "abc");
    const output = mapToMcpError(input);
    expect(output).toBeInstanceOf(McpError);
    expect(output.code).toBe(ErrorCode.InvalidParams);
    expect(output.code).toBe(-32602);
    expect(output.message).toContain("abc");
    expect(output.message).toContain("block");
  });

  it("maps unknown Error → McpError(InternalError = -32603) with sanitized message", () => {
    const input = new Error("oops");
    const output = mapToMcpError(input);
    expect(output).toBeInstanceOf(McpError);
    expect(output.code).toBe(ErrorCode.InternalError);
    expect(output.code).toBe(-32603);
    expect(output.message).toContain("oops");
  });

  it("maps non-Error thrown value → McpError(InternalError) with 'Internal error' fallback message", () => {
    const output = mapToMcpError("string error");
    expect(output).toBeInstanceOf(McpError);
    expect(output.code).toBe(ErrorCode.InternalError);
    // The implementation falls back to the literal "Internal error" string for non-Error values.
    expect(output.message).toContain("Internal error");
  });
});

describe("sanitize behavior (T-03-LEAK mitigation)", () => {
  it("strips /Users/... filesystem paths from sanitized message", () => {
    const input = new Error("Error at /Users/r/secret.ts:43");
    const output = mapToMcpError(input);
    expect(output.message).not.toContain("/Users/");
    expect(output.message).toContain("<path>");
  });

  it("strips 32+ character hex strings from sanitized message", () => {
    const hex = "abc1234567890abcdef1234567890abcdef";
    const input = new Error(`token ${hex}`);
    const output = mapToMcpError(input);
    expect(output.message).not.toMatch(/[a-f0-9]{32,}/);
    expect(output.message).toContain("<hex>");
  });

  it("truncates the sanitized payload to at most 500 characters (McpError prefix exempt)", () => {
    // The @modelcontextprotocol/sdk McpError ctor prepends `MCP error <code>: ` to
    // the stored `.message` — that prefix is NOT under sanitize's control. The
    // T-03-LEAK contract is about bounding the caller-supplied portion to 500
    // chars, so strip the SDK prefix before measuring.
    const longMessage = "x".repeat(2000);
    const input = new Error(longMessage);
    const output = mapToMcpError(input);
    const prefix = `MCP error ${String(ErrorCode.InternalError)}: `;
    expect(output.message.startsWith(prefix)).toBe(true);
    const payload = output.message.slice(prefix.length);
    expect(payload.length).toBeLessThanOrEqual(500);
  });
});

describe("Phase 4 regression locks (MCP-07 + T-03-LEAK)", () => {
  // These assertions lock the Phase 3 error-mapping behavior as REGRESSION ANCHORS
  // for Phase 4 handler safety. Phase 4 handlers wrap all catch paths through
  // mapToMcpError — these tests ensure the mapper never leaks DO internals,
  // paths, or unexpected codes when Phase 4 handler bodies throw.

  it("mapToMcpError(new NotFoundError('block', 'x')) returns McpError(InvalidParams = -32602)", () => {
    // Lock: WorkspaceDO.getBlock (and others) throws NotFoundError when a block id is absent.
    // Phase 4 forget/recall handlers must NOT throw on a missing id — but if getBlock is
    // used internally and throws, the mapper must produce InvalidParams.
    const result = mapToMcpError(new NotFoundError("block", "x"));
    expect(result).toBeInstanceOf(McpError);
    expect(result.code).toBe(ErrorCode.InvalidParams);
    expect(result.code).toBe(-32602);
  });

  it("mapToMcpError sanitizes /Users/... paths (T-03-LEAK regression lock for Phase 4 handlers)", () => {
    // Lock: Phase 4 DO RPC errors may include absolute paths in stack frames.
    // The mapper MUST scrub them before the message reaches the MCP client.
    const out = mapToMcpError(new Error("/Users/secret/path/file.ts"));
    expect(out.message).not.toContain("/Users/");
  });

  it("mapToMcpError passes McpError(InvalidRequest) through unchanged (assertOwnsWorkspace pass-through)", () => {
    // Lock: WorkspaceDO.assertOwnsWorkspace throws McpError(InvalidRequest) on workspace
    // mismatch (Phase 2 STO-07). Phase 4 handlers must NOT re-wrap this — the mapper
    // passes McpError through unchanged (referential equality or same code).
    const original = new McpError(ErrorCode.InvalidRequest, "Workspace mismatch");
    const result = mapToMcpError(original);
    expect(result.code).toBe(ErrorCode.InvalidRequest);
    // McpError pass-through is referential — same object as input.
    expect(result).toBe(original);
  });
});
