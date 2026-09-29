# Products

`products` owns the permanent `workspace_id`, status (`DRAFT`, `ACTIVE`, `ARCHIVED`), current information version, current rule version, optional current SKU, author and timestamps. Database triggers prevent workspace reassignment. Foreign keys keep current versions under the same Product and workspace. `products_active_sku` enforces an exact, case-sensitive SKU unique among active Products in one workspace. Drafts may share a SKU; activation or editing an active Product to a duplicate is rejected. SKU whitespace is trimmed at input; internal formatting and case are preserved.

Creation writes a draft with information version 1 and default rule version 1. Drafts appear in Current/Drafts and can be resumed at `/products/[id]/edit`; they are excluded from Home's active count. Activation requires a ready asset. Archive removes a Product from the Current/Active list, retains every version and object reference, and appears under Archived. There is no hard-delete UI. Archived Products cannot be edited or receive new media.

The list filters by status, searches name/brand/SKU with a workspace predicate, and pages 20 by default, up to 50 per request. Asset lists page 50; a Product accepts at most 100 non-archived assets so its server-side snapshot is complete. Product detail shows current data, rules, verified references, and recent version history. Information and rule history each show the newest 50; older rows remain in the database.

Home counts only active Products and ready assets in the selected workspace. The selected workspace must match the route workspace for every API request. Normal UI has Home, Products, Add Product, Product detail and Settings. Generation, workflow and billing controls are not active.
