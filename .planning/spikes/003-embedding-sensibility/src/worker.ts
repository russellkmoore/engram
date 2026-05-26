// Spike 003 Worker — POST /embed { texts: string[] } → { embeddings: number[][],
// dim: number, elapsed_ms: number }.
// Uses Workers AI @cf/baai/bge-base-en-v1.5 (768d, cosine). Batched call —
// the model accepts an array and returns an array.

interface Env {
  AI: Ai;
}

interface EmbedRequest {
  texts: string[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, spike: "003-embedding-sensibility" });
    }
    if (request.method !== "POST" || url.pathname !== "/embed") {
      return new Response("POST /embed", { status: 405 });
    }

    let body: EmbedRequest;
    try {
      body = (await request.json()) as EmbedRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    if (!Array.isArray(body.texts) || body.texts.length === 0) {
      return Response.json({ error: "missing or empty texts[]" }, { status: 400 });
    }

    const t0 = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Workers AI Ai binding
      const response: any = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: body.texts,
      });
      const elapsed_ms = Date.now() - t0;

      // Workers AI embedding shape: { shape: [N, dim], data: number[][] }
      const data = response?.data;
      const shape = response?.shape;
      if (!Array.isArray(data)) {
        return Response.json(
          { error: "unexpected response shape", raw: response, elapsed_ms },
          { status: 502 },
        );
      }
      const dim =
        Array.isArray(shape) && typeof shape[1] === "number" ? shape[1] : (data[0]?.length ?? 0);
      return Response.json({ embeddings: data, dim, elapsed_ms });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: "AI.run failed", message }, { status: 502 });
    }
  },
} satisfies ExportedHandler<Env>;
