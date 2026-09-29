# Phase 2: Products and private references

Phase 2 adds workspace-owned Products, immutable information and accuracy-rule versions, reference asset versions, direct signed uploads, authorized short-lived downloads, and the three-stage Product wizard. It uses migration `0002_products_assets.sql`. There are no Jobs, AI generations, payments, or internal product imports.

The customer flow is Home → Products → Add Product → Basic information → Assets → Accuracy rules and review → Product detail. An incomplete Product is a draft. Activation requires at least one verified asset. The list, Home counts, detail, search, and media requests use the selected workspace and an active membership. Owner, Admin, and Editor may edit; Viewer can read.

- [Products](products.md) and [versioning](product-versioning.md)
- [Assets](assets.md) and [private storage](storage.md)
- [Accuracy rules](accuracy-rules.md)
- [Isolation and acceptance tests](isolation-tests.md)
- [Local development](local-development.md)
- [Phase 3 handoff](phase3-handoff.md)

Production deployment remains gated on production email, public-domain cookie settings, backup/monitoring, storage operations and security review. The local preview is not a public deployment.
