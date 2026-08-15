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

7. IMP-030 — Order Lifecycle & Status Management (incl. CR-030 atomicity fix)

Status

COMPLETED

Commit

08ebcba437a6af4e9073720f209e1fc7ad9a3bbb

Objective

Make Order status a real domain lifecycle rather than only a database
enum, establishing the transition contract a future Payments module can
build on — without implementing Payments itself.

Approved Status Transitions

PENDING → PAID
PENDING → CANCELLED

PAID and CANCELLED are terminal states for this milestone — no transition
out of either exists.

QA Finding and Fix (CR-030 / QA-030-01)

Code Review/QA identified a P2 concurrency defect in the initial IMP-030
implementation: `changeOrderStatus` read the current status, validated
the transition, and only then wrote the new status as a separate step.
Two concurrent callers could both read PENDING and both pass validation
before either write landed, allowing an effectively forbidden
terminal-state transition (e.g. an Order ending up CANCELLED after
already being PAID by a racing request). This was fixed by making the
persistence step itself conditional and atomic — see "Delivered" and
"Architectural Decisions" below. The fix is implemented, tested (including
a genuine parallel-execution regression test against the real database),
and validated as of this entry.

Delivered

isValidOrderStatusTransition(from, to) — an explicit domain policy in
order/domain/order.ts (a lookup table of allowed transitions), unchanged
by the CR-030 fix — the domain layer was never the source of the race;
changeOrderStatus(orderId, nextStatus) application operation
(order/application/order-status.ts): loads the Order, validates the
transition via the domain policy, performs an atomic conditional
persistence write, and returns a controlled result —
{ ok: true, order } | ORDER_NOT_FOUND | INVALID_STATUS_TRANSITION |
ORDER_STATUS_CHANGED (the last one is the CR-030 concurrency-conflict
result: the transition was valid when checked, but another caller changed
the Order's status before this operation's write could apply);
OrderRepository.updateStatusIfCurrent(orderId, expectedStatus, nextStatus)
replaces the earlier, unconditional updateStatus — implemented as a
single `UPDATE ... WHERE id = ? AND status = ?` (Prisma `updateMany`),
so the database itself rejects a write whose expected status no longer
matches, rather than the application layer trusting a status it read
earlier; returns the updated Order when the write applied, or null when
it didn't (zero rows matched);
OrderRepository.findById remains unscoped by owner — for future internal
callers, not customer-facing;
changeOrderStatus exported through @/modules/order's public boundary —
still not wired to any transport (no API route, no UI action);
zero database schema changes, before or after the CR-030 fix — no
version/revision column was added; the existing status column itself is
the condition the atomic write checks.

Architectural Decisions

The concurrency guarantee lives at the persistence boundary
(`updateStatusIfCurrent`'s WHERE clause), not in application-level
sequencing — the application layer's earlier read-then-validate step can
be stale by design; the database write is what actually enforces
correctness, because Postgres evaluates that WHERE clause against the
row's real committed state at write time and serializes concurrent
writers to the same row.
No version/revision column, no application-level lock, no queue, and no
generic optimistic-concurrency framework were introduced — the Order's
own `status` column doubles as the condition, since transitions are
one-directional and the field being protected is the same field the
condition checks.
changeOrderStatus is not customer-facing: no PATCH/PUT/DELETE route was
added to /api/orders (verified by an automated test asserting the route
module exports only POST), and the existing Customer order-history pages
were left untouched — status remains plain read-only text there.
The lifecycle rule remains a plain Record<OrderStatus, OrderStatus[]>
lookup, matching Catalog's existing isPubliclyVisible(status) precedent —
no state-machine library or generic abstraction was introduced.

Security

Customers cannot modify Order status — no capability exists at any layer
(no route, no UI action, nothing in the public module surface a
customer-facing caller could reach).
Checkout continues to hardcode status: "PENDING" server-side; a
client-supplied status field in the checkout request body is ignored
(verified by an automated test).
Existing IDOR protections (findByIdForUser, findManyByUserId) and the
composite keyset pagination (createdAt DESC, id DESC) from CR-029 are
unchanged — confirmed by full regression of their existing test suite and
by direct diff inspection.
Auth.js remains outside the Order module; changeOrderStatus takes no
Identity dependency and no session/user context at all.

Tests / Validation

179/179 tests passing (153 before IMP-030, +20 from the initial IMP-030
implementation, +6 net from the CR-030 fix — some tests were replaced
rather than purely added, since updateStatus was superseded by
updateStatusIfCurrent). CR-030-specific coverage: domain policy unchanged
and re-verified; application-layer ORDER_STATUS_CHANGED case via a fake
repository with genuine conditional-update semantics; real-database tests
proving PENDING → PAID and PENDING → CANCELLED persist and are
independently re-readable; real-database tests proving a conditional
update correctly refuses to apply when the expected status no longer
matches (both PAID-expecting-PENDING and CANCELLED-expecting-PENDING
cases); a genuine parallel-execution (`Promise.all`) concurrency race
against a real Postgres row, asserting exactly one side wins, the other
receives a null/no-op result, and the final database state matches the
winner. pnpm typecheck, pnpm lint, pnpm build all passing; pnpm
format:check limited to the two pre-existing, unrelated warnings
(next.config.ts, pnpm-workspace.yaml) already tracked as known issues.
Manual verification additionally executed the full transition/rejection/
concurrency/cleanup sequence live through changeOrderStatus() against the
real database, independently of the automated suite.

Remaining Limitations

changeOrderStatus has no transport layer yet (no API route, no Admin/
Payments UI) — intentionally out of scope; a future Payments or Admin
milestone will need to wire an authorized caller to it.
No status-change audit/history is recorded — explicitly out of scope.
A caller that receives ORDER_STATUS_CHANGED gets no automatic retry —
retrying (or not) is left to whichever future caller actually needs the
behavior; this was a deliberate minimal-scope decision, not an oversight.

Next Milestone

NOT YET APPROVED. Payments, admin tooling, or any transport layer for
changeOrderStatus require separate Architect-approved requirements before
implementation begins.

8. IMP-031 — Checkout Submission Idempotency

Status

COMPLETED (implementation + validation; not yet committed — see Commit below)

Commit

Not yet committed at the time this entry was written — implementation and
validation are complete, pending Code Review before a commit is created.
Update this field with the real commit SHA immediately once the IMP-031
commit is created; do not leave this placeholder in a completed entry
after that point.

Objective

Prevent duplicate Orders when the same logical Checkout submission is
retried (network timeout, double-click, client retry logic) or arrives as
genuinely concurrent duplicate requests — without introducing any new
infrastructure (no Redis, queue, event bus, CQRS, or generic
optimistic-concurrency framework). One logical Checkout submission must
produce exactly one Order, under retries and under real concurrency.

Requirements (approved architecture)

Database-enforced uniqueness, not an application-level "check, then
insert" sequence — that pattern cannot rule out two concurrent callers
both passing the check before either insert lands. `POST /api/orders`
requires a client-supplied `Idempotency-Key` header (never a body field)
on every request. Every newly created Order remains `PENDING` —
`changeOrderStatus()` is not wired to this endpoint.

Architecture Decisions

Idempotency is represented as two nullable columns directly on `Order`
(`idempotencyKey`, `idempotencyRequestHash`), not a dedicated persistence
structure — the simplest design that is actually correct for both
authenticated and guest checkout. A naive `UNIQUE(userId, idempotencyKey)`
compound constraint was explicitly rejected: Postgres treats every NULL
`userId` as distinct from every other NULL, so two different guest
submissions could share one key and both pass that constraint, defeating
idempotency exactly for the guest case the requirements called out.
Instead, `idempotencyKey` alone is `@unique` — a single-column unique
constraint has no such gap, since the key itself (not `userId`) is what
must never repeat, and it is required on every real request so it is
never NULL in practice. Orders created without a key (the generic
internal `createOrder` command, unrelated to Checkout) coexist freely,
since Postgres allows unlimited NULLs in a nullable unique column.

`OrderRepository.createIdempotent()` performs the persist and the
duplicate-detection as one database operation — a single `INSERT`,
relying on Postgres's own unique-constraint enforcement to decide which
of two concurrent callers actually wins, never a prior existence check.
The loser's constraint violation is resolved by re-reading the row that
actually got persisted and comparing a request fingerprint
(`idempotencyRequestHash`, a SHA-256 hash of the client-submitted
customer info, cart items, delivery amount, and server-resolved `userId`)
against the caller's own: an equal fingerprint means a genuine retry
(`"duplicate"`, the existing Order is returned); a different fingerprint
means the same key was reused for a materially different submission —
including a different resolved user — and is rejected outright
(`"conflict"`), never silently returning the mismatched Order. This same
mechanism is what provides ownership isolation: a submission's resolved
`userId` is part of what the fingerprint covers, so a different user (or
a guest) presenting someone else's key cannot receive that other
person's Order — the fingerprint mismatch is rejected as a conflict.

Database Changes

Migration `20260815102154_add_order_idempotency_key`: adds
`idempotencyKey TEXT` (nullable, unique) and `idempotencyRequestHash
TEXT` (nullable) to `orders`. No other schema changes. No new
tables/models — this is the minimal, sufficient shape per the
requirements' explicit preference for a field over a dedicated structure
where a field suffices.

API Contract

`POST /api/orders` requires an `Idempotency-Key` request header
(non-body): required (400 `IDEMPOTENCY_KEY_REQUIRED` if absent), bounded
length 16-128, restricted to `[A-Za-z0-9_-]` (400
`INVALID_IDEMPOTENCY_KEY` otherwise) — an opaque correlation token only,
never authorization and never a payload carrier; a same-named field in
the JSON body is never read. A brand-new key returns 201 with the new
`PENDING` Order. A replay of the same key with the same logical
submission returns 200 with the original Order (nothing new persisted).
The same key reused for a different submission (including a different
resolved user) returns 409 `IDEMPOTENCY_KEY_CONFLICT` — the original
Order is never returned to the second caller.

Security

Client still cannot control Order status, price, currency, or delivery
amount — createOrderFromCheckout's existing server-side resolution is
completely unchanged by this milestone. The idempotency key is a
correlation token only: `userId` is still resolved solely from the
Auth.js session via Identity's `getCurrentUser()`, exactly as before;
the key grants no capability and bypasses no check. Ownership isolation
(a user cannot retrieve another user's Order via a guessed/reused key)
is enforced by the request-fingerprint mechanism described above. CR-029
IDOR protections (`findByIdForUser`/`findManyByUserId`, composite keyset
pagination) and CR-030's atomic status-transition guarantee
(`updateStatusIfCurrent`) are both completely unmodified by this
milestone — verified by full regression of their existing test suites.

Known, accepted limitation: two different guests who coincidentally
reuse the exact same key value for genuinely identical cart/customer
data cannot be distinguished by this design, since the system has no
guest-session concept to scope by — the second guest would receive the
first guest's Order summary (id, status, subtotal/delivery/total,
currency only; no PII beyond what `POST /api/orders` already returns on
creation). This is an inherent limitation of key-based idempotency
without a session/account scope, not an oversight; introducing a guest
session mechanism is out of scope for this milestone and would need its
own Architect-approved requirements.

Tests

45 new/changed tests: a pure-function unit suite for the request
fingerprint (determinism, item-order independence, sensitivity to every
covered field including `userId`); fake-repository application-layer
tests for all required cases (new key, replay, different keys, payload
conflict, ownership-isolation conflict, guest retry, authenticated
retry, backward-compatible no-key fallback, existing validation ordering
preserved); real-Postgres repository integration tests for created/
duplicate/conflict outcomes, independent re-reads confirming exactly one
row persisted per key, and a genuine `Promise.all` concurrency race
(plus a 10-iteration repeat) proving exactly one `"created"` and one
`"duplicate"` outcome every time; a full-pipeline real-Catalog +
real-repository test (including its own real concurrency race); and
route-level tests for the header contract (missing/too-short/too-long/
invalid-charset), body-field-is-never-read, and the 201/200/409 status
mapping. All pre-existing CR-029/CR-030/IMP-026 regression tests
continue to pass unmodified except for a required fake-repository stub
addition (`createIdempotent`) in two unrelated test files, needed only
because that method is now part of the `OrderRepository` interface
shape.

Validation Results

`pnpm test`: 224/224 passing (179 pre-existing + 45 new), 21 test files,
zero regressions. `pnpm typecheck`: clean. `pnpm lint`: clean. `pnpm
format:check`: limited to the two pre-existing, unrelated warnings
(`next.config.ts`, `pnpm-workspace.yaml`). `pnpm build`: succeeded (all
15 routes compiled/prerendered).

Runtime Verification

Manually verified against the real Neon database through the actual
running `POST /api/orders` route (not a test double): a first request
returns 201 and a new Order; a retry with the same key returns 200 and
the identical Order id; a same-key-different-payload request returns 409
`IDEMPOTENCY_KEY_CONFLICT`; a different key returns 201 with an
independent Order; two genuinely concurrent HTTP requests with the same
key (fired in parallel against the running dev server) returned exactly
one 201 and one 200, both referencing the same Order id; a same-key
request from a second "guest" with different customer data returned 409
rather than the first guest's Order. All manually-created test Orders
were deleted afterward and confirmed removed.

Remaining Limitations

changeOrderStatus() is still not wired to any transport — unaffected by
this milestone, unchanged from IMP-030. The guest-key-collision
limitation described under Security above. No idempotency-key expiry/
cleanup policy exists — keys and their Orders persist indefinitely,
consistent with Orders themselves having no retention policy; introducing
one is a future decision, not required by this milestone's objective.

Next Milestone State

NOT YET APPROVED — unchanged. This milestone does not approve Payments,
Inventory, Admin tooling, a transport layer for changeOrderStatus, or any
other future subsystem; see Section 11 (Next Milestone) below.

9. Current Production State

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

10. Known Limitations
Product Details

Product Details is dynamically rendered because database access must not be required during build.

ISR/revalidation may be considered later if traffic justifies it.

Do not introduce caching or ISR without a demonstrated requirement.

Checkout

The Checkout page and Cart → Checkout navigation exist.

Server-side Order creation is implemented: `createOrderFromCheckout()`
(IMP-026, hardened by IMP-026-FIX) resolves product existence, ACTIVE
status, price, and currency from Catalog server-side, validates quantity
and monetary bounds, and persists the Order atomically — a client can
never author these values. Order ownership (IMP-029) and lifecycle status
transitions (IMP-030 / CR-030) are also implemented. Checkout submission
idempotency (IMP-031) is also implemented: a required `Idempotency-Key`
header prevents a retried or genuinely concurrent duplicate submission
from creating more than one Order. Payment processing and inventory
reservation are not yet implemented — every created Order starts and
generally remains `PENDING` pending a future Payments milestone.
Client-side Checkout availability must never be treated as authorization
or pricing authority; this was always the server-side boundary's
responsibility, and it now genuinely exists.

E2E Testing

The project currently has unit/integration tests but no dedicated browser E2E testing infrastructure.

Browser-level testing should be introduced when justified by upcoming user-critical flows.

11. Next Milestone

Status

NOT YET APPROVED

The next milestone after IMP-031 must be explicitly defined by the
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

12. Future Roadmap Areas

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

13. Implementation Process

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
14. Code Review Policy

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

15. Local QA Policy

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

16. Definition of Done

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
17. Milestone Summary
Milestone	Status
IMP-021 — Catalog Persistence Foundation	COMPLETED
IMP-021-FIX-001 — Public API + Prisma Build Generation	COMPLETED
IMP-021-FIX-002 — Remove Build-Time DB Dependency	COMPLETED
IMP-022 — Cart → Checkout Navigation	COMPLETED
IMP-023 through IMP-029 (incl. fix follow-ups)	COMPLETED — see Section 6 note; git history authoritative
IMP-030 — Order Lifecycle & Status Management (incl. CR-030)	COMPLETED
IMP-031 — Checkout Submission Idempotency	COMPLETED (pending commit — see Section 8)
Next milestone	NOT YET APPROVED
18. Source of Truth

This document is the authoritative roadmap for implementation milestones.

If another document, chat message, implementation report, or local note conflicts with this roadmap, the conflict must be resolved by the Architect before implementation continues.