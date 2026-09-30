# Private media and retention

ContentVersion references the existing sealed private JobArtifact object; video binaries are not copied. The version media API verifies current workspace membership, item/version ownership and media lineage, then returns a five-minute signed URL with a safe filename. Preview/download verifies a READY artifact, successful job/result membership and version SHA/size. Source access requires the exact version SourceAsset/SHA; reference access requires the exact normalized AssetVersion used by that job; poster access requires the same workspace/item/version and READY poster row. Storage presence is checked before signing.

| Operation | Owner / Admin / Editor | Viewer |
| --- | --- | --- |
| Read Library, detail and history | Yes | Yes |
| Preview current/historical output, original source, references and poster | Yes | Yes |
| Download any non-archived Content | Yes | Yes |
| Approve / reject / archive / variant / poster retry | Yes | No |
| Download archived item through Content API | No | No |

This Phase 6 matrix preserves existing Phase 4/5 workspace-member job artifact access and allows QA of Pending/Rejected outputs. Approval means future downstream eligibility, not whether members can inspect media. Making Viewer downloads approval-only here would leave the existing job download route unrestricted; a future stricter policy must change both surfaces consistently. Archived detail/preview remains available and historical job downloads retain their existing authorization.

Signed URLs exist only in transient component memory, refresh every four minutes and can be requested again after player errors. Changing workspace/item/version clears the visible old media identity and ignores late responses. URLs are not stored in database, localStorage or audit records. Customer detail never renders raw signed tokens/keys/provider metadata. Possession of an already-issued URL grants temporary object access until it expires; it is a bearer capability, not a per-request authenticated media proxy. Another workspace cannot obtain it through SaaS APIs; unsigned object requests are denied.

Posters use a separate durable task per version. The server downloads at most 512 MiB and checks artifact size/SHA, then runs CPU FFmpeg with one thread and a 15-second execution timeout. It selects at most one second into the video, scales within 480×480 and accepts JPEG output up to 1 MiB. Stream processing has a 120-second elapsed-time check between chunks. The JPEG gets a server-owned private Content path, checksum/type/size. No provider thumbnail URL or generation is involved.

Poster work claims have a three-minute expiry and attempt fence. Extraction is attempted up to three times, with 30-second retries; crash-expired claims recover. Failures use a placeholder and a safe code, never revert Content or review. Authorized editors can retry a FAILED poster. A temporarily failed upload may leave an unreferenced poster object; Phase 6 does not introduce object garbage collection.

Foreign keys retain output/support artifacts, reference AssetVersions and sources for every version, including archived Content. Triggers prevent published artifact identity/status changes. Existing pending-upload cleanup removes only abandoned staging Product uploads; it cannot delete published Content artifacts. No automatic hard deletion is introduced. Production bucket lifecycle rules must preserve sealed JobArtifacts, referenced sources/assets and Content posters; direct storage-admin deletion bypasses database protection and can make media unavailable.
