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
    const prefix = `MCP error ${ErrorCode.InternalError}: `;
    expect(output.message.startsWith(prefix)).toBe(true);
    const payload = output.message.slice(prefix.length);
    expect(payload.length).toBeLessThanOrEqual(500);
  });
});
