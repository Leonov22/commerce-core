# User Flows

**Document Version:** 1.0

**Status:** Approved

**Owner:** Architect

**Sprint:** Sprint 2 – Product Architecture

---

# Purpose

This document defines the primary business flows supported by Commerce Core MVP.

Each flow describes:

- User Goal
- Preconditions
- Main Flow
- Alternative Flow
- Error Flow
- Expected Result

These flows are implementation-independent and serve as the source of truth for frontend, backend, QA, and future API design.

---

# Flow 1 — Browse Catalog

## User Goal

Browse available products.

## Preconditions

- Store is online.

## Main Flow

1. User opens Home page.
2. User navigates to Catalog.
3. User selects a category (optional).
4. User browses products.
5. User opens a product page.

## Alternative Flow

- User uses Search instead of browsing categories.

## Error Flow

- Category not found → 404 Page.
- Product unavailable → Product page displays "Unavailable".

## Expected Result

User reaches the Product page.

---

# Flow 2 — Add Product to Cart

## User Goal

Add a product to the shopping cart.

## Preconditions

- Product is available for purchase.

## Main Flow

1. User selects quantity.
2. User clicks "Add to Cart".
3. System validates product availability.
4. Product is added to the cart.
5. Cart counter updates.

## Alternative Flow

Product already exists in cart.

System increases quantity.

## Error Flow

- Product out of stock.
- Quantity exceeds available stock.

## Expected Result

Shopping cart contains the selected product.

---

# Flow 3 — Guest Checkout

## User Goal

Purchase products without registration.

## Preconditions

- Cart contains at least one item.

## Main Flow

1. User opens Cart.
2. User clicks Checkout.
3. User enters shipping information.
4. User enters billing information.
5. User selects payment method.
6. User reviews order.
7. User confirms purchase.
8. System creates the order.
9. Confirmation page is displayed.

## Alternative Flow

Customer decides to register before completing the purchase.

## Error Flow

- Invalid form fields.
- Required fields missing.
- Product becomes unavailable during checkout.

## Expected Result

Order is successfully created.

---

# Flow 4 — Customer Login

## User Goal

Access personal account.

## Preconditions

- Customer account exists.

## Main Flow

1. User opens Login page.
2. User enters credentials.
3. System validates credentials.
4. Dashboard is displayed.

## Error Flow

- Invalid credentials.
- Locked account (future).
- Too many failed attempts (future).

## Expected Result

Authenticated session is created.

---

# Flow 5 — View Order History

## User Goal

Review previous purchases.

## Preconditions

- User is authenticated.

## Main Flow

1. User opens Dashboard.
2. User selects Orders.
3. Order list is displayed.
4. User opens Order Details.

## Expected Result

Customer can review order information.

---

# Flow 6 — Update Profile

## User Goal

Update personal information.

## Preconditions

- User is authenticated.

## Main Flow

1. User opens Profile.
2. User edits personal information.
3. User clicks Save.
4. System validates input.
5. Profile is updated.

## Error Flow

Validation fails.

Profile remains unchanged.

## Expected Result

Profile information is updated successfully.

---

# Flow 7 — Administrator Creates Product

## User Goal

Publish a new product.

## Preconditions

- Administrator is authenticated.
- User has Product Management permission.

## Main Flow

1. Administrator opens Dashboard.
2. Opens Catalog.
3. Opens Products.
4. Clicks Create Product.
5. Completes required fields.
6. Uploads images.
7. Saves Draft or Publishes.

## Alternative Flow

Product saved as Draft.

## Error Flow

Validation fails.

Draft remains editable.

## Expected Result

Product becomes available according to selected status.

---

# Flow 8 — Administrator Processes Order

## User Goal

Update order status.

## Preconditions

- Administrator is authenticated.

## Main Flow

1. Administrator opens Orders.
2. Opens Order Details.
3. Selects new status.
4. Saves changes.

## Expected Result

Order status is updated.

---

# Global Error Flows

## Unauthorized Access

System redirects the user to Login.

---

## Resource Not Found

System displays the 404 page.

---

## Server Error

System displays a friendly error message.

No sensitive information is exposed.

---

## Validation Error

Invalid fields are highlighted.

User data remains unchanged.

---

# Future Flows

The following flows are intentionally excluded from MVP:

- Wishlist
- Product Reviews
- Coupons
- Returns
- Order Tracking
- Loyalty Program
- Gift Cards
- Marketplace

---

# Acceptance Criteria

This document is complete when:

- every MVP feature has a defined user flow;
- every flow includes error handling;
- frontend and backend teams can implement features without redefining business behavior;
- QA can derive test scenarios directly from these flows.

---

# Related Documents

- MVP.md
- SiteMap.md
- Navigation.md
- AdminInformationArchitecture.md
- 03-DomainModel.md
