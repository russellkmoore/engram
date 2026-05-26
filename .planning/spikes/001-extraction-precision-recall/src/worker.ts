// Spike 001 Worker — POST /extract { type: "job_application" | "decision_log" |
// "research_note", content: string } → { extracted: <type-schema-shape> }.
// Uses Cloudflare Workers AI JSON-schema mode against @cf/meta/llama-3.1-8b-instruct.

interface Env {
  AI: Ai;
}

type BucketId = "job_application" | "decision_log" | "research_note";

interface ExtractRequest {
  type: BucketId;
  content: string;
}

// Per-bucket JSON-schemas. Field names mirror shared/schema/src/system-types.ts.
const SCHEMAS: Record<BucketId, { systemPrompt: string; schema: object }> = {
  job_application: {
    systemPrompt:
      "Extract structured data about a job posting. If a field is not present in the input, return null. Do not invent values.",
    schema: {
      type: "object",
      properties: {
        company: { type: "string" },
        role: { type: "string" },
        salary_range: { type: ["string", "null"] },
        applied_date: { type: ["string", "null"] },
        source: { type: ["string", "null"] },
        url: { type: ["string", "null"] },
      },
      required: ["company", "role", "salary_range", "applied_date", "source", "url"],
    },
  },
  decision_log: {
    systemPrompt:
      "Extract structured data about a decision log entry. If a field is not present, return null. Do not invent values.",
    schema: {
      type: "object",
      properties: {
        decision: { type: "string" },
        rationale: { type: "string" },
        owner: { type: "string" },
        date: { type: ["string", "null"] },
        project: { type: ["string", "null"] },
      },
      required: ["decision", "rationale", "owner", "date", "project"],
    },
  },
  research_note: {
    systemPrompt:
      "Extract structured data about a research note. Tags is an array of short topic keywords (lowercase, hyphenated). If a field is not present, return null (or [] for tags).",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        topic: { type: "string" },
        source_url: { type: ["string", "null"] },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["title", "topic", "source_url", "summary", "tags"],
    },
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, spike: "001-extraction-precision-recall" });
    }
    if (request.method !== "POST" || url.pathname !== "/extract") {
      return new Response("POST /extract", { status: 405 });
    }

    let body: ExtractRequest;
    try {
      body = (await request.json()) as ExtractRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    if (!body.type || !body.content) {
      return Response.json({ error: "missing type or content" }, { status: 400 });
    }
    const spec = SCHEMAS[body.type];
    if (!spec) {
      return Response.json({ error: `unknown type: ${body.type}` }, { status: 400 });
    }

    const t0 = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Workers AI Ai binding
      const response: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: spec.systemPrompt },
          { role: "user", content: body.content },
        ],
        response_format: {
          type: "json_schema",
          json_schema: spec.schema,
        },
        max_tokens: 1024,
        temperature: 0.2,
      });
      const elapsed_ms = Date.now() - t0;

      // Workers AI returns either { response: <parsed object> } or { response: "<json string>" }
      // depending on model + structured-output path. Handle both.
      let extracted: unknown = response?.response ?? response;
      if (typeof extracted === "string") {
        try {
          extracted = JSON.parse(extracted);
        } catch {
          return Response.json(
            {
              error: "model returned non-JSON string",
              raw: extracted,
              elapsed_ms,
            },
            { status: 200 },
          );
        }
      }
      return Response.json({ type: body.type, extracted, elapsed_ms });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: "AI.run failed", message }, { status: 502 });
    }
  },
} satisfies ExportedHandler<Env>;
