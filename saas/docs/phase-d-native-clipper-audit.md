# Phase D — Native Clipper Read-Only Audit

## Outcome and scope

**D0 PASS — 7 October 2026.** The native implementation at `C:\Data\Clipper Ai Trends` was inspected as read-only reference material before SaaS implementation. No native service was started, imported, stopped, migrated, or edited. Existing unrelated native changes were retained. A private before manifest records SHA-256 hashes for 320 native source/document files; 274 existing SaaS documentation/evidence files and the live Clipper/accounting history were also fingerprinted before implementation.

The actual editing surface is the React **Variants** page, backed by `variation_profile.py`, `variation_engine.py`, and `ffmpeg_editor.py`. The command says **Apply to future clips**. It edits a revisioned profile of 1–6 variants, not an existing clip in a general timeline editor. The finished Clips review page previews scored originals/sibling variants and shows their status. It does not expose arbitrary timing, crop, aspect-ratio, volume, or manual subtitle-text editing. The Modular base-artifact adapter can reuse materialized media and transcript words through the same rendering algorithms.

This initial audit records the Phase D decisions before implementation. The final report will distinguish implemented behavior from these decisions.

## Native feature inventory and Phase D decisions

| Native feature | Native behavior | Backend dependency | Suitable for SaaS? | Phase D action |
| --- | --- | --- | --- | --- |
| Variant name | Names each configured variant | Bounded profile label and output manifests | Yes | PORT: bounded customer variation title |
| Variant count / navigation | 1–6 profile entries; selected entry has independent controls | Profile expansion and deterministic variant identity | Yes, adapted to durable jobs | ADAPT: create individually quoted variations; list original and derived results |
| Hook type: None / Text | Disables or uses the existing selected moment's hook | Stored moment hook and text renderer | Yes | PORT: reuse the frozen hook; no new AI request |
| Image / B-roll / combined / transitional hooks | Uses before/after media, product-role B-roll or transition assets | Native asset libraries and product mapping | Not yet | DEFER: no equivalent immutable private SaaS creative-asset catalog |
| Host footage / audio-over-B-roll | Either keeps host footage or replaces visuals with relevant product footage | Product-linked video assets and timeline planning | Host mode only | DEFER audio-over-B-roll; keep original source footage |
| Text-style presets | Current, Creator Bold Pop, Native Clean, Premium Skincare, Sales Karaoke, Urgency Stack; reapplies typography/motion values | Versioned preset defaults, fonts and ASS/text filters | Yes | ADAPT: bounded supported typography presets with a curated worker font catalog; state differences explicitly |
| Color grade | Original, Warm, Cool, Vivid, Desaturated, Cinematic | Fixed FFmpeg grade filters | Yes | PORT the named fixed filters; no user filter expressions |
| Flip video | Horizontal mirror | FFmpeg hflip | Yes | PORT |
| Subtitles on/off | Toggles rendered captions while retaining transcript | Durable transcript words and ASS renderer | Yes | PORT; original transcript remains immutable |
| Subtitle placement | Top, center, bottom plus exact Y of 8–92% | ASS positioning | Yes | PORT |
| Subtitle size | Compact, small, medium, large | Native pixel-size mapping | Yes | ADAPT to output resolution using the same relative scale |
| Active-word highlight | Highlights the timed active word; presets may use phrase-cut captions | Word timings and ASS styles | Yes | PORT highlight toggle; ADAPT phrase-cut/static text style |
| Subtitle / headline / product-caption font | Independent choices from discovered local fonts | Local font files and font discovery | Bounded catalog only | ADAPT subtitle/headline choices to curated installed worker fonts; DEFER product-caption font with product overlays |
| Base and highlight colors | Validated hex colors | ASS/text styling | Yes | PORT |
| Headline/caption motion and stroke/shadow | Profile preset values select motion, outline, shadow and rotation; not a free-form UI command | Native preset defaults and FFmpeg/ASS builders | Partially | ADAPT supported subtitle/hook preset treatment; DEFER asset-bound product-caption motion and exact native motion parity |
| Relevant B-roll | Inserts product-relevant footage; sample product is preview-only | Product B-roll inventory and deterministic selection | Not yet | DEFER until private SaaS asset mapping exists |
| Product zoom and intensity | None/subtle/normal/strong driven by product/face detection and words | Native detector events, zoom planning | Not yet | DEFER; SaaS has no equivalent frozen detection evidence; do not fabricate product tracking |
| Background music | Auto / None / Selected local track, looped with voice ducking | Local music library, licensed tracks and audio filters | Requires a separate asset contract | DEFER; retain source audio and do not expose local paths |
| Sound effects | Toggle controlled sound assets | Native SFX assets and event planning | Not yet | DEFER with the private audio-asset catalog |
| Dynamic text intensity / roles | Off/minimal/balanced/high-energy; ingredients, benefits, usage, CTA | Indexed product facts, compliance eligibility, role schedule | Not yet | DEFER; do not invent or regenerate customer claims from unrelated native products |
| Dynamic text role font/size/animation/duration | Per-role fonts, bounded size, motion, 1–6 second duration | Approved facts and text animation pipeline | Not yet | DEFER with dynamic text dependencies |
| Black bars | Independent top/bottom bars, each 0–40% | Drawbox safe areas | Yes | PORT |
| Automatic top-bar hook | Reuses moment hook; font, color, 24–160 px, X/Y position 0–100% | Frozen hook and bounded text layout | Yes | PORT with output-resolution scaling and safe text files |
| Save/load presets | Saves named local profile recipes; load modifies draft; explicit apply; revision conflicts preserve draft | Local JSON files, revision hashes | Individual settings reuse is suitable | ADAPT: inherit a parent's frozen settings and offer built-in styles; DEFER customer-managed reusable profile storage |
| Visual preview | Rendered six-second **silent fixed sample**, revision-keyed cache; discards stale responses | Local sample MP4 and synchronous preview FFmpeg | Customer preview is suitable; native execution is not | ADAPT: private real-clip preview plus a clearly labeled lightweight style guide; full output is a quoted durable worker render |
| Global feature flags / asset diagnostics / rescan | Shows native paths, effective overrides and indexed fact readiness | Operator configuration and filesystem scan | No | NOT CUSTOMER-SAFE: omit paths, raw diagnostics and global operations |
| Finished clip review and export | Private-local media previews, scored sibling variants, output tiers and export batches | Score/catalog manifests, native artifact resolver | Media access is suitable | ADAPT preview/download and lineage into existing Content Library; NOT RELEVANT: scoring tiers, affiliate/WhatsApp export |
| Resume / source reuse / output naming | Stage fingerprints, operation-local work, immutable source references, variant IDs and manifests | Pipeline checkpoints, rendering validation, native filesystem | Yes with SaaS identity | ADAPT to existing SaaS checkpoints, leases, job artifacts and Content versions; never overwrite originals |
| Timing/crop/speed/aspect/volume/manual caption text | No corresponding editing control in the current Variants UI; legacy engine has automatic crop/speed/timing diversity | Internal expansion algorithms | Not an exposed parity feature | NOT RELEVANT: do not invent customer controls from backend-only fields |
| AI-assisted moment selection | Original pipeline analysis/scoring and asset/fact selection; visual profile editing itself needs no new transcript or model call | Original analysis, LM Studio / native dependencies | Original analysis already exists in SaaS | ADAPT stored transcript and clip plan only; no fresh external inference for visual variations |

## Source evidence

- `new_app/src/App.tsx`: `VariationsPage`, `renderPreview`, finished `ClipReviewDetail`, and route `/variants`.
- `new_app/src/variants/VariantCommandBar.tsx`, `VariantNavigator.tsx`, `PresetPanel.tsx`, `VariantPreviewPanel.tsx`: apply-to-future semantics, count, recipes, stale-preview behavior.
- `new_app/src/variants/tabs/{Basics,TextSubtitles,Visual,Audio,DynamicText,Advanced,AssetsDiagnostics}Tab.tsx`: all editing tabs and controls.
- `variation_profile.py`: schema 12, preview render version 22, supported choices, bounds, preset defaults, revision validation, fixed sample preview and discovered local assets.
- `variation_engine.py`: fixed color filters, profile expansion, source-relative timing and render configuration. UI-profile expansion fixes crop and speed; backend-only legacy diversity is not a new customer editing feature.
- `ffmpeg_editor.py`: word-aligned ASS subtitles, fixed transforms, bars/hook, detection-based zoom, B-roll, voice-ducked music and validated rendering.
- `clipper_app/variant_generation.py`: `BaseClipArtifact` and `generate_base_clip_variants`; reuses materialized source and transcript without owning a separate content database.
- Native `README.MD`, `AGENTS.md`, `docs/{ARCHITECTURE,DATA_AND_STORAGE,DEVELOPMENT}.md`: supported workflows, authoritative source precedence and protected production state.

## SaaS boundary and implementation decision

Proceed with a visual-variation editor for one finished clip: naming, frozen hook toggle, subtitle display/placement/size/fonts/colors/highlighting, supported text-style presets, fixed color grades, flip, independent letterbox bars and automatic top-bar hook. Use the original private source and durable transcript/plan, rather than re-encoding an already captioned parent or retranscribing. Editing a variation inherits its settings but retains the original clean source, with explicit parent lineage.

Every final render will be a durable leased job with one server quote, one shared-account reservation, and one capture or release. Original bytes, Content versions, analysis, transcript and frozen plan remain unchanged. Missing durable inputs fail safely before charging. Customer pages will expose no native filesystem, FFmpeg expression, operator setting, or product claims from the native app.

The native feature set is sufficiently clear to continue. Asset-driven effects and customer-managed profile storage are explicitly deferred rather than silently omitted. The native application remains read-only reference material throughout Phase D.
