export default {
  fetch(): Response {
    return Response.json({ ok: true, worker: "engram-triage-worker", phase: 1 });
  },
};
