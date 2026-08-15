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

8. IMP-031 — Checkout Submission Idempotency (incl. IMP-031-FIX / CR-031 fixes)

Status

COMPLETED

Commit

d122508f9447629c5f5bb0ac1964f58dca6b89c8 (initial IMP-031)
0fc9079f31c9ccce3a9d82736705b93b3ae13bf8 (IMP-031-FIX / CR-031)

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

Code Review Findings and Fixes (IMP-031-FIX / CR-031)

Code Review of the initial IMP-031 implementation found two P2 defects,
both now fixed:

CR-031-01 — locale missing from the idempotency fingerprint. Root cause:
the fingerprint covered customer, items, deliveryAmountMinor, and userId,
but not `locale` — yet Checkout resolves localized Catalog product names
through the effective locale and stores them in the OrderItem snapshot.
Two requests differing only in locale therefore produced identical
fingerprints, so the second request would have been replayed as a
`200 duplicate` returning the first locale's Order instead of correctly
being rejected as a `409 IDEMPOTENCY_KEY_CONFLICT`. Fix: `locale` (the
already-normalized, effective locale `createOrderFromCheckout` receives —
never a raw, un-normalized client field) is now part of the fingerprint,
in `computeCheckoutSubmissionFingerprint`
(`src/modules/order/application/idempotency.ts`).

CR-031-02 — a successful idempotent submission could become unreplayable
if Catalog state changed afterward. Root cause: the original flow always
resolved Catalog (`getProductsByIds`) before ever consulting idempotency
state; if the original product later became unavailable, a retry with
the same key failed at Catalog resolution (`UNRESOLVED_PRODUCTS`, HTTP
400) instead of replaying the original, already-persisted Order — even
though the retry was the exact same logical submission. Fix: a new
repository method, `OrderRepository.findIdempotencyRecord(idempotencyKey)`
(a plain read of the already-unique `idempotencyKey`/
`idempotencyRequestHash` columns — no new table, no schema change beyond
what IMP-031 already added), lets `createOrderFromCheckout` check for an
existing claim *before* calling Catalog at all. The fingerprint itself
was deliberately left able to be computed from client-submitted data
alone (customer, items, deliveryAmountMinor, locale, resolved userId) —
it never depended on Catalog-resolved data (product name/price) to begin
with, which is what made this early check possible without weakening
what the fingerprint identifies: the *logical submission*, not the
*resolved snapshot*. The persisted Order remains the historical snapshot,
built once, at original creation time, exactly as before.

Corrected flow in `createOrderFromCheckout`
(`src/modules/order/application/checkout-order.ts`): after cart-shape and
quantity validation (unchanged, pure, no I/O) — if an `idempotencyKey` is
present, compute the fingerprint from client-submitted data and call
`findIdempotencyRecord`. A match with an equal fingerprint returns the
existing Order immediately (`200`), Catalog is never touched. A match
with a different fingerprint returns `409 IDEMPOTENCY_KEY_CONFLICT`
immediately, also without touching Catalog. No match at all (brand-new
key, or no key supplied) falls through to the unchanged Catalog
resolution → snapshot-build → persist path, ending at the same
`createIdempotent()` atomic INSERT as before. This preserves every
existing guarantee: two concurrent *first* requests for a brand-new key
both see no match here and both proceed to `createIdempotent`, which —
unchanged — resolves the race via Postgres's own unique constraint,
exactly as validated under IMP-031's original concurrency tests. The
early lookup is not itself part of the atomicity guarantee; it is a
correctness fix for when a *known* key should short-circuit Catalog
entirely, layered on top of an atomicity mechanism that was already
correct.

No new infrastructure, no new table, no schema change: `findIdempotencyRecord`
reads the same `idempotencyKey`/`idempotencyRequestHash` columns IMP-031
already added.

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

IMP-031-FIX / CR-031 adds 9 further tests: 3 fingerprint unit tests
(same locale → same hash; different locale → different hash; a related
but distinct locale tag, e.g. `en` vs `en-US`, is never treated as
equal); 4 fake-repository application-layer tests (same key + same
locale replays normally; same key + different locale →
`IDEMPOTENCY_KEY_CONFLICT`; replaying a key after its original product
becomes unresolvable returns the original Order rather than
`UNRESOLVED_PRODUCTS`; a *genuinely new* key still correctly fails with
`UNRESOLVED_PRODUCTS` when its own product is unavailable, proving the
fix only affects replays of an already-claimed key, not first-time
validation); 2 real-Postgres repository tests for
`findIdempotencyRecord` (returns the persisted Order + hash for a known
key; returns `null` for an unused key). All pre-existing IMP-031
concurrency tests (the real-Postgres `Promise.all` race, its 10-iteration
repeat, and the full-pipeline real-Catalog + real-repository race) are
unmodified and continue to pass — the atomicity mechanism itself
(`createIdempotent`'s constraint-enforced `INSERT`) was not touched by
this fix.

Validation Results

`pnpm test`: 233/233 passing (224 pre-existing + 9 new), 21 test files,
zero regressions. `pnpm typecheck`: clean. `pnpm lint`: clean. `pnpm
format:check`: limited to the two pre-existing, unrelated warnings
(`next.config.ts`, `pnpm-workspace.yaml`). `pnpm build`: succeeded (all
15 routes compiled/prerendered).

Runtime Verification

IMP-031 (original): manually verified against the real Neon database
through the actual running `POST /api/orders` route (not a test double):
a first request returns 201 and a new Order; a retry with the same key
returns 200 and the identical Order id; a same-key-different-payload
request returns 409 `IDEMPOTENCY_KEY_CONFLICT`; a different key returns
201 with an independent Order; two genuinely concurrent HTTP requests
with the same key (fired in parallel against the running dev server)
returned exactly one 201 and one 200, both referencing the same Order
id; a same-key request from a second "guest" with different customer
data returned 409 rather than the first guest's Order. All
manually-created test Orders were deleted afterward and confirmed
removed.

IMP-031-FIX / CR-031: CR-031-01 could not be exercised through the live
HTTP route as a genuine locale mismatch, because this deployment's
`routing.locales` currently supports only `["en"]` — the route normalizes
any other submitted locale back to the default before
`createOrderFromCheckout` ever sees it, so two live requests can never
actually reach it with two different *effective* locales today. This is
verified by direct inspection of `route.ts`'s normalization and is exactly
why the fix uses the effective (post-normalization) locale rather than a
raw client field — the fix is correctly exercised by the automated
fingerprint and application-layer tests instead, which call
`createOrderFromCheckout` directly with two different effective locales.
CR-031-02 was verified live against real data: the real seeded product
"1" was created via `createOrderFromCheckout` under a fresh idempotency
key (real Catalog + real repository), then temporarily set to `ARCHIVED`
directly in the database to simulate it becoming unavailable, then the
same request was retried with the same key — the retry correctly returned
the original Order (`created: false`) rather than `UNRESOLVED_PRODUCTS`.
The product's status was restored to `ACTIVE` immediately afterward and
confirmed restored; the manually-created test Order was deleted and
confirmed removed.

Remaining Limitations

changeOrderStatus() is still not wired to any transport — unaffected by
this milestone, unchanged from IMP-030. The guest-key-collision
limitation described under Security above. No idempotency-key expiry/
cleanup policy exists — keys and their Orders persist indefinitely,
consistent with Orders themselves having no retention policy; introducing
one is a future decision, not required by this milestone's objective.
No P0/P1/P2/P3 issues remain open after IMP-031-FIX; CR-031-01 and
CR-031-02 are both fixed and verified.

Next Milestone State

NOT YET APPROVED — unchanged. This milestone does not approve Payments,
Inventory, Admin tooling, a transport layer for changeOrderStatus, or any
other future subsystem; see Section 11 (Next Milestone) below.

9. IMP-032 — Payment Foundation

Status

COMPLETED

Commit

b2b3090c3c6a18b8c655fa65c043518ba953ba8c

Objective

Establish a clean, provider-neutral internal representation of "the
payment that pays for an Order" so a future payment-provider milestone
(Stripe, PayPal, or otherwise) can integrate without redesigning the
Payment domain. Explicitly not a payment-processing milestone: no
external provider, no webhook, no UI, no route. Every Payment this
milestone can create starts and remains `PENDING`.

Requirements

Dedicated Payment module (`src/modules/payment/`, singular — distinct
from the pre-existing empty `src/modules/payments/` scaffold, which this
milestone does not touch), following the Catalog/Order module convention
(`domain/`, `application/`, `repositories/`, `infrastructure/`, a single
`index.ts` public boundary). Payment amount/currency must be derived
from the authoritative Order, never client-supplied. Duplicate Payment
creation for the same Order must be prevented by a database constraint,
verified under genuine concurrency. No customer-facing route. No
external provider, webhook, refund, inventory, shipping, UI, queue,
event bus, or distributed lock.

Architecture Decisions

One Order has at most one current Payment — `Payment.orderId` is
`@unique`, both encoding the relationship at the database level and
giving the duplicate-creation guard (§12/§13) its atomicity, via the
exact same pattern CR-030/IMP-031 already established:
`PaymentRepository.create()` performs a single `INSERT`; Postgres's own
unique constraint decides which of two concurrent callers wins; the
loser's constraint violation is caught, the row that actually won is
re-read, and a controlled `"duplicate"` outcome is returned — never a
prior "does it exist?" read, which would be race-prone. This is
`OrderRepository.createIdempotent`'s mechanism, applied to
`Payment.orderId` instead of `Order.idempotencyKey`.

`Payment` references `Order` by id rather than duplicating the rest of
the Order (customer info, line items) — nothing about a payment needs
that data, and Order/OrderItem remain the single source of truth for it.
`amountMinor`/`currency` ARE copied onto Payment, deliberately: they are
the payment's immutable payable snapshot at initialization time, exactly
mirroring how OrderItem snapshots a Product's name/price rather than
referencing Product live.

The Payment domain (`payment.ts`) imports nothing beyond its own types —
no Prisma, no Next.js, no provider SDK, matching Order's domain exactly.
It does not import Order's domain either: the Order-eligibility check
(PENDING/PAID/CANCELLED) lives in the application layer
(`initialize-payment.ts`), consistent with this codebase's existing
convention that cross-module dependencies happen at the application
layer, never inside a domain file.

`getOrderById` was added to Order's public boundary (`@/modules/order`) —
a thin, already-tested pass-through to the existing
`OrderRepository.findById` (introduced in IMP-030, unscoped by owner, for
internal callers only). This is the one necessary, minimal touch to the
Order module this milestone required: Payment cannot resolve the
authoritative Order server-side without either reaching into Order's
repository internals (forbidden by the module-boundary rule) or Order
exposing some unscoped lookup — and no such export existed yet.
`initializePayment` does not import this directly, though: Order's public
barrel re-exports `.tsx` presentation components this project's Vitest
config has no JSX transform for (unlike Catalog's barrel, which is
JSX-free — the reason `createOrderFromCheckout` can safely import
Catalog's `getProductsByIds` directly). To keep the Payment application
layer cleanly unit-testable against real Order data without that
transform failure, the Order lookup is an injected `GetOrderById`
function parameter; only `@/modules/payment/index.ts` — the wiring layer
— imports the real `@/modules/order` barrel and supplies the real
`getOrderById`.

A Payment status lifecycle policy (`isValidPaymentStatusTransition`) and
an atomic `PaymentRepository.updateStatusIfCurrent` were established now
— mirroring Order's exact CR-030 pattern — even though nothing in this
milestone calls either yet (no provider exists to report a result). This
is the same choice IMP-030 made for `changeOrderStatus`/
`isValidOrderStatusTransition`, shipped unwired until a real caller
existed; doing the same here means a future payment-processing milestone
has the atomic primitive ready without redesigning this repository.

Payment Domain

`PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED"`.
`PENDING` is the only non-terminal status; a Payment is initialized as
`PENDING` and, once a future milestone processes it, moves exactly once
to one of the three terminal states. `providerReference: string | null`
is the one field reserved for a future provider integration (e.g. a
Stripe PaymentIntent id) — always `null` today, deliberately
provider-neutral (never a provider-specific concept like PaymentIntent
in the domain itself).

Payment Lifecycle

Allowed: `PENDING -> SUCCEEDED`, `PENDING -> CANCELLED`. Forbidden:
every transition out of `SUCCEEDED`/`FAILED`/`CANCELLED` (all three are
terminal), and the `PENDING -> PENDING` no-op. Creating a Payment is
explicitly NOT the same as the Order being paid — `initializePayment`
never mutates Order status; only a future payment-processing milestone,
once an external provider actually reports success, is responsible for
that separate `changeOrderStatus` transition.

Database Changes

Migration `20260815133630_add_payment_foundation`: adds enum
`PaymentStatus` and table `payments` (`id` cuid PK; `orderId` unique,
FK to `orders.id` with `onDelete: Cascade` — a Payment has no
independent meaning once its Order is gone, the same reasoning as
`OrderItem`'s cascade; `status` defaulting to `PENDING`; `amountMinor`
Int; `currency` char(3); `providerReference` nullable text;
`createdAt`/`updatedAt`). Index on `status` (mirrors `Order`'s own
`@@index([status])`). No separate index on `orderId` — its `@unique`
constraint already provides one. `Order` gained one required,
Prisma-mandated back-relation field (`payment Payment?`) — purely
relational, not a new business-data column. No other schema changes.

Repository Design

`PaymentRepository`: `create` (atomic create-or-detect-duplicate, per
above), `findById`, `findByOrderId`, `updateStatusIfCurrent`.
Deliberately not a generic CRUD repository — no `delete`, no unconditional
`update`, no listing. `create` never accepts a `status` — the Prisma
implementation always initializes `PENDING`, the same way
`createOrderFromCheckout` never lets a caller choose an Order's initial
status.

Application Contract

`initializePayment(repository, getOrder, orderId)`: resolves the Order via
`getOrder`; `ORDER_NOT_FOUND` if absent; `ORDER_ALREADY_PAID` if
`order.status === "PAID"`; `ORDER_CANCELLED` if `"CANCELLED"`; otherwise
derives `amountMinor`/`currency` from the Order and calls
`repository.create()`; `PAYMENT_ALREADY_EXISTS` (carrying the existing
Payment) if a Payment already exists for this Order; otherwise
`{ ok: true, payment }`. No amount/currency/status parameter exists on
this function at all — there is no input a caller could even attempt to
override them with. Exported through `@/modules/payment`'s public
boundary as `initializePayment(orderId)`; not wired to any transport.

Security

Client cannot control payment amount, currency, or status through this
foundation — no such parameters exist on `initializePayment`'s public
signature; amount/currency are always the resolved Order's own values,
status is always hardcoded `PENDING` in the repository implementation.
No customer-facing route was added — `initializePayment` has no
ownership/session check today because nothing customer-facing can reach
it; a future milestone that exposes this to any transport must add its
own ownership check first, the same explicit obligation already
documented on `OrderRepository.findById`. Duplicate Payment creation is
prevented at the database level (§13). No Prisma type or error leaks
into the domain or application layers — verified by inspection. CR-029
IDOR/pagination, CR-030 atomic status transitions, and IMP-031 Checkout
idempotency are all completely unmodified by this milestone — verified
by full regression of their existing test suites.

Concurrency Verification

Real Postgres, both at the repository level and the full application-
service level: two genuinely concurrent `PaymentRepository.create()` (and
separately, `initializePayment()`) calls for the same Order consistently
produced exactly one `"created"`/successful result and one
`"duplicate"`/`PAYMENT_ALREADY_EXISTS` result referencing the identical
Payment, with exactly one row ever persisted. A concurrent pair of
`initializePayment()` calls against a CANCELLED Order was also verified
to create zero Payments under real concurrency.

Tests

Domain: 12 tests covering every allowed/forbidden `PaymentStatus`
transition, including all three terminal states and cross-terminal
transitions. Application (`initialize-payment.test.ts`): not-found,
successful initialization with amount/currency verification, a
differing-amount case proving no hardcoded value, PAID rejection,
CANCELLED rejection, duplicate detection returning the existing Payment,
proof that Order status is never mutated, plus a real-repository +
real-concurrency describe block (the two concurrency scenarios above).
Repository (`prisma-payment-repository.test.ts`): create/duplicate
outcomes, `findById`/`findByOrderId` (hit and miss), `updateStatusIfCurrent`
persistence and conditional-mismatch behavior, and a real concurrent-race
test. Full existing suite (Order, Checkout, Catalog, Identity, CR-029,
CR-030, IMP-031) re-run and confirmed passing unmodified.

Validation Results

`pnpm test`: 267/267 passing (233 pre-existing + 34 new), 24 test files,
zero regressions. `pnpm typecheck`: clean. `pnpm lint`: clean. `pnpm
format:check`: limited to the two pre-existing, unrelated warnings
(`next.config.ts`, `pnpm-workspace.yaml`). `pnpm build`: succeeded (all
15 routes compiled/prerendered — Payment adds no route).

Runtime Verification

Manually verified against the real Neon database (temporary script,
deleted afterward): a PENDING Order initializes a Payment successfully;
repeating it returns `PAYMENT_ALREADY_EXISTS` with the same Payment; a
PAID Order is rejected with `ORDER_ALREADY_PAID` and creates no Payment
row; a CANCELLED Order is rejected with `ORDER_CANCELLED` and creates no
Payment row; two genuinely concurrent initializations for a fresh
PENDING Order produced exactly one success and one
`PAYMENT_ALREADY_EXISTS`, both referencing the same Payment, with
exactly one database row. All manually-created Orders/Payments were
deleted afterward and confirmed removed.

Remaining Limitations

No external payment provider — every Payment starts and remains
`PENDING` indefinitely until a future milestone processes it. No
transport (route/UI) calls `initializePayment` yet — intentionally out
of scope, exactly like `changeOrderStatus` after IMP-030. No webhook, no
refund, no retry-against-a-provider logic — none of these can exist
without a provider first. `updateStatusIfCurrent` and
`isValidPaymentStatusTransition` are established but unused by any
caller in this milestone, by design (see Architecture Decisions above).

Next Milestone State

NOT YET APPROVED. A future payment-provider milestone (e.g. IMP-033)
must be explicitly defined by the Architect — including which provider,
webhook handling, and how `initializePayment`/`updateStatusIfCurrent`
get wired to a real transport — before implementation begins. This
milestone approves only the internal foundation documented above.

10. IMP-033 — Payment Provider Port

Status

COMPLETED

Commit

4e48f978613bdd9e7db63343fc139c846f1293ea

Objective

Establish the minimal, provider-neutral outbound port a future concrete
payment provider (Stripe, PayPal, or otherwise) will implement, so that
integration can happen without redesigning the Payment domain
(IMP-032). This milestone defines the port's shape only — no provider
implementation, no PaymentAttempt entity, no database change, no route,
no webhook, no UI.

Requirements

A `PaymentProvider` interface with exactly one capability: starting a
payment. A provider-neutral `StartPaymentInput` (derived from the
authoritative, already-persisted `Payment` — never client input) and a
provider-neutral `StartPaymentResult`. Exported through
`@/modules/payment`'s public boundary. Focused contract tests proving
the port is genuinely implementable. No concrete provider, no wiring
into `initializePayment` or any other caller, no schema change, no new
infrastructure.

Architecture Decisions

`PaymentProvider` lives in a new `src/modules/payment/providers/`
directory — parallel to `repositories/`, since both are outbound ports
(one to Postgres, one to an eventual external payment gateway), not
business logic. The file itself has zero imports, not even from
Payment's own domain module: `StartPaymentInput`/`StartPaymentResult`
are built from primitives (`paymentId: string`, `amountMinor: number`,
`currency: string`, an opaque `providerReference: string` on success, a
single collapsed `PROVIDER_ERROR` on failure) so the port cannot
accidentally accrue a dependency, provider-specific field, or Payment
Prisma-shape leakage merely by association.

The result's failure case is deliberately a single `PROVIDER_ERROR`
rather than an open-ended taxonomy of provider-specific failure reasons
(a declined card, an expired session, a network timeout) — that
taxonomy cannot be designed correctly in the abstract before a real
provider exists to observe it; a future adapter and its caller are the
right place to refine this.

The port is established with zero callers, deliberately — the same
choice already made twice in this codebase (`changeOrderStatus`/
`isValidOrderStatusTransition` in IMP-030, `PaymentRepository.updateStatusIfCurrent`
in IMP-032): shipping the abstraction ahead of its first real
implementation and caller means a future payment-provider milestone can
build directly on it without redesigning the shape.

Database Changes

None. This milestone is TypeScript interfaces only.

API

None. No route, no webhook, no UI. `PaymentProvider` is not wired to
`initializePayment` or any other caller.

Security

`StartPaymentInput` carries no client-controlled field — a caller can
only construct it from an already-persisted, server-resolved `Payment`
(`paymentId`, `amountMinor`, `currency` all originate there, not from
any request body). No PII. No secret/credential of any kind is part of
this port — provider credentials belong to a future concrete adapter,
never to this interface. This milestone does not change Order/Checkout
behavior, CR-029 IDOR/pagination, CR-030 atomic transitions, or IMP-031
idempotency in any way — verified by full regression of their existing
test suites.

Tests

5 contract tests (`payment-provider.test.ts`) against a minimal
in-memory fake defined only in the test file (never exported, never
shipped) — the same role fake repositories play elsewhere in this
codebase: successful `startPayment` returns a non-empty opaque
`providerReference`; failure returns a controlled `PROVIDER_ERROR`
rather than throwing; the fake receives exactly the three documented
input fields and nothing else; the port is usable through its type
alone (a small helper function depends on `PaymentProvider` structurally,
never a concrete implementation); two different Payments produce
independent provider references. Full existing suite (Order, Checkout,
Catalog, Identity, CR-029, CR-030, IMP-031, IMP-032) re-run and
confirmed passing unmodified.

Validation Results

`pnpm test`: 272/272 passing (267 pre-existing + 5 new), 25 test files,
zero regressions. `pnpm typecheck`: clean. `pnpm lint`: clean. `pnpm
format:check`: limited to the two pre-existing, unrelated warnings
(`next.config.ts`, `pnpm-workspace.yaml`). `pnpm build`: succeeded (all
15 routes compiled/prerendered — this milestone adds no route).

Runtime Verification

Not applicable in the traditional sense — this milestone introduces no
database access, no HTTP surface, and no wiring into any existing
runtime path, so there is no additional system to exercise beyond the
contract test suite itself (above), which is the complete verification
of this port's behavior.

Remaining Limitations

No concrete `PaymentProvider` implementation exists — every capability
this port describes is unusable in practice until a future milestone
supplies a real adapter (Stripe, PayPal, or otherwise) and wires it into
`initializePayment` or a successor. No `confirmPayment`/`refund`/
`cancelPayment` method exists on the port yet — deliberately deferred
until a real provider's actual requirements are known, per Architecture
Decisions above. No `PaymentAttempt` entity — out of this milestone's
explicit scope.

Next Milestone State

NOT YET APPROVED. A future milestone must define which concrete
provider to integrate, implement `PaymentProvider` for it, and wire the
result into `initializePayment` (or a successor) before any real
payment can be processed. This milestone approves only the port's
shape.

11. IMP-034 — Payment Processing Application Flow (incl. IMP-034-FIX)

Status

COMPLETED

Commit

a48e6c1fcd456778bedc3cff3efdfda045ff647d (initial IMP-034)
ff57c4b7f19b3e226496327112f2b03b13aa31c4 (IMP-034-FIX / CR-034)

Objective

Connect IMP-032's Payment domain and IMP-033's `PaymentProvider` port
through a single application-level use case: `processPayment`. No
concrete provider, no webhook, no route, no UI — this milestone answers
exactly one question: how does the Payment application invoke a
provider-neutral payment provider and safely persist the resulting
provider reference?

Code Review Findings and Fixes (IMP-034-FIX / CR-034)

Code Review of the initial IMP-034 implementation found two P2
correctness defects, both resolved:

CR-034-01 — concurrent `processPayment()` calls can invoke the external
provider twice before the local database reference claim resolves the
race. Root cause: `setProviderReferenceIfPending`'s atomic conditional
write only guarantees ONE `providerReference` is ever *persisted* — it
says nothing about, and PostgreSQL cannot make atomic, whether the
*external* provider call itself happened once or twice. Two concurrent
`processPayment()` calls genuinely can both reach
`paymentProvider.startPayment(...)` before either write lands; no
in-process mutex was added to prevent this (per the explicit
architectural rule against unnecessary infrastructure). Fix: the
`PaymentProvider` port's contract (`payment-provider.ts`) now explicitly
requires that a compliant implementation treat every `startPayment` call
carrying the same `paymentId` as the SAME logical external operation,
never a second one — `paymentId` doubles as the provider-side
idempotency identity. Both calls sending the identical `paymentId` is
what makes reaching the provider twice safe; PostgreSQL's role is
narrower and complementary, guaranteeing only that one reference is ever
persisted locally.

CR-034-02 — a provider success followed by a local persistence failure
could lose the `providerReference`, and a later retry could then create
a second external operation. Root cause: `processPayment` correctly does
not invent provider-specific recovery logic for a failed
`setProviderReferenceIfPending` write, but the recovery invariant this
depends on was not previously documented as a hard requirement on the
provider contract. Fix: documented (and tested, via a genuinely
idempotent-by-`paymentId` fake provider) that a retry calling
`processPayment(paymentId)` again sends the identical `paymentId`, and a
compliant provider is contractually required to return the SAME
`providerReference` it already created rather than starting a new
external operation — the local write then simply succeeds on that later
attempt. No provider-specific retry/recovery API was introduced.

Provider-Side Idempotency Invariant (the core of the fix)

```
Payment ID
    ↓
PaymentProvider.startPayment()
    ↓
provider-side idempotency identity (== paymentId, always)
    ↓
same Payment cannot create multiple external payment operations
```
`paymentId` is the stable idempotency identity for the logical
provider-start operation — not a separate, caller-suppliable idempotency
key (none exists; `StartPaymentInput` has exactly three fields, all
derived from the persisted Payment, so there is no way for a retry to
accidentally vary its idempotency identity). This is deliberately a
*contract* guarantee — enforced by documentation and tests against a
compliant fake, not by any code that could force a real future SDK to
comply. PostgreSQL still separately guarantees the LOCAL invariant: at
most one `providerReference` is ever persisted for a given Payment, via
`setProviderReferenceIfPending`'s unchanged
`WHERE id = ? AND status = 'PENDING' AND providerReference IS NULL`
conditional write. Two independent, complementary guarantees — from two
different layers — are both required; neither alone is sufficient, and
this fix does not pretend PostgreSQL alone can make an external
side effect atomic.

`PROVIDER_REFERENCE_ALREADY_SET` error-contract review: `setProviderReferenceIfPending`
returning `null` can mean either (1) a concurrently racing call already
attached a reference, or (2) the Payment left `PENDING` through some
other path. These remain deliberately conflated into one result code —
today's architecture has no caller capable of producing case 2 at all
(`updateStatusIfCurrent` still has zero callers anywhere in this
codebase), so distinguishing them now would be speculative. This
invariant is now explicitly documented on both
`ProcessPaymentResult`'s `PROVIDER_REFERENCE_ALREADY_SET` variant and
`setProviderReferenceIfPending` itself, flagged for revisiting if a
status-changing caller is ever introduced.

Application Boundary

`processPayment(paymentRepository, paymentProvider, paymentId)` lives in
`src/modules/payment/application/process-payment.ts`. It imports neither
Prisma, Next.js, HTTP, nor any provider SDK — both dependencies are
injected as interfaces (`PaymentRepository`, `PaymentProvider`), matching
`initializePayment`'s established pattern exactly. Exported through
`@/modules/payment`'s public boundary as `processPayment(provider,
paymentId)`, with `PaymentRepository` pre-wired to the real
`prismaPaymentRepository` (the one concrete dependency that exists
today) and `provider` left as a caller-supplied parameter, since IMP-033
established no concrete `PaymentProvider` implementation to pre-wire.

Dependency Direction

`Application → PaymentRepository interface` and
`Application → PaymentProvider interface`, both unchanged from IMP-032/
IMP-033. `Infrastructure → Prisma` remains isolated to
`prisma-payment-repository.ts`; no future provider adapter exists yet or
is introduced here. The Payment domain (`payment.ts`) is untouched by
this milestone and remains providerless — verified by inspection (zero
imports beyond its own types).

Provider Interaction

`processPayment` loads the Payment, rejects if not found
(`PAYMENT_NOT_FOUND`) or not `PENDING` (`PAYMENT_NOT_PENDING` — terminal
Payments are never re-sent to a provider), builds `StartPaymentInput`
exclusively from the persisted Payment (`paymentId`, `amountMinor`,
`currency`), and calls `PaymentProvider.startPayment(...)`. A provider
failure (`{ ok: false, error: "PROVIDER_ERROR" }`) returns a controlled
result without any repository write — the Payment is left exactly as it
was, never a raw provider error, never a provider-specific failure code.

IMPORTANT SEMANTIC DECISION: a successful `startPayment()` call means the
provider has *started* processing, not that the payment has *succeeded*.
`processPayment` therefore never transitions a Payment to `SUCCEEDED`
and introduces no new intermediate status (no `PROCESSING`,
`AUTHORIZING`, `REQUIRES_ACTION`, or `PROVIDER_FAILED`) — the domain
lifecycle from IMP-032 is completely unchanged:
```
PENDING
 ├── SUCCEEDED
 ├── FAILED
 └── CANCELLED
```
A successful provider call only attaches the opaque `providerReference`
while the Payment remains `PENDING`. Only a future milestone, once a
provider genuinely reports a final result (e.g. via a webhook), is
responsible for the actual status transition — through
`updateStatusIfCurrent`, already established by IMP-032 and completely
unmodified here.

Authoritative Payment Values

The provider receives exclusively the persisted Payment's own
`amountMinor`/`currency` — `processPayment` accepts no such parameter at
all, so there is no input a caller could override them with, and no
Order recalculation, Catalog, or Checkout involvement of any kind. The
provider's success result contributes exactly one persisted value (the
opaque `providerReference`); `StartPaymentResult` has no amount/currency
field, so a provider can never replace them.

providerReference Persistence

The existing `PaymentRepository` could not persist a provider reference
without changing `status` (its only conditional-write method,
`updateStatusIfCurrent`, transitions status by design). Rather than
redesign that method or the repository's shape, IMP-034 adds exactly one
minimal atomic capability:
`setProviderReferenceIfPending(paymentId, providerReference)` —
`WHERE id = ? AND status = 'PENDING' AND providerReference IS NULL`,
the same database-conditional-write principle CR-030/IMP-032 already
established. Conditioning on `providerReference IS NULL` (not just
`status = 'PENDING'`) is what prevents a second concurrent caller from
silently overwriting a first caller's reference with a different value —
without it, two racing calls could both "succeed" against an unchanged
`status`, corrupting which reference actually persists. No schema
migration was required: `providerReference` already existed as a
nullable column since IMP-032.

Concurrency Strategy

Two concurrent `processPayment()` calls for the same `PENDING` Payment
are resolved entirely by `setProviderReferenceIfPending`'s atomic
conditional write — never a `SELECT → check → UPDATE` sequence at the
application level. Exactly one write applies; the loser's write reports
`count: 0`, and `processPayment` resolves that into a controlled
`PROVIDER_REFERENCE_ALREADY_SET` result carrying the Payment's actual
current state, never a corrupted or silently-overwritten value. Verified
under genuine `Promise.all` concurrency against real Postgres, both at
the repository level (`setProviderReferenceIfPending` directly) and the
full application-service level (`processPayment` with a real repository
and a controllable fake provider — no real provider exists yet).

What Is Deliberately Deferred

No concrete provider (Stripe, PayPal, or otherwise) — `PaymentProvider`
still has zero implementations. No webhook, no route, no UI. No
`PaymentAttempt` entity. No refund, cancellation API, or retry
framework. No new `PaymentStatus` value. No status transition of any
kind — that remains entirely a future milestone's responsibility, using
the unmodified `updateStatusIfCurrent` this milestone deliberately left
untouched.

Tests

23 tests from initial IMP-034 (see below), plus 6 new tests from
IMP-034-FIX. Application-layer (`process-payment.test.ts`) originally
covered Payment-not-found, a PENDING Payment reaching the provider
exactly once with exactly the three documented input fields,
authoritative (not hardcoded) amount/currency reaching the provider, a
successful result persisting the reference while the Payment stays
`PENDING`, the provider never being able to replace amount/currency, a
controlled `PROVIDER_ERROR` result that leaves the Payment uncorrupted
with no repository write attempted, all three terminal statuses being
rejected without ever calling the provider, and the race-loser path
(`PROVIDER_REFERENCE_ALREADY_SET`) with a genuinely conditional fake
repository — plus a real-repository, real-concurrency describe block.
IMP-034-FIX adds: a retry test proving `processPayment` sends the
identical `paymentId` on a second call and a compliant fake provider
resolves it to the same reference (CR-034-02); a real-Postgres
concurrency test using a SHARED compliant fake provider proving both
racing calls send identical `paymentId`/`amountMinor`/`currency` and
resolve to the same `providerReference` (CR-034-01) — the existing
two-different-providers race test is retained and re-labeled as proving
LOCAL database protection independently of provider behavior (defense
in depth), distinct from the new test proving the provider-contract
guarantee itself. `PaymentProvider` contract tests
(`payment-provider.test.ts`) add a structural proof that
`StartPaymentInput` has no field a caller could use to vary its
idempotency identity, plus tests against a new
`makeFakeCompliantPaymentProvider` (memoized by `paymentId`) proving
identical retries and identical concurrent calls both resolve to the
same reference. Repository-layer (`prisma-payment-repository.test.ts`,
unmodified by the fix): `setProviderReferenceIfPending` persistence,
non-overwrite of an already-set reference, rejection on a non-`PENDING`
Payment, and a genuine concurrent race. Full existing suite (Order,
Checkout, Catalog, Identity, CR-029, CR-030, IMP-031, IMP-032, IMP-033)
re-run and confirmed passing unmodified.

Validation Results

Initial IMP-034: `pnpm test` 290/290; `pnpm build`'s full command did not
complete during that validation pass due to persistent sandbox-level
worker crashes (documented at the time, substitute evidence via
`pnpm typecheck` and the build's own successful compile step).
IMP-034-FIX: `pnpm test`: **296/296 passing** (290 pre-existing + 6 new),
26 test files, zero regressions — confirmed via two independent clean
sequential (`--no-file-parallelism`) runs, a focused run of all 63
Payment-module tests, and a clean parallel `pnpm test` run, after this
session's parallel-mode worker-spawn flakiness (the same known,
already-documented sandbox issue, unrelated to this change) made several
earlier parallel attempts inconclusive on their own. `pnpm typecheck`:
clean. `pnpm lint`: clean. `pnpm format:check`: limited to the two
pre-existing, unrelated warnings (`next.config.ts`, `pnpm-workspace.yaml`).
`pnpm build`: **succeeded** (all 15 routes compiled/prerendered) — the
build-worker flakiness that affected the initial IMP-034 validation pass
did not recur this time; the previously-noted validation gap is closed.

Remaining Limitations

Everything under "What Is Deliberately Deferred" above (unchanged by the
fix): no concrete provider, no webhook, no route, no UI, no
`PaymentAttempt`, no refund/cancellation/retry framework, no new
`PaymentStatus` value, no status transition logic. `processPayment` is
still not wired to any transport — a future milestone decides how/when
it gets called. The provider-side idempotency guarantee this fix
establishes is a *contract*, verified against a compliant fake — it
cannot be verified against a real provider until one is integrated; a
future provider-adapter milestone must confirm the real SDK/API actually
honors idempotency by a caller-supplied key (e.g. Stripe's
`Idempotency-Key` header) mapped from `paymentId`. The
`PROVIDER_REFERENCE_ALREADY_SET` conflation (documented above) remains
deliberately unresolved pending a real status-changing caller.

12. IMP-035 — Stripe Payment Provider Adapter (incl. IMP-035-FIX / CR-035-01, IMP-035-FIX-2 / CR-035-FIX-01, CR-035-FIX-02)

Status

COMPLETED

Commit

8c798915111f96b1fb4244015375df095a04b265 (initial IMP-035)
ca14ca42804203958e86ed7fa43691656e63f32b (IMP-035-FIX / CR-035-01)
IMP-035-FIX-2 pending — implementation and validation are complete but
not yet committed at the time this entry was written. Record the actual
commit SHA through the normal follow-up documentation process once the
commit exists; do not treat any SHA embedded in this entry before that
point as authoritative for IMP-035-FIX-2.

Objective

Connect IMP-032/033/034's provider-neutral Payment application flow to one
real external payment provider — the first concrete implementation of the
`PaymentProvider` port (IMP-033). The goal is not to build a customer
payment UI; it is to prove the architecture already approved through
IMP-032–IMP-034-FIX actually works against a real provider, and
specifically that the IMP-034-FIX idempotency invariant (same `paymentId`
→ same provider-side idempotency identity → same external operation) holds
against that real provider's own semantics, not just against a fake.

Code Review Findings and Fixes (IMP-035-FIX / CR-035-01)

Code Review of the initial IMP-035 implementation found one P1
correctness defect, resolved:

CR-035-01 — Stripe's native `Idempotency-Key` retention is finite
("at least 24 hours", per Stripe's own documentation, with no guarantee
beyond that), while `PaymentProvider`'s contract (IMP-034-FIX) requires
the same internal Payment to resolve to the same external operation even
after a genuinely delayed retry. If a retry's `create` call happened after
Stripe had pruned the original idempotency key, Stripe would not error —
it would silently create a second, genuinely independent PaymentIntent,
reintroducing exactly the duplicate-external-operation problem
IMP-034-FIX closed for the concurrent-call case.

Root cause: the initial IMP-035 adapter relied ENTIRELY on the native
idempotency key as the sole idempotency mechanism, with nothing to fall
back on once that key's retention window had passed.

Fix — durable reconciliation, layered underneath native idempotency
rather than replacing it. `startPayment` now writes a stable identity
(`metadata: { paymentId }`) onto every PaymentIntent it creates, and
before ever calling `create`, searches for an existing PaymentIntent
carrying that same `paymentId` via `stripe.paymentIntents.search`
(`metadata["paymentId"]:"<paymentId>"`, verified against Stripe's official
Search Query Language documentation). If exactly one non-canceled match
exists, its amount/currency are checked against the authoritative Payment
before its `id` is reused as `providerReference`; if none exists, `create`
proceeds exactly as before, still protected by the native idempotency
key.

Why this closes the gap safely — Stripe's own documentation explicitly
warns that Search is eventually consistent and unsafe for read-after-write
flows ("data is searchable in under a minute" under normal conditions).
This was investigated carefully before implementation (verified against
the installed `stripe` SDK's type definitions and Stripe's official docs,
not assumed) and found NOT to undermine the fix, because the two
mechanisms' dangerous windows do not overlap:

- A retry within roughly the first minute after the original `create` is
  exactly the window where the idempotency key is still guaranteed fresh
  (valid for at least 24 hours) — even if `search` hasn't indexed the
  PaymentIntent yet, the retry falls through to `create`, which returns
  Stripe's cached response for that key. No duplicate either way.
- A retry long enough after the original attempt for the idempotency key
  to plausibly have been pruned (on the order of a day or more) is also
  long enough that `search`'s under-a-minute consistency lag has long
  since resolved.

`stripe.paymentIntents.list` was also investigated as an alternative and
found NOT viable: `PaymentIntentListParams` supports no metadata filter at
all (only `created`/`customer`/`customer_account`/`expand`), so it cannot
answer "find the PaymentIntent for this `paymentId`" in any form. Search
is the only Stripe-supported mechanism for this query shape.

Multiple-match handling: if search ever returns more than one non-canceled
match (or more than fit on one page), reconciliation refuses to guess —
returns `PROVIDER_ERROR` rather than arbitrarily picking one and
potentially hiding a genuine duplicate external payment. A `canceled`
PaymentIntent among the matches is excluded before this count: it is
unambiguously dead and must not be reused, nor must its presence
manufacture a false "ambiguous" result alongside a genuine live match.

Amount/currency validation: a found PaymentIntent is only reused if its
`amount`/`currency` match the authoritative `StartPaymentInput` exactly;
a mismatch fails safely (`PROVIDER_ERROR`) rather than silently attaching
a wrong external reference — the internal Payment's own amount/currency
are never modified based on what Stripe returns.

Concurrency (IMP-034-FIX / CR-034-01) is preserved unchanged: two
genuinely concurrent `startPayment` calls for a brand-new `paymentId` both
search (most likely finding nothing yet) and then both call `create` with
the identical idempotency key — Stripe's synchronous, immediately-
consistent idempotency-key handling, not `search`, is what converges them
safely, exactly as before this fix.

No `PaymentAttempt`, no new database table or column, no schema
migration, no new `PaymentStatus`, no infrastructure (Redis/queues/locks)
— the entire CR-035-01 fix was contained inside `stripe-payment-provider.ts`.
The `PaymentProvider` public contract, `processPayment`, `PaymentRepository`,
and the Payment domain were byte-for-byte unchanged by CR-035-01 (this
changed with IMP-035-FIX-2 below, for reasons explained there).

Code Review Findings and Fixes (IMP-035-FIX-2 / CR-035-FIX-01, CR-035-FIX-02)

Code Review rejected the IMP-035-FIX / CR-035-01 reconciliation fix as
still insufficient, finding one further P1 defect and one P2 defect, both
resolved:

CR-035-FIX-01 (P1) — `search` reconciliation alone cannot prove a
negative. Stripe's own documentation states Search is eventually
consistent ("unsafe for read-after-write... searchable in under a minute
under normal conditions", with no stronger guarantee during an outage).
The exact dangerous sequence: `create` succeeds, local
`providerReference` persistence fails, the process crashes, more than 24
hours pass (the native idempotency key may now be pruned), a retry's
`search` call happens to return zero results (either because nothing was
ever created, or because Search genuinely has not caught up) — the
CR-035-01 adapter would then fall through to `create` and produce a
second, genuinely duplicate PaymentIntent. An empty Search result was
being treated as proof of absence, which it never is.

Root cause: nothing in the system durably recorded, independent of
`providerReference`, WHETHER a provider-start had ever been attempted.
`providerReference == null` is inherently ambiguous between "never
attempted" and "attempted, but the reference was lost" — the CR-035-01
fix had no way to distinguish a genuinely fresh Payment (safe to trust
`create`'s native idempotency alone) from a Payment whose start history is
unknown (unsafe to trust an empty Search result).

Architecture decision process (per the four options considered):
Option A (reuse existing fields alone) was rejected — `providerReference`/
`status` cannot represent the needed distinction, by construction. Option
C (`PaymentAttempt`) and Option D (Redis/queues/distributed locks) were
rejected as disproportionate — the problem is a missing DURABLE MARKER,
not a missing entity or missing infrastructure; PostgreSQL's own
conditional-write primitive (already used four times elsewhere in this
repository) is sufficient. Option B — one minimal, provider-neutral
field — was selected.

Fix — a new nullable `Payment.providerStartAttemptedAt` column (migration
`20260815173412_add_payment_provider_start_attempted_at`, a single
`ALTER TABLE ... ADD COLUMN`, no data loss, no existing column touched)
durably records WHEN a provider-start was first attempted, set via a new
atomic conditional-write repository method,
`PaymentRepository.claimProviderStartAttempt` — the same
`WHERE ... IS NULL` pattern `create`/`updateStatusIfCurrent`/
`setProviderReferenceIfPending` already established, no new primitive
invented. `processPayment` calls this BEFORE ever contacting the provider
(IMP-034-FIX/CR-034-02's recovery invariant now has something durable to
depend on even if the process crashes between the claim and the provider
call), and passes the resulting timestamp through as the port's new
`StartPaymentInput.providerStartAttemptedAt` field.

This is the one place `PaymentProvider`'s contract and `processPayment`
change: `providerStartAttemptedAt` is a provider-neutral FACT (a
timestamp — deliberately not a Stripe-specific concept), documented on
the port as the caller's answer to "when, if ever, was a start first
durably attempted for this Payment" — see `payment-provider.ts`'s new
"SAFETY OVER LIVENESS" invariant. Each concrete provider adapter
interprets its age using ITS OWN retention knowledge; the port itself has
no opinion on what "too long ago" means for any given provider.

The Stripe adapter interprets it via a private, adapter-local constant
(20 hours — a deliberate margin under Stripe's documented "at least 24
hours" to absorb clock skew and request latency):

- Age below the threshold: still safe to trust `create`'s native
  idempotency key alone — `search` is skipped entirely (no unnecessary
  API call, and no exposure to Search's own consistency lag, since a
  brand-new Payment's `providerStartAttemptedAt` is always this fresh by
  construction).
- Age at or above the threshold: native idempotency can no longer be
  trusted. `search` is attempted, but — the core of this fix — a result
  of ZERO matches is now treated as INCONCLUSIVE, not as permission to
  create. `startPayment` returns `PROVIDER_ERROR` rather than ever
  calling `create` in this state. A genuinely fresh Payment can never
  reach this branch (its claim is always fresh), so this never blocks an
  actual first-ever payment attempt.

This closes CR-035-FIX-01: the dangerous sequence from Section 26 of the
Code Review ticket now ends in a safe, controlled `PROVIDER_ERROR` — the
Payment remains `PENDING`, requiring a future reconciliation/recovery
attempt — never a second `create` call. Consistent with the ticket's
explicit governing principle: NO DUPLICATE EXTERNAL PAYMENT over FAST
RECOVERY; a false negative (refusing a payment that could theoretically
have been started safely) is accepted, a false positive (creating a
genuine duplicate) is not. Concurrency (IMP-034-FIX/CR-034-01) is
unaffected: two genuinely concurrent calls for a brand-new Payment both
observe the SAME freshly-claimed timestamp (the atomic claim guarantees
this), so both take the direct-`create` branch and converge via Stripe's
own idempotency-key handling, exactly as before.

CR-035-FIX-02 (P2) — a canceled PaymentIntent's reconciliation semantics
were unsafe in both directions. Previously, a canceled-only Search match
was excluded and treated as "nothing exists, safe to create a fresh
one" — silently authorizing a second external operation while the
internal Payment stayed `PENDING`. Separately, `create`'s idempotent
replay response reflects the ORIGINAL request's response body (Stripe
does not re-derive it from current live state), so a PaymentIntent
canceled out-of-band (e.g. via the Stripe dashboard) sometime after
creation could still be returned as if it were a valid, live reference.

Fix: a canceled-only Search result now resolves to the SAME
"inconclusive, refuse" outcome as zero results (never "safe to create").
For the direct-`create` path, the adapter now always `retrieve`s the
resulting PaymentIntent's CURRENT status (a strongly consistent, non-
Search call — Stripe groups direct-by-ID retrieval with `list`, not with
the eventually-consistent Search API) before returning it, and refuses
(`PROVIDER_ERROR`) if that status is `canceled`. A live (non-canceled)
match found via Search does NOT need this extra check — Search's own
returned fields reflect Stripe's latest data even though the underlying
query match itself can lag (per Stripe's documented "Data mismatches"
behavior), and `reconcileExistingPaymentIntent` already excludes
`canceled` matches before any match is ever returned as "found".

No `PaymentAttempt`, no Stripe-specific field on `Payment` (no
`stripePaymentIntentId`/`stripeIdempotencyKey`/`stripeStatus`), no new
`PaymentStatus` value, no infrastructure (Redis/queues/distributed
locks) — `providerStartAttemptedAt` is the one minimal, provider-neutral
addition; everything Stripe-specific (the 20-hour threshold, `search`,
`retrieve`, `metadata`) remains entirely inside `stripe-payment-provider.ts`.

Provider Choice

Stripe, via its PaymentIntents API — the currently recommended way to
create a payment operation without requiring a customer-facing
confirmation step up front. Verified against Stripe's official API
documentation before implementation (not assumed):

- Idempotency: Stripe's REST API accepts an `Idempotency-Key` on every
  `POST` request (the Node SDK exposes this as a `requestOptions.idempotencyKey`
  second argument). Stripe saves the resulting status/body of the first
  request made for a given key and returns that same result for any later
  request reusing the same key with the same parameters, for at least 24
  hours — exactly the guarantee `PaymentProvider`'s contract requires.
- `paymentIntents.create({ amount, currency })` can be called with only an
  amount (integer minor units) and a lowercase three-letter currency code —
  no payment method is required to create the object, and it is not
  confirmed/captured by this call. The response's `id` (`pi_...`) is an
  opaque, stable reference.

Adapter Location

`src/modules/payment/providers/stripe-payment-provider.ts` (+
`stripe-payment-provider.test.ts`), alongside the existing
`payment-provider.ts` port. No other Payment module file was touched
except `index.ts` (composition-boundary export only — see "Application
Wiring" below).

Dependency Direction

```
Payment Domain
    ↓
Payment Application (processPayment)
    ↓
PaymentProvider (port, unchanged)
    ↑
Stripe Adapter (createStripePaymentProvider)
    ↓
Stripe SDK / API
```

The Stripe SDK (`stripe` npm package) is imported by exactly one file:
`stripe-payment-provider.ts`. The Payment domain, `PaymentRepository`, and
`processPayment` import nothing Stripe-related and remain exactly as
IMP-034-FIX left them.

Stripe Idempotency Mapping

`createStripePaymentProvider`'s `startPayment` derives Stripe's
`idempotencyKey` as `` `payment_${input.paymentId}` `` — a pure,
deterministic function of `paymentId` alone, never a random value, a
timestamp, or a request counter. The prefix exists only to namespace this
application's payment-start calls within Stripe's per-account
idempotency-key space (shared across every endpoint on the account); it
carries no independent entropy; the same `paymentId` always produces the
same key, and a different `paymentId` always produces a different one.
`StartPaymentInput` has no separate idempotency-key field for this
derivation to diverge from — it cannot vary independently of `paymentId`.
IMP-035-FIX (CR-035-01): this key is no longer the ONLY idempotency
mechanism — see "Code Review Findings and Fixes" above for the durable
`metadata`-based reconciliation layered underneath it, and "Durable
Reconciliation" below for its own dedicated write-up. IMP-035-FIX-2
(CR-035-FIX-01): this key is now trusted ONLY while
`StartPaymentInput.providerStartAttemptedAt` is recent enough (< 20 hours
old, a margin under Stripe's own "at least 24 hours" guarantee) — see
"Safety Over Liveness" below.

Durable Reconciliation (IMP-035-FIX / CR-035-01, tightened by
IMP-035-FIX-2 / CR-035-FIX-01, CR-035-FIX-02)

Every PaymentIntent `startPayment` creates carries `metadata: { paymentId }`
— the same stable value used to derive the idempotency key. `startPayment`
first computes whether native idempotency alone can still be trusted (see
"Safety Over Liveness" below); only if it cannot does it call
`stripe.paymentIntents.search` for an existing PaymentIntent carrying that
`paymentId`, using the query `` metadata["paymentId"]:"<paymentId>" ``
(Stripe's Search Query Language, verified against Stripe's official
documentation). Outcomes, IMP-035-FIX-2 (CR-035-FIX-01, CR-035-FIX-02):

- No match → `PROVIDER_ERROR`. This is the change from CR-035-01: an
  empty Search result is no longer treated as permission to `create` — it
  is inconclusive, and reconciliation is only ever reached once native
  idempotency can no longer be trusted, so falling through to `create`
  here could produce a genuine duplicate.
- Exactly one non-canceled match, amount/currency verified against the
  authoritative Payment → reuse its `id` as `providerReference` directly
  (no extra live-status check needed — Search's returned fields already
  reflect Stripe's latest data). `create` is never called.
- More than one non-canceled match, or more results than fit on one page
  → `PROVIDER_ERROR`; reconciliation refuses to guess.
- Amount/currency mismatch on the one match found → `PROVIDER_ERROR`;
  the found PaymentIntent is not reused, and the Payment's own
  amount/currency are never altered by this check.
- A `canceled` match is excluded before any of the above counting —
  neither reused nor (CR-035-FIX-02) allowed to authorize a fresh
  `create` by making the result look like "no match".

Safety Over Liveness (IMP-035-FIX-2 / CR-035-FIX-01)

`StartPaymentInput.providerStartAttemptedAt` (see "Code Review Findings
and Fixes" above) tells `startPayment` how long ago a provider-start was
first durably attempted for this Payment. Below a 20-hour threshold
(private to this adapter, not part of the provider-neutral port): `create`
is called directly, without searching — safe because native idempotency
is still guaranteed, and a genuinely new Payment's timestamp is always
this fresh. At or above the threshold: reconciliation is mandatory, and
(per the point above) an inconclusive result refuses rather than creates.
This is what makes `Payment.providerStartAttemptedAt` — not
`Payment.providerReference`, and not Stripe's own idempotency key — the
actual permanent source of truth for "might this Payment already have an
external operation": `providerReference` alone was always ambiguous
(`null` before AND after a lost reference), and Stripe's key is finite.

Authoritative Payment Values

The adapter receives exactly `StartPaymentInput` (`paymentId`,
`amountMinor`, `currency`) — the same shape IMP-033 already established,
unchanged by this milestone. It performs no Order/Cart/Catalog lookup, no
price calculation, and accepts no client-supplied monetary value; it only
lowercases `currency` before sending it to Stripe (Stripe's API requires
lowercase; the Payment domain's own casing is untouched).

providerReference Handling

The adapter returns Stripe's PaymentIntent `id` as the opaque
`providerReference` — nothing else from the Stripe response escapes the
adapter (verified by a dedicated contract test asserting the successful
result's only keys are `ok` and `providerReference`). Persisting it
remains `processPayment`'s and `PaymentRepository.setProviderReferenceIfPending`'s
responsibility, unchanged.

Error Mapping

`startPayment` never throws (matching the pre-existing "never throwing"
contract test for `PaymentProvider`): every error that is an instance of
`Stripe.errors.StripeError` (covering card declines, invalid requests, API
errors, rate limits, connection errors — Stripe's entire REST-API error
hierarchy) from `search`, `create`, OR (IMP-035-FIX-2) `retrieve` is
caught and mapped to the single `{ ok: false, error: "PROVIDER_ERROR" }`
result the port already defines, after logging the error server-side
(`console.error`, matching the existing `[api/orders]`-style convention
used at other boundaries in this codebase). A non-Stripe error (a bug in
this adapter itself) is deliberately NOT caught — it propagates, so a
genuine defect surfaces rather than being silently absorbed into the
provider-failure code path. A reconciliation ambiguity (multiple matches,
or — IMP-035-FIX-2 — an inconclusive empty result once native idempotency
can no longer be trusted), a validation mismatch (amount/currency), or a
canceled PaymentIntent all resolve to `PROVIDER_ERROR` — no new
provider-neutral error code was introduced for any of these, per the
existing boundary already being sufficient. (One implementation
correction made during this fix, not a design decision: an early draft
returned `reuseIfLive(...)`'s promise directly from inside the adapter's
`try` block without `await`, which would have let a `retrieve` rejection
bypass the `catch` entirely — a classic async/await pitfall, fixed before
the tests that specifically exercise a `retrieve` failure were made to
pass.)

Application Wiring

`processPayment`'s exported signature in `index.ts` is unchanged — it
still takes an injected `PaymentProvider` and remains entirely unaware
Stripe exists. `index.ts` additionally re-exports `getStripePaymentProvider`,
a lazy factory that constructs a real `Stripe` client from
`STRIPE_SECRET_KEY` only on first call, never at module-import time —
importing the payment module (or anything that transitively imports it,
including the app's build) does not require `STRIPE_SECRET_KEY` to be set.
No route or UI calls `getStripePaymentProvider` or `processPayment` in
this milestone; wiring a concrete transport is explicitly out of scope.

Security

`stripe-payment-provider.ts` starts with `import "server-only"`, so it
cannot be imported into a client bundle (verified by an automated test —
source inspection of the file's first line — not just code review). No
API key, secret, or provider payload is ever logged or returned to a
caller. `paymentId`, `amountMinor`, `currency`, and (IMP-035-FIX-2)
`providerStartAttemptedAt` all originate from the already-persisted,
already-authorized `Payment` row — this adapter introduces no new place
for a client to influence them. `providerStartAttemptedAt` itself carries
no sensitive data (a timestamp only) and is provider-neutral by
construction — it is not Stripe-specific and reveals nothing about
Stripe internals if ever logged. `.env.example`'s `STRIPE_SECRET_KEY`
placeholder entry is unchanged by this fix (`.env*` is already gitignored
except `.env.example` itself).

Database (IMP-035-FIX-2)

Migration `20260815173412_add_payment_provider_start_attempted_at`: a
single `ALTER TABLE "payments" ADD COLUMN "providerStartAttemptedAt" TIMESTAMP(3);`
— nullable, no default, no data migration, no existing column touched, no
new index (the existing `@@index([status])` is not affected; this column
is always looked up by `id`, already the primary key). Applied directly
to the project's Neon PostgreSQL instance via `prisma migrate dev`.
`PaymentRepository` gains one new method,
`claimProviderStartAttempt(paymentId)`, implemented with the exact same
`updateMany`-conditional-write concurrency pattern already used by
`create`/`updateStatusIfCurrent`/`setProviderReferenceIfPending` — no new
atomicity primitive was invented. Concurrent-claim safety is proven
against the REAL database (not a fake), using a barrier-gated fake
provider to force genuine overlap in `processPayment`'s call into the
provider while the claim itself races against real Postgres.

Tests

`stripe-payment-provider.test.ts`: 26 tests (23 passing + 3 gated
real-Stripe tests) — rewritten around a `freshInput`/`staleInput` fixture
pair to directly express "within the safe window" vs "beyond it"
scenarios, plus a fake Stripe client that now also models `retrieve` (a
separate, independently mutable "live status" store from what `create`
returns, via a new `cancelPaymentIntent` test helper) so out-of-band
cancellation can be simulated without waiting for anything. Contract
tests: amount/currency/metadata sent on creation, `paymentId` → idempotency
key, `PaymentIntent.id` → `providerReference`, a Stripe error on `create`,
`retrieve`, AND `search` each independently mapped to `PROVIDER_ERROR`,
five Stripe error subclasses collapsing to the same result, a non-Stripe
error propagating, the result's exact key shape, `getStripePaymentProvider()`'s
missing-key behavior, and the `server-only` boundary. Idempotency-key-
stability: same `paymentId` → same key; different → different (using
`freshInput`, since `staleInput` never reaches `create` at all under the
new design). Safety-over-liveness tests (CR-035-FIX-01, the core of this
fix): within-window calls create directly without ever searching;
same-request retry and genuine concurrent overlap (barrier-gated, same
technique as the CR-034 P3 fix) both still converge via native idempotency;
beyond-window with an existing live match reuses it without calling
`create`; **the primary acceptance criterion (Code Review ticket §26)** —
beyond-window with Search finding NOTHING now asserts `PROVIDER_ERROR`
with zero `create` calls, replacing the old (CR-035-01-era, since proven
insufficient) behavior that fell through to `create`; multiple matches and
a `has_more` page both still fail safely; amount/currency mismatches both
still fail safely; different Payments still produce independent
references. Canceled-PaymentIntent tests (CR-035-FIX-02, new describe
block): a canceled-only Search match now refuses rather than authorizing
a fresh `create`; a canceled match alongside a genuine live one is still
excluded without manufacturing a false ambiguous result; an idempotent
`create` replay whose PaymentIntent was canceled out-of-band between calls
is caught by the new `retrieve`-based live-status check and refused.
Real Stripe test-mode tests (3, gated by `STRIPE_SECRET_KEY` via
`describe.skipIf`) updated only to supply the new required
`providerStartAttemptedAt` field.

`process-payment.test.ts`: 4 new tests. `processPayment` durably claims
via `claimProviderStartAttempt` BEFORE ever calling the provider, and
passes the claimed timestamp through; if the claim itself cannot be
established (a fake repository configured to throw, modeling a database
outage), the provider is never contacted at all (Test 14 from the Code
Review ticket's matrix); a retry after a simulated local persistence
failure reuses the SAME already-claimed timestamp rather than re-claiming
a fresh one (Tests 4/5/13); and — against the REAL repository, with a
barrier-gated fake provider forcing genuine overlap (Tests 3/16) — two
concurrent `processPayment` calls for a brand-new Payment converge on the
identical durably-claimed `providerStartAttemptedAt`, proving the atomic
claim's Postgres-level concurrency guarantee directly, not just through
the adapter's own behavior.

`payment-provider.ts`/`payment-repository.ts`/`initialize-payment.test.ts`:
fixture and structural-proof updates only (the new
`providerStartAttemptedAt` field/method), no behavioral test changes —
these files' own logic is otherwise untouched by this fix.

Full pre-existing suite (Order, Checkout, Catalog, Identity,
CR-029/030/031, IMP-032/033/034/034-FIX) re-run and confirmed passing
unmodified.

Runtime Verification

No `STRIPE_SECRET_KEY` was available in this implementation environment,
across all of IMP-035, IMP-035-FIX, and IMP-035-FIX-2. The 3 real-Stripe
test-mode tests remain implemented and gated correctly
(`describe.skipIf(!process.env.STRIPE_SECRET_KEY)`) but were **skipped**,
not run and not fabricated as passing. `pnpm test` reports these 3 tests
as explicitly skipped. Real Stripe test-mode verification of the
safety-over-liveness branching and the `retrieve`-based cancellation check
against Stripe's actual API remains genuinely pending until someone runs
the suite with a real Stripe test-mode secret key configured.

Validation Results

Initial IMP-035: `pnpm test` 309 passing + 3 skipped. IMP-035-FIX: 323
passing + 3 skipped (326 total). IMP-035-FIX-2: `pnpm test`: **328 passing
+ 3 skipped** (331 total), 27 test files, zero regressions in the
pre-existing 323. `pnpm typecheck`: clean — including confirming the
narrowed `StripePaymentIntentsClient` interface (now including `retrieve`)
is structurally satisfied by a real `Stripe` instance, and that every
existing `StartPaymentInput`/`Payment` fixture across the whole Payment
module compiles against the new required fields. `pnpm lint`: clean.
`pnpm format:check`: limited to the same two pre-existing, unrelated
warnings already noted for prior milestones (`next.config.ts`,
`pnpm-workspace.yaml`). `pnpm build`: succeeded, all 15 routes
compiled/prerendered, with no `STRIPE_SECRET_KEY` set — the lazy-wiring
design still does not force a Stripe credential requirement onto the
build; `prisma generate` picked up the new migration cleanly.

One real defect was found and fixed during this milestone's own
validation, not by Code Review: an early implementation returned a
`retrieve`-derived promise directly from inside the adapter's `try` block
without `await`, which let a rejected `retrieve` call bypass the
surrounding `catch` (a classic async/await subtlety — `return promise`
inside `try` does not route a later rejection through that block's
`catch`, only `return await promise` does). Caught immediately by the
test written specifically to exercise a `retrieve` failure; fixed before
proceeding.

What Is Deliberately Deferred

No webhook, no route, no UI, no `confirmPayment`/refund/cancellation, no
second provider, no customer payment-method management, no
`PaymentAttempt`, no retry/queue framework, no new `PaymentStatus` value
or transition — `processPayment` still only attaches `providerReference`
while the Payment stays `PENDING`, exactly as IMP-034/IMP-034-FIX left it.
(The one schema change this milestone DID make — `providerStartAttemptedAt`
— is documented under "Database" above; it is the durable marker the
architecture decision process concluded was genuinely necessary, not
scope creep.) Real Stripe test-mode verification (above) is implemented
but unexecuted pending real credentials — this now includes verifying the
20-hour safety threshold and the `retrieve`-based cancellation check
against Stripe's actual API, not just `create`/`search`. The residual risk
of a Stripe-side outage delaying `search` indexing for longer than the
idempotency key's own retention window is documented as a known,
unavoidable limitation (see the adapter's own doc comment) rather than
assumed away — CR-035-FIX-01 closes the "empty Search result treated as
proof" gap, but cannot make Stripe's own eventual-consistency guarantee
stronger than Stripe itself offers. A Payment that hits a provider issue
after its first-start claim is set (e.g. a clean `create` failure, or an
inconclusive reconciliation) has no automatic "un-claim" path in this
milestone — deliberately: distinguishing which failures are safe to
un-claim from which are not was judged out of scope and a potential
safety hazard in its own right (see the adapter's own doc comment); such
a Payment durably requires a FUTURE reconciliation/recovery mechanism
(administrative tooling, or a later milestone) to ever retry, consistent
with this milestone's governing principle (Code Review ticket): NO
DUPLICATE EXTERNAL PAYMENT over FAST RECOVERY. A future milestone decides
how `getStripePaymentProvider()`/`processPayment` actually get called
from a transport, and is responsible both for turning Stripe's eventual
confirmation (most likely a webhook) into a real status transition, and
for whatever recovery/reconciliation tooling a permanently-claimed,
never-started Payment eventually needs.

13. Current Production State

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

14. Known Limitations
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

15. Next Milestone

Status

NOT YET APPROVED

The next milestone after IMP-035 must be explicitly defined by the
Architect before implementation begins.

IMP-035 approved exactly one thing: a concrete Stripe adapter for the
`PaymentProvider` port. The following must NOT be assumed to be approved:

payment webhooks;
a transport layer (API/UI) for `processPayment`, `initializePayment`, or
`changeOrderStatus`;
`confirmPayment`/`refund`/`cancelPayment` or any other addition to the
`PaymentProvider` port;
any new `PaymentStatus` value (`PROCESSING`, `AUTHORIZING`,
`REQUIRES_ACTION`, `PROVIDER_FAILED`, or otherwise) or any Payment status
transition triggered by `processPayment`;
a second payment provider;
customer payment-method management;
`PaymentAttempt` or any retry/queue infrastructure;
Inventory;
Admin tooling / Admin UI;
roles/permissions;
ISR;
caching;
Search;
CMS;
or any other future subsystem.

These require separate requirements and architectural decisions.

16. Future Roadmap Areas

The following are possible future areas and are NOT yet approved implementation milestones:

Payments — webhook-driven status confirmation, a transport layer, refunds/cancellation, a second provider (using the IMP-030 lifecycle contract, the IMP-032 Payment foundation, and the IMP-035 Stripe adapter)
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

17. Implementation Process

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
18. Code Review Policy

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

19. Local QA Policy

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

20. Definition of Done

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
21. Milestone Summary
Milestone	Status
IMP-021 — Catalog Persistence Foundation	COMPLETED
IMP-021-FIX-001 — Public API + Prisma Build Generation	COMPLETED
IMP-021-FIX-002 — Remove Build-Time DB Dependency	COMPLETED
IMP-022 — Cart → Checkout Navigation	COMPLETED
IMP-023 through IMP-029 (incl. fix follow-ups)	COMPLETED — see Section 6 note; git history authoritative
IMP-030 — Order Lifecycle & Status Management (incl. CR-030)	COMPLETED
IMP-031 — Checkout Submission Idempotency (incl. IMP-031-FIX / CR-031)	COMPLETED
IMP-032 — Payment Foundation	COMPLETED
IMP-033 — Payment Provider Port	COMPLETED
IMP-034 — Payment Processing Application Flow (incl. IMP-034-FIX / CR-034)	COMPLETED
IMP-035 — Stripe Payment Provider Adapter (incl. IMP-035-FIX / CR-035-01, IMP-035-FIX-2 / CR-035-FIX-01, CR-035-FIX-02)	COMPLETED — real Stripe test-mode verification pending (see Section 12)
Next milestone	NOT YET APPROVED
22. Source of Truth

This document is the authoritative roadmap for implementation milestones.

If another document, chat message, implementation report, or local note conflicts with this roadmap, the conflict must be resolved by the Architect before implementation continues.