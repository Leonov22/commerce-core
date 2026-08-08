# API Design

**Document Version:** 1.0

**Status:** Approved

**Owner:** Architect

**Sprint:** Sprint 3 – Core Architecture

---

# Purpose

This document defines the official REST API architecture for Commerce Core.

It establishes a consistent contract between frontend and backend by defining:

- endpoint conventions
- versioning
- request validation
- response format
- authentication
- authorization
- pagination
- filtering
- sorting
- error handling

Every API endpoint must follow this document.

---

# Architectural Style

Commerce Core uses a REST API architecture.

Reasons

- Simplicity
- Excellent tooling
- Native Next.js support
- Easy debugging
- Predictable URLs
- Long-term maintainability

GraphQL is intentionally excluded from MVP.

---

# Base URL

Current version

/api/v1

Examples

/api/v1/products

/api/v1/categories

/api/v1/orders

/api/v1/account/profile

---

# API Versioning

Breaking changes require:

New API version

Example

/api/v2/products

Non-breaking changes are allowed inside the same version.

---

# Resource Naming

Resources use plural nouns.

Correct

/products

/orders

/categories

/pages

/customers

Incorrect

/getProducts

/createProduct

/deleteOrder

---

# HTTP Methods

GET

Retrieve resources.

POST

Create resources.

PATCH

Update existing resources.

DELETE

Delete resources.

PUT is intentionally excluded from MVP.

---

# Resource Endpoints

## Products

GET     /products

GET     /products/{id}

POST    /products

PATCH   /products/{id}

DELETE  /products/{id}

---

## Categories

GET

POST

PATCH

DELETE

---

## Orders

GET

GET by id

PATCH

---

## Pages

GET

POST

PATCH

DELETE

---

## Account

GET profile

PATCH profile

GET orders

GET addresses

PATCH addresses

---

# Authentication

Public Endpoints

Products

Categories

Pages

Guest Checkout

Protected Endpoints

Profile

Orders

Addresses

Administration

Authentication uses Auth.js sessions.

---

# Authorization

Roles

Guest

Customer

Administrator

Authorization must be validated before business logic executes.

---

# Request Validation

Every request must be validated.

Validation library

Zod

Invalid requests return

400 Bad Request

Validation errors must follow the standard response format.

---

# Standard Success Response

```json
{
  "success": true,
  "data": {}
}
```

---

# Collection Response

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 250,
    "totalPages": 13
  }
}
```

---

# Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed."
  }
}
```

Every endpoint must use this structure.

---

# Pagination

Query Parameters

?page=1

&pageSize=20

Default page size

20

Maximum page size

100

---

# Sorting

Ascending

?sort=name

Descending

?sort=-createdAt

Multiple sorting is intentionally excluded from MVP.

---

# Filtering

Examples

?status=published

?category=electronics

?brand=apple

Filters may be combined.

---

# Searching

Parameter

?q=

Example

/products?q=macbook

Search implementation belongs to the corresponding business module.

---

# HTTP Status Codes

200 OK

201 Created

204 No Content

400 Bad Request

401 Unauthorized

403 Forbidden

404 Not Found

409 Conflict

422 Unprocessable Entity

500 Internal Server Error

---

# Error Codes

Standard codes

VALIDATION_ERROR

RESOURCE_NOT_FOUND

UNAUTHORIZED

FORBIDDEN

CONFLICT

INTERNAL_ERROR

Business modules may introduce additional codes.

---

# Idempotency

GET

Idempotent

PATCH

Idempotent

DELETE

Idempotent

POST

Not idempotent

---

# Security

Every endpoint must

- validate input
- validate permissions
- sanitize output
- never expose stack traces
- never expose raw database errors

---

# Rate Limiting

Excluded from MVP.

Architecture must support future implementation.

---

# File Upload

Supported Resource

Media

Accepted Formats

JPEG

PNG

WEBP

SVG

Maximum file size is configurable.

---

# API Modules

Identity

Catalog

Cart

Orders

Payments

Content

Administration

Every module owns its own endpoints.

---

# REST Conventions

Collection

/products

Single Resource

/products/{id}

Nested Resource

/orders/{id}/items

Avoid deeply nested endpoints.

Maximum nesting depth

2

---

# API Documentation

Future

OpenAPI Specification

Swagger UI

Postman Collection

Excluded from MVP.

---

# Future Extensions

Public API

OAuth Clients

Webhook Support

Bulk Operations

GraphQL

These features are intentionally excluded from MVP.

---

# Acceptance Criteria

The API architecture is complete when

- every module exposes REST endpoints;
- endpoint naming is consistent;
- authentication and authorization are clearly separated;
- responses follow one unified structure;
- validation is standardized;
- versioning strategy is documented.

---

# Related Documents

- TDR-001-Tech-Stack.md
- 03-DomainModel.md
- 04-FolderStructure.md
- 05-DependencyRules.md
- Database.md
- MVP.md
