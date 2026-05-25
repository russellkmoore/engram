// Phase 1 stub: this class is declared so packages/mcp-server/wrangler.jsonc's
// binding `{ "name": "WORKSPACE", "class_name": "WorkspaceDO" }` resolves at
// `wrangler dev` time. Phase 2 fills the body (SQLite schema + queries + system
// type seeding).
//
// The class extends `DurableObject` from `cloudflare:workers` rather than just
// declaring an empty class, because Wrangler's DO binding resolver validates
// that the bound class is a Durable Object. Empty `{}` may work (A5) but the
// `DurableObject` base ensures we don't hit a "class is not a Durable Object"
// error at boot — verified during smoke.
import { DurableObject } from "cloudflare:workers";

export class WorkspaceDO extends DurableObject {
  // Phase 2: SQLite schema migration, system-type seeding, typed query helpers.
}
