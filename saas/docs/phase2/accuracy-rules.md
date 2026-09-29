# Product accuracy rules

Six switches express instructions to keep the logo, packaging text, product shape, cap/pump, product color/material and application method. A free-text instruction field supports product-specific constraints. The initial version defaults the switches on and leaves the text empty. Each rules save inserts a new immutable `product_accuracy_rule_versions` row and moves the current rule pointer.

The Product detail page shows the current rules and version history. Rules are future generation/review instructions; the application makes no fidelity guarantee and does not invoke a model in Phase 2. A later Job must capture the exact rule version ID used.
