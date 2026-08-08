# Folder Structure

**Document Version:** 1.0

**Status:** Approved

**Owner:** Architect

**Sprint:** Sprint 3 – Core Architecture

---

# Purpose

This document defines the official repository and source code structure for Commerce Core.

The primary goals are:

- predictable project organization;
- business-oriented modularity;
- scalability;
- maintainability;
- clear ownership of every file.

Every file added to the project must have an obvious location.

---

# Architectural Principle

The project is organized around **business domains**, not technical layers.

Business capabilities own their implementation.

The framework (Next.js) is considered infrastructure, not architecture.

---

# Repository Structure

```text
commerce-core/
├── .github/
├── docs/
├── prisma/
├── public/
├── scripts/
├── src/
├── tests/
├── .editorconfig
├── package.json
├── tsconfig.json
└── README.md
```

---

# Source Structure

```text
src/
├── app/
├── core/
├── modules/
├── shared/
└── types/
```

---

# app/

Purpose

Contains the Next.js App Router.

Responsibilities

- routing
- layouts
- pages
- route handlers
- loading pages
- error pages
- not-found pages

Must NOT contain

- business logic
- database queries
- validation rules
- domain models

The `app/` directory should remain as thin as possible.

---

# core/

Purpose

Application-wide infrastructure.

Typical contents

```text
core/
├── auth/
├── config/
├── constants/
├── lib/
├── middleware/
├── providers/
└── services/
```

Responsibilities

- authentication bootstrap
- environment configuration
- dependency initialization
- application providers
- middleware
- shared infrastructure

Must NOT contain business rules.

---

# modules/

Purpose

Business functionality.

Every domain owns one module.

Initial modules

```text
modules/
├── administration/
├── cart/
├── catalog/
├── content/
├── identity/
├── orders/
└── payments/
```

Each module is autonomous.

---

# Module Structure

Every module follows the same structure.

```text
catalog/
├── application/
├── components/
├── domain/
├── hooks/
├── infrastructure/
├── presentation/
├── repositories/
├── schemas/
├── services/
└── types/
```

---

# Layer Responsibilities

## application/

Application use cases.

Coordinates business operations.

Contains orchestration only.

---

## domain/

Pure business rules.

Contains

- entities
- value objects
- domain services
- business policies

Must remain framework independent.

---

## infrastructure/

Implements technical concerns.

Examples

- Prisma repositories
- external APIs
- storage adapters

Infrastructure implements contracts defined by the domain.

---

## presentation/

Feature entry point.

Contains

- feature pages
- containers
- presentation logic

---

## components/

Reusable UI components belonging only to this module.

Never shared globally unless reused by multiple domains.

---

## hooks/

Feature-specific React hooks.

---

## repositories/

Persistence abstractions.

No business rules.

---

## schemas/

Validation schemas.

Primarily Zod.

---

## services/

Application services.

No UI rendering.

---

## types/

Types used only inside this module.

---

# shared/

Purpose

Reusable, business-independent code.

Typical structure

```text
shared/
├── components/
├── constants/
├── hooks/
├── icons/
├── schemas/
├── types/
└── utils/
```

Shared must never know:

- Product
- Order
- Customer
- Payment

If business knowledge appears, the code belongs inside a module.

---

# types/

Purpose

Global shared TypeScript types.

Only types used by multiple modules belong here.

---

# prisma/

Contains

- schema.prisma
- migrations
- seed scripts

Database implementation only.

---

# public/

Contains static assets.

Examples

- images
- icons
- fonts
- robots.txt
- favicon.ico

---

# tests/

Purpose

Shared testing infrastructure.

```text
tests/
├── e2e/
├── fixtures/
├── helpers/
├── integration/
├── mocks/
└── unit/
```

---

# scripts/

Automation scripts.

Examples

- seed
- cleanup
- generate-icons
- generate-sitemap

---

# Naming Conventions

Folders

- kebab-case

React Components

- PascalCase

Utilities

- camelCase

Constants

- UPPER_SNAKE_CASE where appropriate

---

# Import Strategy

Always prefer path aliases.

Example

```ts
import { ProductCard } from "@/modules/catalog/components";
```

Avoid long relative imports.

Bad

```ts
../../../components/ProductCard
```

---

# Forbidden

The following are forbidden:

- business logic inside `app/`
- business logic inside `shared/`
- circular dependencies
- duplicate business rules
- deep cross-module imports
- utility dumping grounds

---

# Growth Strategy

New business capabilities create new modules.

Existing modules are expanded before introducing new shared abstractions.

The folder structure should remain stable as the application evolves.

---

# Acceptance Criteria

The folder structure is considered complete when:

- every file has an obvious location;
- every business capability owns its implementation;
- infrastructure is separated from business logic;
- shared code remains business independent;
- developers can navigate the repository without additional documentation.

---

# Related Documents

- 02-ArchitectureStyle.md
- 03-DomainModel.md
- 05-DependencyRules.md
- TDR-001-Tech-Stack.md
