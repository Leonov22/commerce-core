# Site Map

**Document Version:** 1.0

**Status:** Approved

**Owner:** Architect

**Sprint:** Sprint 2 – Product Architecture

---

# Purpose

This document defines the information architecture of the Commerce Core storefront.

Rather than describing visual layouts, it defines:

- available pages
- navigation hierarchy
- URL structure
- public entry points
- user destinations

This document serves as the foundation for:

- UX Design
- UI Design
- Frontend Routing
- Backend Routing
- SEO
- Testing

---

# Information Architecture

Commerce Core is organized into five logical areas.

Store

├── Discover

├── Shop

├── Customer

├── Information

└── Support

---

# Store Structure

Home (/)

↓

Discover

↓

Shop

↓

Purchase

↓

Customer Area

---

# Discover

Purpose

Help visitors discover products.

Pages

Home

New Arrivals (future)

Featured Collections (future)

Best Sellers (future)

---

# Shop

Purpose

Allow customers to browse products.

Pages

Catalog

Category

Product

Search Results

---

# Purchase

Purpose

Allow customers to complete purchases.

Pages

Cart

Checkout

Order Confirmation

---

# Customer

Purpose

Customer self-service.

Pages

Login

Register

Dashboard

Orders

Order Details

Addresses

Profile

---

# Information

Purpose

Provide company information.

Pages

About

FAQ

Delivery & Payment

Privacy Policy

Terms & Conditions

---

# Support

Purpose

Help users contact the business.

Pages

Contact

Future

Returns

Order Tracking

---

# URL Structure

Home

/

Catalog

/catalog

Category

/catalog/{category-slug}

Product

/products/{product-slug}

Search

/search?q=...

Cart

/cart

Checkout

/checkout

Login

/account/login

Register

/account/register

Dashboard

/account

Orders

/account/orders

Order Details

/account/orders/{order-number}

Addresses

/account/addresses

Profile

/account/profile

About

/about

Contact

/contact

FAQ

/faq

Delivery & Payment

/delivery-payment

Privacy Policy

/privacy-policy

Terms & Conditions

/terms-and-conditions

---

# SEO Rules

Every public page must have:

- unique URL
- page title
- meta description
- canonical URL
- Open Graph metadata

Public pages must never expose internal IDs.

URLs must always use slugs.

---

# Error Pages

404

Page Not Found

403 (future)

Unauthorized

500 (future)

Internal Server Error

Maintenance Mode (future)

---

# Navigation Entry Points

Primary Navigation

- Home
- Catalog
- About
- Contact

Utility Navigation

- Search
- Account
- Cart
- Language Switcher

Footer Navigation

- About
- FAQ
- Delivery & Payment
- Privacy Policy
- Terms & Conditions
- Contact

---

# Access Matrix

| Page | Guest | Customer | Admin |
|------|:-----:|:--------:|:-----:|
| Home | ✅ | ✅ | ✅ |
| Catalog | ✅ | ✅ | ✅ |
| Category | ✅ | ✅ | ✅ |
| Product | ✅ | ✅ | ✅ |
| Search | ✅ | ✅ | ✅ |
| Cart | ✅ | ✅ | ✅ |
| Checkout | ✅ | ✅ | ❌ |
| Login | ✅ | ❌ | ❌ |
| Register | ✅ | ❌ | ❌ |
| Dashboard | ❌ | ✅ | ❌ |
| Orders | ❌ | ✅ | ❌ |
| Addresses | ❌ | ✅ | ❌ |
| Profile | ❌ | ✅ | ❌ |
| Admin Panel | ❌ | ❌ | ✅ |

---

# Future Pages

The following pages are intentionally excluded from MVP.

Wishlist

Reviews

Blog

Brand Page

Gift Cards

Order Tracking

Store Locator

Affiliate Program

These pages may be introduced in future releases without affecting the current information architecture.

---

# Acceptance Criteria

The Site Map is considered complete when:

- every public page has a defined purpose;
- every page has a stable URL;
- every page belongs to exactly one navigation area;
- all user journeys described in UserFlows.md can be completed using this structure.

---

# Related Documents

- MVP.md
- Navigation.md
- UserFlows.md
- AdminInformationArchitecture.md
- 01-SystemOverview.md
- 03-DomainModel.md
