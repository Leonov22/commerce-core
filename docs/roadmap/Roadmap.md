# Commerce Core — Roadmap

## Purpose

This document is the authoritative roadmap for the Commerce Core implementation.

It defines:

- implementation milestones;
- milestone priorities;
- milestone dependencies;
- completed work;
- approved future work;
- current project state.

Implementation Engineers must not invent new milestones independently.

Every new milestone must be explicitly defined and approved by the Architect before implementation begins.

---

# 1. Roadmap Principles

The project follows these principles:

1. Build the simplest architecture that satisfies current requirements.
2. Prefer a modular monolith over premature distributed architecture.
3. Keep domain logic independent from frameworks and infrastructure.
4. Keep database access behind repository/infrastructure boundaries.
5. Keep client-safe APIs separate from server-only infrastructure.
6. Do not introduce future subsystems before their requirements are approved.
7. Every implementation milestone must have explicit scope and acceptance criteria.
8. Fix commits are treated as follow-up work for the milestone that introduced the issue.
9. Significant architectural decisions must be explicitly documented.
10. Avoid scope creep and unnecessary infrastructure.

---

# 2. Current Architecture

The project currently follows a modular monolith architecture.

The intended dependency direction is:

```text
App / Transport
      ↓
Module Public API
      ↓
Application
      ↓
Domain
      ↑
Repository abstraction
      ↑
Infrastructure
      ↓
Database

Client Components must use explicit client-safe module boundaries.

Server-only infrastructure must never leak into Client Components.

Current Catalog architecture:

PostgreSQL
    ↓
Prisma
    ↓
Catalog Infrastructure
    ↓
ProductRepository
    ↓
Catalog Application
    ↓
Catalog Public API
3. Completed Milestones
IMP-021 — Catalog Persistence Foundation
Status

COMPLETED

Commit

ed9871b2a5dfd49de48bab7bf31fc0b7cedc5b5e

Objective

Replace the static Catalog data source with a PostgreSQL-backed Catalog persistence foundation.

Delivered
PostgreSQL persistence;
Prisma integration;
Catalog domain model;
Product repository abstraction;
Prisma repository implementation;
Product persistence;
Category persistence;
Product translations;
Category translations;
Product status lifecycle;
ACTIVE filtering;
Catalog application queries;
Catalog public API;
client-safe Catalog boundary;
database migration;
seed data;
preservation of Product IDs 1–6;
Cart integration through the Catalog boundary;
Checkout integration through the Catalog boundary.
Architectural constraints
Prisma is isolated inside Catalog infrastructure.
Application code depends on repository abstractions.
Domain code is framework-independent.
Client Components cannot import Prisma infrastructure.
Only ACTIVE products are exposed to storefront consumers.
4. IMP-021 Follow-up Fixes
IMP-021-FIX-001 — Public API Boundary + Prisma Build Generation
Status

COMPLETED

Commit

13fc8305f6cbef5e1ab759d82d6e4063a2f9e26e

Parent

ed9871b2a5dfd49de48bab7bf31fc0b7cedc5b5e

Objective

Fix the Catalog public-module boundary violation and guarantee Prisma Client generation during production builds.

Delivered
API route no longer deep-imports Catalog presentation internals.
toStorefrontProductSummary is exposed through the Catalog public API.
Production build runs prisma generate before next build.
Result

The original Prisma generated-client build failure was resolved.

IMP-021-FIX-002 — Remove Build-Time PostgreSQL Dependency
Status

COMPLETED

Commit

0c20d2e3d6f49caee880a9c6529051718b77c443

Parent

13fc8305f6cbef5e1ab759d82d6e4063a2f9e26e

Objective

Prevent production builds from requiring a reachable PostgreSQL database.

Root Cause

generateStaticParams() in the Product Details route executed a real Catalog database query during next build.

This caused Vercel builds to attempt a connection to:

127.0.0.1:5432

and fail.

Decision

Remove the database-backed generateStaticParams().

Product Details is now dynamically server-rendered:

/[locale]/shop/[product]
Result

Production builds no longer require PostgreSQL connectivity.

PostgreSQL remains a runtime dependency for database-backed pages.

5. IMP-022 — Cart → Checkout Navigation
Status

COMPLETED

Commit

8e14b870a857f51d51e52b99bd60fd319cdc2db7

Parent

0c20d2e3d6f49caee880a9c6529051718b77c443

Objective

Enable navigation from Cart to Checkout when the Cart contains only resolvable active Catalog products.

Checkout Eligibility

Checkout is enabled only when:

Cart is not empty
AND
Catalog loading has completed
AND
every Cart product ID resolves to an active Catalog product
Delivered
canCheckout() eligibility function;
Cart → Checkout navigation;
locale-aware Checkout Link;
Catalog-loading-aware Checkout state;
unresolved-product protection;
dedicated unit tests.
Expected behavior
Empty Cart
    ↓
Checkout disabled

Catalog loading
    ↓
Checkout disabled

Unresolved product
    ↓
Checkout disabled

All products resolved
    ↓
Checkout enabled
    ↓
/checkout
Verification

The deployed application was manually verified.

Checkout initially remains disabled while Catalog data loads and becomes enabled after approximately one second.

Cart → Checkout navigation works.

6. Documentation Note — IMP-023 through IMP-029

This document was not updated milestone-by-milestone between IMP-022 and
IMP-030. In that interval, the following were implemented, code-reviewed,
QA-verified, and merged to `main` (git history is the authoritative source
for their exact commits and detail):

IMP-023 — Checkout Summary
IMP-024 — Checkout Customer Information
IMP-025 — Order persistence foundation (Order/OrderItem schema, snapshot model)
IMP-026 — Authoritative Order Creation from Checkout (+ IMP-026-FIX, IMP-026-FIX-TESTS)
IMP-027 — Identity & Authentication Foundation (+ IMP-027-FIX)
IMP-028 — Customer Authentication Surface
IMP-029 — Customer Order History (+ CR029-FIX, CR029-FIX-01)

This note exists so this document does not misrepresent the project as
stopping at IMP-022. Individually backfilling each of the above milestones
in this document's full format was not part of the IMP-030 task and has
not been done here; git history remains authoritative for that period
until/unless the Architect requests it be backfilled.

7. IMP-030 — Order Lifecycle & Status Management

Status

COMPLETED

Commit

Not yet committed at the time this entry was written — implementation
work only, pending Code Review before a commit is created. Update this
field with the actual commit hash once committed.

Objective

Make Order status a real domain lifecycle rather than only a database
enum, establishing the transition contract a future Payments module can
build on — without implementing Payments itself.

Approved Status Transitions

PENDING → PAID
PENDING → CANCELLED

PAID and CANCELLED are terminal states for this milestone — no transition
out of either exists.

Delivered

isValidOrderStatusTransition(from, to) — an explicit domain policy in
order/domain/order.ts (a lookup table of allowed transitions), not a
generic state-machine framework;
changeOrderStatus(orderId, nextStatus) application operation
(order/application/order-status.ts): loads the Order through
OrderRepository, validates the transition via the domain policy, persists
the new status, and returns a controlled result —
{ ok: true, order } | ORDER_NOT_FOUND | INVALID_STATUS_TRANSITION;
OrderRepository extended with findById (unscoped by owner — for future
internal callers, not customer-facing) and updateStatus;
Prisma implementation of both in prisma-order-repository.ts, inside
Order's existing infrastructure boundary;
changeOrderStatus exported through @/modules/order's public boundary —
not wired to any transport (no API route, no UI action) in this milestone;
zero database schema changes — the OrderStatus enum and Order.status
column already existed from IMP-025.

Architectural Decisions

changeOrderStatus is not customer-facing: no PATCH/PUT/DELETE route was
added to /api/orders (verified by an automated test asserting the route
module exports only POST), and the existing Customer order-history pages
were left untouched — status remains plain read-only text there.
findById (repository) is deliberately unscoped by owner, unlike the
existing findByIdForUser — it exists only for a future internal caller
(Payments/Admin), and nothing customer-facing calls it in this milestone.
The lifecycle rule is a plain Record<OrderStatus, OrderStatus[]> lookup,
matching Catalog's existing isPubliclyVisible(status) precedent for small
domain policy functions living alongside their entity — no state-machine
library or generic abstraction was introduced.

Security

Customers cannot modify Order status — no capability exists at any layer
(no route, no UI action, nothing in the public module surface a
customer-facing caller could reach).
Checkout continues to hardcode status: "PENDING" server-side; a
client-supplied status field in the checkout request body is ignored
(verified by an automated test asserting the authoritative application
function never receives a status field from the transport layer at all).
Existing IDOR protections (findByIdForUser, findManyByUserId) are
unchanged — confirmed by full regression of their existing test suite.
Auth.js remains outside the Order module; changeOrderStatus takes no
Identity dependency and no session/user context at all.

Tests / Validation

20 new tests: 8 domain (all six required transition cases plus terminal/
no-op checks), 7 application (fake-repository, all transition + not-found
cases), 3 repository integration (real Postgres findById/updateStatus),
2 route-surface (client-supplied status ignored; route exports only POST).
Full suite: 173/173 passing (153 pre-existing + 20 new), zero regressions.
pnpm typecheck, pnpm lint, pnpm build all passing;
pnpm format:check limited to the two pre-existing, unrelated warnings
(next.config.ts, pnpm-workspace.yaml) already tracked as known issues.

Remaining Limitations

changeOrderStatus has no transport layer yet (no API route, no Admin/
Payments UI) — intentionally out of scope for this milestone; a future
Payments or Admin milestone will need to wire an authorized caller to it.
No status-change audit/history is recorded — explicitly out of scope per
this milestone's own instructions (no OrderStatusHistory/audit table).

Next Milestone

NOT YET APPROVED. Payments, admin tooling, or any transport layer for
changeOrderStatus require separate Architect-approved requirements before
implementation begins.

8. Current Production State

The following functionality is currently implemented:

Catalog persistence;
PostgreSQL database;
Prisma persistence layer;
Catalog repository abstraction;
Catalog public API;
Catalog client boundary;
Shop;
Product Details;
Cart;
Catalog-backed Cart products;
Checkout page;
Cart → Checkout navigation;
locale-aware routing;
Vercel deployment;
Neon PostgreSQL production database.

Current architecture:

Browser
   ↓
Next.js Application
   ↓
┌──────────────────────────────────┐
│ Catalog │ Cart │ Checkout │ Shop │
└──────────────────────────────────┘
   ↓
Catalog Public API
   ↓
Application
   ↓
Repository
   ↓
Prisma
   ↓
Neon PostgreSQL
9. Known Limitations
Product Details

Product Details is dynamically rendered because database access must not be required during build.

ISR/revalidation may be considered later if traffic justifies it.

Do not introduce caching or ISR without a demonstrated requirement.

Checkout

The Checkout page and Cart → Checkout navigation exist.

Actual order creation, payment processing, inventory reservation, and server-side checkout validation are not yet implemented.

Client-side Checkout availability must never be treated as authorization or pricing authority.

Future order processing must validate server-side:

product existence;
ACTIVE status;
price;
quantity;
currency;
availability;
business rules.
E2E Testing

The project currently has unit/integration tests but no dedicated browser E2E testing infrastructure.

Browser-level testing should be introduced when justified by upcoming user-critical flows.

10. Next Milestone

Status

NOT YET APPROVED

The next milestone after IMP-030 must be explicitly defined by the
Architect before implementation begins.

The following must NOT be assumed to be approved:

Payments;
Stripe or any payment provider;
Inventory;
Admin tooling / Admin UI;
transport layer (API/UI) for changeOrderStatus;
roles/permissions;
ISR;
caching;
Search;
CMS;
or any other future subsystem.

These require separate requirements and architectural decisions.

11. Future Roadmap Areas

The following are possible future areas and are NOT yet approved implementation milestones:

Payments (using the IMP-030 lifecycle contract)
Inventory
Admin Catalog management
Admin Order management
Product management
Search
Promotions
Shipping
Tax calculation
Observability
Browser E2E testing
Performance optimization
Caching / ISR
Order status history / audit log

No item above should be implemented without explicit Architect approval.

12. Implementation Process

Every milestone follows this lifecycle:

ARCHITECT
    ↓
Requirements
    ↓
Architecture Decision
    ↓
Implementation Specification
    ↓
IMPLEMENTATION ENGINEER
    ↓
Commit
    ↓
CODE REVIEW
(ChatGPT + GitHub)
    ↓
Fixes if required
    ↓
LOCAL QA
(Claude)
    ↓
Manual acceptance when required
    ↓
Architect approval
    ↓
Next milestone
13. Code Review Policy

Code Review is performed through:

ChatGPT + GitHub repository access

Code Review must inspect the actual repository and target commit.

It must verify:

commit ancestry;
actual diff;
architecture boundaries;
affected modules;
database impact;
API impact;
security;
performance;
regressions;
unnecessary complexity;
scope compliance.

Claude/local resources should not be used for the primary Code Review when GitHub access is available.

14. Local QA Policy

Local QA is performed by Claude/local tooling when possible.

QA should verify:

automated tests;
type checking;
lint;
formatting;
production build;
runtime behavior;
API behavior;
browser behavior when required;
regression scenarios;
relevant performance behavior.

If browser automation is unavailable, browser-only scenarios must be reported as NOT VERIFIED, not assumed to pass.

15. Definition of Done

A milestone is complete only when:

requirements are satisfied;
architecture is preserved;
appropriate tests pass;
Code Review passes;
QA passes;
deployment succeeds when deployment is in scope;
no unresolved P0/P1/P2 defects remain;
scope has not expanded without approval;
the milestone commit is traceable;
this roadmap is updated.
16. Milestone Summary
Milestone	Status
IMP-021 — Catalog Persistence Foundation	COMPLETED
IMP-021-FIX-001 — Public API + Prisma Build Generation	COMPLETED
IMP-021-FIX-002 — Remove Build-Time DB Dependency	COMPLETED
IMP-022 — Cart → Checkout Navigation	COMPLETED
IMP-023 through IMP-029 (incl. fix follow-ups)	COMPLETED — see Section 6 note; git history authoritative
IMP-030 — Order Lifecycle & Status Management	COMPLETED
Next milestone	NOT YET APPROVED
17. Source of Truth

This document is the authoritative roadmap for implementation milestones.

If another document, chat message, implementation report, or local note conflicts with this roadmap, the conflict must be resolved by the Architect before implementation continues.