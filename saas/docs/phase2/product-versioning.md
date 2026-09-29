# Information versions and snapshots

Each Basic Information save inserts a new `product_versions` row, then moves `products.current_version_id`. The database forbids updating or deleting a ProductVersion. A snapshot records brand, name, category, optional SKU, description, up to ten selling points, target audience, author, time, and version number. Current Product SKU is copied from the version for the active uniqueness rule.

`getProductSnapshot(session, workspaceId, productId)` in `src/lib/products.ts` checks the active workspace and membership, scopes the Product lookup, and returns the current Product, ProductVersion, AccuracyRuleVersion, and all ready current AssetVersion identifiers and metadata. Each asset entry includes ID, purpose, type, version ID/number, checksum, byte size, MIME type, and private object keys for server-side use. Never serialize its private keys to an unauthorised browser or use a raw object key as an access check.

The snapshot is a current read, not a durable Job record. A later Job must persist the exact returned version IDs and selected asset version IDs at Job creation, in one coherent transaction or a repeatable-read snapshot, before processing. Old information and rule rows are immutable. Ready asset version rows also cannot be changed, and replacement creates a higher version under the same Asset ID.
