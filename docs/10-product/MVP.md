# MVP (Minimum Viable Product)

**Document Version:** 1.0

**Status:** Approved

**Owner:** Architect

**Sprint:** Sprint 2 – Product Architecture

---

# Purpose

This document defines the functional scope of Commerce Core MVP.

Its purpose is to clearly distinguish which functionality belongs to the first production release and which functionality is intentionally postponed.

Every implementation task must reference this document.

---

# Product Vision

Commerce Core is a configurable eCommerce platform.

The MVP focuses on delivering a complete shopping experience with a maintainable architecture rather than implementing every possible feature.

The objective is to launch a production-ready online store that can later evolve into multiple branded stores without rewriting the application core.

---

# MVP Goals

The MVP must allow:

- browsing products
- searching products
- purchasing products
- managing products
- managing orders
- managing content
- supporting multiple languages
- supporting future payment integrations
- supporting future theme customization

---

# Functional Scope

## Storefront

### Public Pages

- Home
- Catalog
- Category
- Product
- Search Results
- Cart
- Checkout
- About
- Contact
- FAQ
- Delivery & Payment
- Privacy Policy
- Terms & Conditions
- 404

---

### Customer Account

- Login
- Register
- Dashboard
- Orders
- Order Details
- Addresses
- Profile

Guest Checkout is fully supported.

Customer registration is optional.

---

# Catalog

The catalog supports:

- Products
- Categories
- Brands
- Product Attributes
- Product Variants
- Images
- Product Status
- Product Visibility
- Product Pricing
- Product Discounts
- Product SEO

---

# Shopping Cart

Supports:

- Add Product
- Remove Product
- Update Quantity
- Persist During Session

Guest carts are supported.

---

# Checkout

Supports:

- Guest Checkout
- Customer Checkout
- Shipping Information
- Billing Information
- Manual Payment
- Order Confirmation

Payment is currently based on manual bank transfer.

Future payment providers are supported by architecture but excluded from MVP.

---

# Orders

Supports:

- Create Order
- View Orders
- View Order Details
- Update Order Status
- Customer Order History

---

# Administration

The administration panel includes:

Dashboard

Catalog

- Products
- Categories
- Brands
- Attributes
- Variants

Sales

- Orders

Customers

Content

- Pages
- Navigation
- Home Sections
- Banners

Media

SEO

Settings

---

# Home Page

The Home Page is composed of configurable sections.

Supported actions:

- Enable Section
- Disable Section
- Change Order
- Edit Content

Creating new section types is excluded from MVP.

---

# Media Library

Supports:

- Upload Images
- Delete Images
- Reuse Images
- Alt Text
- Image Metadata

Folders are excluded from MVP.

---

# SEO

Supported for:

- Products
- Categories
- Pages

Features:

- Meta Title
- Meta Description
- URL Slug
- Open Graph
- Canonical URL
- XML Sitemap
- robots.txt

---

# Internationalization

Supported Languages

- English (default)
- Ukrainian
- French
- Slovak

The architecture must allow adding additional languages without code changes.

---

# User Roles

Supported Roles

Guest

Customer

Administrator

Manager is excluded from MVP.

---

# Must Have

The following capabilities are mandatory before release:

- Responsive Design
- Guest Checkout
- Product Management
- Order Management
- Content Management
- Media Management
- SEO
- Internationalization
- Authentication
- Authorization
- Search

---

# Should Have

If time allows:

- Coupons
- Product Filters
- Product Sorting
- Related Products
- Brand Pages

---

# Could Have

Future iterations may include:

- Wishlist
- Reviews
- Blog
- Live Chat
- Email Marketing
- Product Comparison

---

# Won't Have

The following features are intentionally excluded from MVP:

- Marketplace
- Multi Vendor
- Multi Brand Management
- Subscription Products
- Loyalty Program
- Mobile Application
- ERP Integration
- CRM Integration
- AI Recommendations
- AI Search
- Drag & Drop Page Builder

---

# Acceptance Criteria

The MVP is considered complete when:

- A guest user can successfully place an order.
- An administrator can manage the entire product catalog.
- Orders can be processed through the administration panel.
- Static pages can be edited without developer involvement.
- The storefront supports all configured languages.
- SEO metadata can be managed for every public resource.

---

# Related Documents

- BRS.md
- 01-SystemOverview.md
- 02-ArchitectureStyle.md
- 03-DomainModel.md
- SiteMap.md
- Navigation.md
- UserFlows.md
- AdminInformationArchitecture.md
