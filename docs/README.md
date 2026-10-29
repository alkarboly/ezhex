# WorldPulse docs

- [Architecture](architecture.md) — hex-first Explorer, the Explorer agent, Overture ingest, optional Supabase auth, Jobs, inspect SQL, private query workflows, enrichments, licenses, and Render
- [Query spec](query-spec.md) — server query JSON contract, inspect SQL presentation, operators, Overture fields, and release snapshots
- [Workflow pipeline](workflow-pipeline.md) — private query workflows (SQL + enrichments), geofence, hail MESH, hex snapshot history, ingest guardrails, and Supabase tables
- [Enrichment marketplace](marketplace.md) — demo agentic orchestration, `ai_column`, and simulated ledger debit/tips. Real Rho card charge is still target-only.

The field catalog in `src/types/datasets.ts` is the list the explorer, the mock provider, and these docs share.
