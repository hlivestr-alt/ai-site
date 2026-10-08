# Phase F.2 — Existing TikTok App Contract Review

Review the existing app only. All boxes remain unchecked until the operator records the observed result. Automated fixtures do not establish commercial eligibility, app approval, markets or seller eligibility. Keep `OUTREACH_TIKTOK_CONTRACT_REVIEWED=0` and `OUTREACH_REAL_SEND_ENABLED=0` during this review.

Do not change Partner Center settings as part of completing this sheet. Record non-secret labels, approval states, endpoint versions and review dates privately as appropriate. Do not capture app identifiers, secrets, tokens, shop ciphers, authorization links or callback query parameters.

- [ ] **1. App type/category**
  **Where to look:** App & Service → existing app → app overview/details and review status.
  **Expected / acceptable result:** The actual Public/Custom type, developer type and service category permit this customer-facing SaaS use case. An own-shop-only seller developer app needs explicit provider confirmation before external sellers are offered connection. Existing native operation alone is not approval evidence.

- [ ] **2. Markets and seller types**
  **Where to look:** Existing app → Market / Seller type and market-specific review or release status.
  **Expected / acceptable result:** Intended customer seller markets and local/cross-border seller types are supported and approved. Record actual availability; do not infer it from a working native Indonesian shop.

- [ ] **3. Customer/external seller authorization**
  **Where to look:** Developer/app eligibility, distribution and app-review pages; provider support or partner manager if unclear.
  **Expected / acceptable result:** Independent customer sellers may authorize this same app under its current distribution/review status. Record any testing allowlist, authorization cap or required review. Each Workspace owns its own grant; the internal sender remains excluded.

- [ ] **4. Affiliate messaging scope**
  **Where to look:** Existing app → Manage API / permissions → Affiliate Seller Messaging.
  **Expected / acceptable result:** `seller.affiliate_messages.write` is approved and usable for the intended seller population/market. The scope must also be present in that seller's returned grant. This review sends no message.

- [ ] **5. Creator Marketplace read scope**
  **Where to look:** Existing app → Manage API / permissions → Creator Marketplace.
  **Expected / acceptable result:** `seller.creator_marketplace.read` is approved for seller-side creator directory/performance access. Do not substitute creator-side OAuth or creator-prefixed scopes.

- [ ] **6. Authorized-shop grant**
  **Where to look:** Manage API → Authorization → Get Authorized Shops, including Required scope and response schema.
  **Expected / acceptable result:** The app and intended seller grant may call `GET /authorization/202309/shops`. Confirm the actual permission key and shop list contract. Every selected SaaS shop must come from its own returned authorization, never native selection or a browser-supplied shop ID.

- [ ] **7. Current Redirect URL**
  **Where to look:** Existing app → Edit/basic authorization settings → single Redirect URL field.
  **Expected / acceptable result:** Record that the existing native loopback destination is still registered; leave it unchanged here. The later manually authorized cutover target is `https://ai-test.proyaofficial.com/api/outreach/tiktok/callback`. Confirm seller callback `code`/`state` fields and error behavior against the current contract. No credential-bearing link is needed.

- [ ] **8. Token exchange and refresh**
  **Where to look:** Authorization documentation → Get Access Token and Refresh Access Token.
  **Expected / acceptable result:** Review the currently implemented `/api/v2/token/get` and `/api/v2/token/refresh`, grant types, seller `user_type=0`, expiry units/absolute timestamps, scope fields, refresh rotation and revocation semantics. Check app × seller interactions before later live authorization. Do not invoke these APIs for this review.

- [ ] **9. Seller/shop identity fields**
  **Where to look:** Token and Authorized Shops response schemas.
  **Expected / acceptable result:** Seller `open_id`, canonical external shop `id`, shop `cipher`, region and seller type are distinct fields. SaaS account uniqueness/exclusion uses canonical external shop ID, not seller open ID, local Shop UUID or cipher. Responses must support verified Workspace-owned shop selection.

- [ ] **10. Creator Open ID namespace**
  **Where to look:** Creator Marketplace and Affiliate Seller Messaging request/response schemas.
  **Expected / acceptable result:** Confirm app/market/authorization namespace and the exact recipient field. A Marketplace Creator Open ID must be valid for the messaging endpoint; username, IM ID and another app's creator ID cannot be assumed interchangeable.

- [ ] **11. Conversation/message endpoints**
  **Where to look:** Manage API → approved Affiliate Seller Messaging endpoint documentation.
  **Expected / acceptable result:** Review the implemented `POST /affiliate_seller/202508/conversations` and `POST /affiliate_seller/202508/conversations/{conversation_id}/messages`, required scope, headers, signing, recipient and message-body fields. Confirm approved versions and market availability. No API Testing Tool send is permitted in this task.

- [ ] **12. Positive message-ID proof**
  **Where to look:** Send-message success/error response schema and delivery guarantees.
  **Expected / acceptable result:** A positive success envelope provides a non-empty authoritative `message_id`. Missing/ambiguous proof remains `DELIVERY_UNKNOWN`; HTTP 200 alone cannot establish delivery. Document provider error/retry semantics without submitting a message.

- [ ] **13. App/shop limits and quotas**
  **Where to look:** Endpoint Rate limit / Quota sections and the existing app's actual quota/usage screens.
  **Expected / acceptable result:** Record current endpoint, app × shop and daily limits, reset windows, throttle/error codes and Retry-After behavior. Native plus SaaS traffic must share any app-wide budget safely. Local concurrency settings are not provider quotas.

- [ ] **14. Shared developer-app implications**
  **Where to look:** Authorization lifecycle/revocation documentation, app usage quotas and provider support if grant interaction is undocumented.
  **Expected / acceptable result:** Sharing the app is permitted while native/SaaS seller stores stay separate. Confirm reauthorization/refresh/revocation effects, shared quotas and callback routing. The internal seller must never be the SaaS QA seller; a later authorized live test uses a different controlled seller. Shared credentials alone do not satisfy this checklist.

Operator completion: **PENDING**. Review date: **PENDING**. Non-secret evidence reference: **PENDING**. Any unclear or unsupported item keeps the contract guard closed; the operator must report completion before its flag is changed.

Use the current official [app creation guide](https://partner.us.tiktokshop.com/docv2/page/create-your-app) for app type/market/distribution review, [app review process](https://partner.tiktokshop.com/docv2/page/app-review-process) for actual review requirements, [authorization guide](https://partner.tiktokshop.com/docv2/page/678e3a362dccb8030ea6f98c) for flow distinctions, and [API documentation](https://partner.tiktokshop.com/docv2/api-document) for endpoint contracts. Public documentation is guidance; the signed-in existing app's actual approvals remain authoritative.
