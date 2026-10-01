# Exact ContentVersion review gates

Successful Jobs publish through the existing durable Content publication service. A workflow observes PUBLISHED plus CAPTURED/REFUNDED billing, then binds result-manifest ContentItem/ContentVersion pairs into workflow_review_bindings. Matching is by Job, manifest artifact and immutable workflow lineage; no Product, timestamp or filename guesses are used.

Review steps and aggregate outcome use isContentApproved with the exact version and existing revision-scoped decisions. The default waits for every produced output to receive a decision and requires at least one approved output. Mixed approval/rejection succeeds after all decisions. All rejected fails NO_APPROVED_CONTENT. ALL_APPROVED fails REVIEW_POLICY_NOT_SATISFIED when any output is rejected. Empty usable output fails NO_USABLE_CONTENT without creating a review gate.

Rejected Content remains in the run history and Content Library. There is no automatic regeneration or refund for rejected successful generation. If a bound version is replaced or the item archived before completion, the Run fails CONTENT_VERSION_UNAVAILABLE; approval of the old version cannot approve its replacement. Historical bindings remain exact.

The reconciler polls WAITING_FOR_REVIEW, so decisions resume aggregation without a manual Resume or live browser. Existing Review Center and Content detail author all decisions. Run results retain approved/rejected IDs, exact version outcomes, child IDs and authoritative token totals. Later review changes do not rewrite a terminal Run result.
