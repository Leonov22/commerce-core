# Domain Model

Status: Approved

Owner: Architect

Last Updated: 2026-08-07

---

# Purpose

This document defines the business domains of Commerce Core.

Domains are organized around business capabilities rather than database entities or UI pages.

Each domain owns its own business rules and data.

---

# Domain Overview

## Identity

Responsibilities

- Authentication
- Authorization
- User accounts
- Sessions
- Roles
- Permissions

Owns

- Users
- Sessions
- Roles

---

## Catalog

Responsibilities

- Products
- Categories
- Brands
- Attributes
- Variants
- Inventory metadata

Owns

- Products
- Categories
- Brands
- Product Attributes
- Product Variants

---

## Cart

Responsibilities

- Shopping cart
- Saved carts
- Guest carts

Owns

- Active carts
- Cart items

---

## Orders

Responsibilities

- Order creation
- Order lifecycle
- Order history
- Fulfillment status

Owns

- Orders
- Order Items

---

## Payments

Responsibilities

- Payment processing
- Payment providers
- Payment status
- Refunds

Owns

- Payments
- Transactions

---

## Content

Responsibilities

- CMS pages
- Blog
- Menus
- Banners
- SEO content

Owns

- Pages
- Posts
- Menus
- Media references

---

## Administration

Responsibilities

Administrative interfaces.

This domain owns no business data.

It consumes public services from other domains.

---

## Platform

Responsibilities

- Configuration
- Localization
- Logging
- Media storage
- Notifications
- Global settings

Owns

- Settings
- Locales
- Media metadata

---

# Dependency Rules

Identity

↓

Catalog

↓

Cart

↓

Orders

↓

Payments

Content

Platform

Administration

Administration communicates only through public interfaces.

Platform provides shared infrastructure.

Business domains never access another domain's internal implementation.

---

# Design Rules

Domains own their data.

Domains expose public contracts.

Domains hide implementation.

Domains communicate through explicit interfaces.

Business rules never leave their domain.

---

# Future Domains

Wishlist

Reviews

Notifications

Analytics

Shipping

Loyalty

Marketplace

These are intentionally excluded from the MVP.
