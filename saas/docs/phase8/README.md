# Phase 8 — controlled workflows

Phase 8 adds customer-owned, versioned workflow definitions and durable runs over existing paid Jobs and Content review. Only two server-controlled templates are executable. No script-generation provider, AI Video → Clipper chain, subscriptions, distribution, Outreach, advanced analytics or production deployment is included.

Apply npm run db:migrate, then supervise npm run dev (or the built SaaS server), npm run dispatcher and npm run workflow:dispatcher. The latter is a separate bounded Postgres reconciliation process; append -- --once for an operator tick. The browser only requests actions and reads status.

Local acceptance uses the existing explicitly seeded TEST prices, TEST grants, FakeVideoProvider, private test bucket and sealed deterministic Clipper fixtures. Production requires WORKFLOW_MAX_TOKENS to be deliberately configured. Local default maximum is 100000; WORKFLOW_POLL_MS must be 200–30000 milliseconds.

Read [model](workflow-model.md), [templates](templates.md), [orchestration](orchestration.md), [children](child-jobs.md), [budget](token-budget.md), [review](review-gates.md), [controls](pause-resume-cancel.md), [recovery](recovery.md), [isolation](isolation-tests.md), [handoff](phase9-handoff.md) and [final evidence](final-report.md). Stop after Phase 8.
