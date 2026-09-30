# Content Library

`/content` reads real workspace ContentItems joined to their current versions and private poster status. It is separate from the job execution list. Cards show title/hook, type, frozen Product or source name, review status, duration and creation date. Home preserves the existing execution counters and adds actual active Content Assets and Pending Review counts. Transcripts, plans and unpublished artifacts are never counted as Content.

Filters accept All / AI Videos / Clips, Active / Pending Review / Approved / Rejected / Archived / All statuses and optional Product ID. Search covers title/hook, frozen Product name, source filename and content type. It is trimmed, limited to 100 characters, parameterized and escapes literal LIKE wildcard input. No vector search or analytics filter is added.

Pages contain at most 24 items with `created_at DESC, id DESC` ordering. Page numbers are integers 1–500. Previous/Next links retain filters. The ordering is deterministic; new concurrent insertions can shift offset pages. Product options use frozen names and are bounded to 200; arbitrary authorized Product IDs remain valid API filters.

Default active views and all four aggregate counts exclude archived items. Archive removes the item from the active Library and Review queue, preserves versions/reviews/relations/media and keeps direct detail/preview available to authorized members. The Content download endpoint rejects archived items; existing historical job download policy remains available for authorized QA access.

Empty Library and Review views are truthful and contain no invented cards or broken generation CTA. Posters may remain placeholders while extraction is pending or unavailable. Detail uses native video, saved context, review controls/history and simple lineage. It never renders storage keys, worker paths, provider credentials or raw provider state.

Workspace APIs are under `/api/workspaces/:workspaceId/content`: list, counts, item detail, review, archive, relations and version-scoped media/poster retry. Responses are `no-store`, authenticated and active-workspace scoped; mutations require same origin and the existing editor permission.
