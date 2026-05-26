// Spike 002 Worker — POST /summarize { content: string, hint?: string } →
// { summary: string, elapsed_ms: number }.
// Uses Workers AI plain-text generation against @cf/meta/llama-3.1-8b-instruct.
// No JSON-schema constraint — summaries are free-text by design.

interface Env {
  AI: Ai;
}

interface SummarizeRequest {
  content: string;
  hint?: string;
}

const SYSTEM_PROMPT =
  "Write a concise 1-2 sentence summary of the input. Preserve key facts — names, dates, numbers, specific decisions, identifiers. Do not invent details. Do not add commentary. Output only the summary text.";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, spike: "002-summarization-fidelity" });
    }
    if (request.method !== "POST" || url.pathname !== "/summarize") {
      return new Response("POST /summarize", { status: 405 });
    }

    let body: SummarizeRequest;
    try {
      body = (await request.json()) as SummarizeRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    if (!body.content) {
      return Response.json({ error: "missing content" }, { status: 400 });
    }

    const userMessage = body.hint
      ? `Context: ${body.hint}\n\nInput:\n${body.content}`
      : body.content;

    const t0 = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Workers AI Ai binding
      const response: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 256,
        temperature: 0.3,
      });
      const elapsed_ms = Date.now() - t0;

      // Workers AI returns { response: string } for non-streaming text generation.
      const summary = response?.response ?? "";
      if (typeof summary !== "string") {
        return Response.json(
          { error: "model returned non-string response", raw: response, elapsed_ms },
          { status: 502 },
        );
      }
      return Response.json({ summary: summary.trim(), elapsed_ms });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: "AI.run failed", message }, { status: 502 });
    }
  },
} satisfies ExportedHandler<Env>;
