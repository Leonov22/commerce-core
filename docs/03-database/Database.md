# Database Design

**Document Version:** 1.0

**Status:** Approved

**Owner:** Architect

**Sprint:** Sprint 3 – Core Architecture

---

# Purpose

This document defines the logical database architecture for Commerce Core.

The database is organized around business domains rather than application pages or technical implementation details.

This document serves as the source of truth for:

- Prisma Schema
- Database Migrations
- Backend Implementation
- API Design

---

# Database Engine

## PostgreSQL

### Reason

- ACID compliance
- Excellent relational capabilities
- Mature ecosystem
- Strong indexing support
- Excellent Prisma integration

---

# Design Principles

The database must be:

- normalized
- predictable
- scalable
- migration-friendly
- secure
- type-safe

Business entities own their data.

Cross-domain duplication is avoided.

---

# Business Domains

The database is divided into the following domains.

Identity

Catalog

Cart

Orders

Payments

Content

Platform

Each domain owns its entities.

---

# Identity Domain

## Entities

User

Role

Account

Session

VerificationToken

### Relationships

Role

↓

User

↓

Session

↓

Account

VerificationToken belongs to User authentication lifecycle.

---

# Catalog Domain

## Entities

Product

Category

Brand

ProductVariant

ProductAttribute

AttributeValue

ProductImage

### Relationships

Category

↓

Product

↓

ProductVariant

↓

ProductImage

Brand

↓

Product

ProductAttribute

↓

AttributeValue

↓

ProductVariant

---

# Cart Domain

## Entities

Cart

CartItem

### Relationships

Cart

↓

CartItem

↓

ProductVariant

Guest carts are fully supported.

---

# Orders Domain

## Entities

Order

OrderItem

OrderAddress

### Relationships

Order

↓

OrderItem

↓

ProductVariant

Order

↓

OrderAddress

Orders remain immutable except for status transitions.

---

# Payments Domain

## Entities

Payment

PaymentTransaction

### Relationships

Order

↓

Payment

↓

PaymentTransaction

Multiple payment attempts must be supported.

---

# Content Domain

## Entities

Page

NavigationMenu

NavigationItem

Banner

HomeSection

### Relationships

NavigationMenu

↓

NavigationItem

---

# Platform Domain

## Entities

Setting

Locale

Media

### Relationships

Locale

↓

Translations (future)

Media is reusable across all domains.

---

# Primary Keys

Every primary entity uses:

UUID

### Reason

- globally unique
- non-sequential
- future distributed compatibility
- avoids exposing internal IDs

---

# Common Columns

Every primary entity contains:

id

createdAt

updatedAt

Soft-deletable entities additionally contain:

deletedAt

---

# Foreign Keys

All relationships must use explicit foreign keys.

Foreign key constraints are mandatory.

Cascade behavior must be explicitly defined.

---

# Index Strategy

Indexes are required for:

Primary Keys

Foreign Keys

Slug

Email

Order Number

Created Date

Status

Composite indexes should only be introduced when justified by measured query performance.

---

# Unique Constraints

Examples

User.email

Category.slug

Product.slug

Page.slug

Locale.code

Order.number

Brand.slug

---

# Soft Delete Strategy

Supported

Products

Categories

Brands

Pages

Not Supported

Orders

Payments

Sessions

Verification Tokens

Business history must never be removed.

---

# Transactions

Transactions are required for:

Checkout

Order Creation

Payment Processing

Future Inventory Updates

Transactions must preserve consistency and atomicity.

---

# Cascade Rules

Delete operations must never remove historical business records.

Example

Deleting a customer must never delete previous orders.

Historical order data must remain intact.

---

# Audit Strategy

Every business entity should support:

createdAt

updatedAt

Future extensions

createdBy

updatedBy

AuditLog

EntityVersion

---

# File Storage

Binary files are never stored inside the database.

The database stores only metadata.

Actual files are stored in external storage.

MVP uses the local filesystem.

---

# Localization

The schema is prepared for multilingual content.

Translation tables are intentionally excluded from MVP.

The Locale entity provides the foundation for future expansion.

---

# Migration Strategy

Schema changes must always be implemented using Prisma Migrations.

Manual database modifications are forbidden.

Every migration must be reproducible.

---

# Performance Principles

Prefer:

- proper indexing
- optimized queries
- normalized data

Avoid premature denormalization.

Performance optimizations must be based on real measurements.

---

# Backup Strategy

Production deployments must support:

- automated backups
- point-in-time recovery
- disaster recovery procedures

Implementation depends on deployment infrastructure.

---

# Future Database Modules

The following modules are intentionally excluded from MVP.

Wishlist

Reviews

Coupons

Inventory

Shipping

Marketplace

Analytics

Notification Center

---

# Acceptance Criteria

The database architecture is complete when:

- every business domain owns its entities;
- relationships are explicitly defined;
- primary and foreign keys are standardized;
- indexing strategy is documented;
- historical business data is protected;
- migration strategy is defined;
- schema supports future growth without redesign.

---

# Related Documents

- TDR-001-Tech-Stack.md
- API-Design.md
- 03-DomainModel.md
- 04-FolderStructure.md
- 05-DependencyRules.md
- MVP.md
