# Review Center

`/review` is a Pending Review filter over the same Content model and bounded Library component. It is not a second review database. Type, search and Product filters remain available; each card opens the shared Content detail page. There is a real navigation item and a truthful “No content waiting for review.” empty state.

Detail displays the current private MP4 beside the saved context. Product-backed AI Video shows the exact frozen Product/Rule versions and authorized original reference AssetVersions. Product-backed clips show the frozen text/rules actually used. Generic clips show their original SourceAsset preview and timestamp/hook/reason context. Newer Product edits are never used as historical substitutes.

Owner, Admin and Editor see Approve, category/reason Reject, lineage registration and archive controls. Viewer sees status, saved context, media and history without mutation controls. Server permissions remain authoritative regardless of UI. The chosen download matrix is documented in [media access](media-access.md).

Decisions apply to the displayed version and review revision. Refreshing detail loads durable history and current status. New versions enter Pending Review even when an older version was approved; a stale review form returns 409. There is no “Create Variant” generation action, workflow launch or distribution action.
