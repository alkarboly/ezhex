# Enrichment marketplace (OpenAI + Rho)

**Status: demo scaffold live.** Structured quote, process-agent batching (<10 hexes), `ai_column`, a simulated ledger, and the Explorer agent (prompt → hexes → process → query → enrichments → approve, see [architecture.md](architecture.md#agent)) are shipped. Real Rho card debit is still target-only. This page remains the pickup contract for the remaining Rho production wiring.

Read first: [architecture.md](architecture.md), [workflow-pipeline.md](workflow-pipeline.md), [query-spec.md](query-spec.md). Keep field names from those docs and from `src/types/enrichments.ts`. Do not invent a second workflow type.

## What we are building

A private enrichment marketplace on top of the existing query workflow.

```
User selects hexes and inspect filters (or the Explorer agent derives them from a prompt)
  → Process agent (existing DuckDB Overture ingest) if hexes are missing
  → Orchestrator (OpenAI, structured quotes — not free chat)
       geofence agent     → price for a drawn / uploaded polygon
       hail_history agent → price for the MESH date range
       ai_column agent    → price per row for one typed column
  → User / orchestrator accepts
  → Rho virtual card is charged for the total (staging treasury)
  → Specialists run
  → query-workflow run logs + `/ledger` show quote, accept, debit, tip, and result
```

Rho is the **bank the agents spend from**. OpenAI is the **broker**. WorldPulse owns the catalog, the run, and the log. Rho does not broker. The browser does not call OpenAI or Rho.

## What already exists

Do not rebuild these. Extend them.

| Piece | Where | Notes |
| --- | --- | --- |
| Process / open-source ingest | `POST /api/workflow-ingestion/jobs`, DuckDB S3, `ingest_overture_*` | This is the processor agent. Jobs already have `logs` (`at`, `level`, `message`) |
| Query workflow | `query_workflows` | name, SQL, `custom_sql`, `h3_cells` (1–300), `filters`, `enrichments` (max 4), `release_version` |
| Run | `POST /api/query-workflows/:id/run` | quote → optional process batches (<10) → snapshot check/historize → query → enrichments |
| `geofence` | `keep` `inside` \| `outside`, GeoJSON `Polygon` | Enrich panel draw |
| `hail_history` | `start_date`, `end_date` | NOAA MRMS MESH_Max_1440min, 12Z only, from 2020-11-01 |
| Hail columns | `hail_mm_max`, `hail_days`, `hail_last_date` | On `FeatureRow` after a run |
| Owner RLS + GRANT | `authenticated` only | Anon revoked. 42501 → run `20261027_query_workflow_grants.sql` |
| Auth | httpOnly `wp_access` / `wp_refresh` | Node uses anon + user JWT. No service-role. Browser never imports Supabase |

`ENRICHMENT_KINDS` is `['geofence', 'hail_history', 'ai_column']`. `asEnrichments` rejects unknown kinds and allows at most one `hail_history` + one `ai_column`.

## Rho — what it is

Rho is business banking: one company account, cards, vendors, a transaction ledger. It is not a consumer wallet SDK and not an agent framework.

Hackathon access (do not commit any of this):

- Staging UI: `https://app.rho-staging.co/` after OpenVPN Connect + the personal profile
- Seeded accounts, cards, vendors, funded balances
- A **virtual card** (card number + spend cap) issued from that staging account
- Access dies after the hackathon
- Never paste the password, VPN profile, or card PAN into chat, git, or the browser bundle

Public docs (`docs.rho.co`) are mostly **read-only**. A token is scoped to **one business**. Tokens cannot mint a Rho account per WorldPulse user. The OpenAPI lists `accounts_payable:payments:write`, but published AP endpoints are GET. Staging may allow UI payments and possibly a write token — check Settings → API / Access Tokens **while on the VPN**.

Public sandbox (`https://rhoapi-sandbox.rho.co/api/v1`, `Authorization: Bearer sandbox`) is fictional GET data. Staging behind VPN is the real demo rail.

### Rho’s job in this app

One staging treasury. The virtual card is the orchestrator’s debit card.

| Staging object | Maps to |
| --- | --- |
| Funded account / virtual card | User / orchestrator spend pot (“everyone gets some money”) |
| Vendor: processor | Process / DuckDB ingest |
| Vendor: hail | `hail_history` |
| Vendor: geofence | `geofence` |
| Vendor: ai_column | `ai_column` |

Do **not** open a Rho login per WorldPulse sign-up. WorldPulse users get **in-app credits** seeded from the staging pot. Rho holds the company/agent pots.

Env (names only, values in `.env` / Render, never in repo):

- `RHO_API_URL` — guess only on VPN (`https://rhoapi-staging…` or similar). Fall back to documented `https://rhoapi-sandbox.rho.co/api/v1` for shape tests
- `RHO_API_TOKEN`
- `RHO_CARD_ID` — virtual card id, not the PAN
- Optional `RHO_VENDOR_PROCESS`, `RHO_VENDOR_HAIL`, `RHO_VENDOR_GEOFENCE`, `RHO_VENDOR_AI_COLUMN`

If write payments exist, Node charges the card / pays the vendor on accept. If not, Jobs records a **ledger debit** and a human pays in the staging UI; Node `GET /accounts` and `GET /transactions` to show the balance.

Never send card numbers to the browser. Never store PAN. Fail closed if Rho is unconfigured: quote and run may still work on an **internal ledger** in mock / when `RHO_API_TOKEN` is unset.

## OpenAI — what it is

OpenAI runs **only on Node**. It orchestrates quotes, parses Explorer agent prompts and picks their categories, and (for `ai_column`) fills one typed column.

Env:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (global default model)
- `OPENAI_QUOTE_MODEL` (optional, quote-only override)
- `OPENAI_AI_COLUMN_MODEL` (optional, ai-column-only override)
- `OPENAI_AGENT_MODEL` (optional, Explorer agent planner override)
- `OPENAI_QUOTE_API_KEY` / `OPENAI_AI_COLUMN_API_KEY` / `OPENAI_AGENT_API_KEY` (optional key overrides)
- `AGENT_MAX_NEW_HEXES` (lowers the 36 new hexes one agent request may process), `AGENT_GEOCODER=off` and `AGENT_GEOCODER_URL` (place lookup, Nominatim by default)

The orchestrator does **not** free-chat a price. It emits a structured quote the server validates:

```json
{
  "quotes": [
    { "agent": "process", "usd_cents": 25, "reason": "3 missing hexes" },
    { "agent": "hail_history", "usd_cents": 40, "reason": "92 MESH days" },
    { "agent": "geofence", "usd_cents": 10, "reason": "1 polygon" },
    { "agent": "ai_column", "usd_cents": 80, "reason": "200 rows × bool" }
  ],
  "total_usd_cents": 155
}
```

Server clamps each line to a **price book** (env or a small table). The model may explain; it may not invent a price above the book. Log both the model quote and the clamped amount.

If `OPENAI_API_KEY` is unset, use the price book only (deterministic). Same Jobs log shape.

## Enrichment: `ai_column`

`ENRICHMENT_KINDS` and `WorkflowEnrichment` include `ai_column`. Still max 4 steps. At most one `hail_history`. At most one `ai_column` in v1.

```ts
type AiColumnValueType = 'bool' | 'enum' | 'number' | 'text'

type AiColumnEnrichment = {
  id: string
  kind: 'ai_column'
  column: string          // new FeatureRow key, snake_case, not an overture_* column
  value_type: AiColumnValueType
  prompt: string
  source_fields: string[] // existing FeatureRow keys only
  enum_values?: string[]  // required when value_type is enum
}
```

Rules:

- One new column per step. The model does not invent extra columns
- Do not write back into `overture_places` / `overture_buildings` / `overture_addresses`
- Hard row cap (start at 200; never unbounded nationwide)
- Batch and cache by hash of (`column`, `value_type`, `prompt`, source values)
- `bool` is T/F. `enum` must be in `enum_values`. Invalid model output → null + a warn log, not a guessed string
- Custom SQL still cannot SELECT this column from PostgREST; it appears on the run result only, like hail columns

## Agents

| Agent | Live work | Price input |
| --- | --- | --- |
| `process` | Existing ingest job for missing / stale hexes | hex count, not-ready count |
| `geofence` | Existing polygon keep | vertex count |
| `hail_history` | Existing MESH extract | day count × hex count |
| `ai_column` | Live demo | row count × `value_type` |
| `orchestrator` | New, OpenAI + price book | sum of accepted lines |

Brokering is quote → clamp → accept → debit → run. The Explorer agent panel plans the build, processes hexes, and shows this quote; the debit happens only when the user presses **Approve & run**. Log one line per hop.

## Run log

Use `QueryWorkflowRun.logs` (`at`, `level`, `message`) and keep the same greppable prefixes:

```
agent quote process 25¢ · 3 missing hexes
agent quote hail_history 40¢ · 92 days
agent clamp hail_history 40¢ → 40¢
agent accept total 155¢
rho debit card 155¢ · <transaction id or ledger id>
agent run process started
agent run hail_history succeeded
```

The run response stores quote / clamp / process / debit / specialist lines. Ledger movements are visible on `/ledger`. Do not hide payment lines.

## End-to-end path

```
Browser (signed-in when Supabase is configured)
  → POST /api/query-workflows/:id/run   (or Process job first)
  → Node resolveUser (accessToken after refresh)
  → Orchestrator: price book ± OpenAI structured quote
  → Internal ledger debit (owner_user_id)
  → Optional Rho charge / GET reconcile
  → Existing run: snapshot check, historize, query, geofence, hail
  → ai_column pass on the result rows
  → Append JobLog lines
  → JSON back; /jobs polls
```

Auth: same as workflow save. No OpenAI or Rho keys in Vite. Fail closed: missing key → skip that provider, keep the ledger + logs. Denied Rho → do not pretend the card was charged.

## Implementation order

1. Inventory staging (VPN): account ids, virtual `RHO_CARD_ID`, vendor names. Write ids into `.env` only.
2. Price book + internal credit ledger (owner-scoped table or mock map). Seed credits from the staging pot story.
3. Orchestrator on `POST /api/query-workflows/:id/run` (and Process create): structured quote, clamp, accept, `JobLog` lines.
4. Rho read: `GET /accounts`, `GET /transactions` so Jobs can show “ledger 155¢ · Rho balance …”. Write charge only if the staging token can.
5. `ai_column` kind, Node OpenAI batch, result column, docs + `ENRICHMENT_KINDS`.
6. Marketplace UI: catalog + quoted total before Run. Do not block Process on live ACH.

## Out of scope for v1

- A Rho checking account per sign-up
- Charging the user’s personal card in the browser
- Third-party third-party enrichments beyond these four specialists
- Writing AI output into Overture tables
- Service-role key

## Verify

- `npx tsc --noEmit` and `npm run verify`
- Mock path works with no `OPENAI_API_KEY` / `RHO_API_TOKEN` (price book + ledger only)
- Browser never contains those keys
- `POST /api/query-workflows/:id/run` returns quote / accept / debit lines in `logs`, and `/ledger` shows the debit/tip entries
- A floor `ai_column` bool on a small hex does not change `overture_*` rows
- Docs stay aligned: this file, architecture, workflow-pipeline, `src/types/enrichments.ts`
