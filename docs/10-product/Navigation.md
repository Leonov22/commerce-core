# Navigation

**Document Version:** 1.0

**Status:** Approved

**Owner:** Architect

**Sprint:** Sprint 2 – Product Architecture

---

# Purpose

This document defines all navigation patterns used throughout Commerce Core.

It standardizes navigation behavior across desktop and mobile devices while ensuring consistency, accessibility, and scalability.

This document does not define visual design.

---

# Navigation Principles

Navigation must be:

- Simple
- Predictable
- Accessible
- Consistent
- Responsive

Users should always know:

- where they are;
- where they can go next;
- how to return.

---

# Navigation Types

Commerce Core uses five navigation systems.

1. Primary Navigation
2. Utility Navigation
3. Breadcrumb Navigation
4. Footer Navigation
5. Context Navigation

---

# Primary Navigation

Displayed in the website header.

Contains only high-level destinations.

Items:

- Home
- Catalog
- About
- Contact

Rules

- Never exceeds six items.
- Never contains account pages.
- Never contains legal pages.

---

# Utility Navigation

Displayed in the top-right area of the header.

Items

- Search
- Language Switcher
- Account
- Cart

Rules

Accessible from every public page.

---

# Footer Navigation

Groups low-frequency pages.

Company

- About
- Contact

Customer

- FAQ
- Delivery & Payment

Legal

- Privacy Policy
- Terms & Conditions

Social

Administrator-configurable social links.

---

# Breadcrumb Navigation

Displayed on:

- Category
- Product
- Static Content Pages

Not displayed on:

- Home
- Cart
- Checkout
- Login
- Register

Example

Home

↓

Catalog

↓

Electronics

↓

MacBook Air M4

---

# Context Navigation

Customer Dashboard

Dashboard

Orders

Addresses

Profile

Administrator Dashboard

Dashboard

Catalog

Sales

Customers

Content

Media

SEO

Settings

---

# Mobile Navigation

Mobile navigation uses a drawer.

Contains:

- Primary Navigation
- Utility Navigation
- Footer Links

The shopping cart remains accessible outside the drawer.

---

# Search

Global Search

Accessible from every page.

Future versions may include:

- autocomplete
- search suggestions
- recent searches

---

# Language Switcher

Always visible.

Changing language must:

- preserve the current page when possible;
- never log out the user;
- never clear the shopping cart.

---

# Logo

Clicking the logo always returns the user to Home.

This behavior is mandatory.

---

# Cart Icon

Always visible.

Displays:

- item count

Future:

- mini cart preview

---

# Account Navigation

Guest

Login

Register

Customer

Dashboard

Orders

Addresses

Profile

Logout

---

# Accessibility

Navigation must support:

- keyboard navigation
- visible focus indicators
- screen readers
- ARIA landmarks
- WCAG 2.2 AA compliance

---

# Responsive Behavior

Desktop

Horizontal navigation.

Tablet

Compact horizontal navigation.

Mobile

Drawer navigation.

Navigation behavior remains functionally identical across devices.

---

# Future Navigation

The following features are excluded from MVP:

- Mega Menu
- Sticky Category Navigation
- Recently Viewed
- Quick Search
- Personalized Navigation

---

# Acceptance Criteria

Navigation is considered complete when:

- every page is reachable in no more than three clicks;
- all navigation systems are consistent;
- desktop and mobile expose the same functionality;
- navigation is fully keyboard accessible;
- navigation passes accessibility testing.

---

# Related Documents

- MVP.md
- SiteMap.md
- UserFlows.md
- AdminInformationArchitecture.md
- 03-DomainModel.md
