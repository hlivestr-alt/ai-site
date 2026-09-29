# AI Site H3 bridge

Independent loopback MiniMax H3 one-video bridge. It owns its workflow and all job inputs/outputs in `data/jobs/`. See [the platform integration document](../app/docs/h3-one-shot-bridge.md) for the contract, safety checks, and limits.

```powershell
cd C:\Data\ai-site\h3-bridge
npm install
npm test
npm run lint
npm run typecheck
npm run build
npm start
```

The default endpoint is `127.0.0.1:8788`. Real submission requires `BRIDGE_REAL_SUBMISSION_ENABLED=1` in this service's environment. Phase 4B's single controlled execution completed successfully; the running bridge is enabled, and health permits new jobs only while ComfyUI and Creative Studio are idle. The bridge never changes Creative Studio, restarts ComfyUI, or unloads models.

New uploads and outputs use `ai_site/<job-id>`. Historical output identities and namespaces remain readable without rewriting persisted jobs. Startup loads the ignored `.env.local`; retain the existing validated submission setting when migrating. See [the UI migration notes](../app/docs/ui-migration.md).
