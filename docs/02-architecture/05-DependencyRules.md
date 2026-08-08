# Dependency Rules

**Document Version:** 1.0

**Status:** Approved

**Owner:** Architect

**Sprint:** Sprint 3 – Core Architecture

---

# Purpose

This document defines the official dependency rules for Commerce Core.

Its objective is to ensure a clean, scalable and maintainable architecture by preventing tight coupling, circular dependencies and uncontrolled module interaction.

Every implementation must comply with these rules.

---

# Architectural Principle

Dependencies always point toward the business core.

Presentation

↓

Application

↓

Domain

↓

Infrastructure

Dependencies must never point in the opposite direction.

---

# Dependency Direction

Allowed

Presentation

↓

Application

↓

Domain

↓

Infrastructure

Forbidden

Infrastructure

↓

Presentation

Domain

↓

Presentation

Application

↓

Infrastructure implementation

---

# Layer Responsibilities

## Presentation

Responsible for:

- UI
- Route composition
- User interaction
- State presentation

Presentation may depend on:

- Application
- Shared
- Core

Presentation must never depend directly on:

- Prisma
- Database
- External APIs

---

## Application

Responsible for:

- Use cases
- Business orchestration
- Transaction coordination

Application may depend on:

- Domain
- Shared
- Core

Application must never depend on Presentation.

---

## Domain

Responsible for:

- Business rules
- Entities
- Value Objects
- Domain Services
- Business Policies

The Domain layer must remain framework independent.

Forbidden imports:

- React
- Next.js
- Prisma
- Browser APIs
- Database Clients

The Domain layer is the most stable part of the system.

---

## Infrastructure

Responsible for implementing technical details.

Examples

- Prisma repositories
- Storage adapters
- External APIs
- Email providers
- Payment providers

Infrastructure may depend on:

- Domain
- Core
- External libraries

Infrastructure must never contain business rules.

---

# Module Boundaries

Each module owns:

- its entities
- its use cases
- its repositories
- its validation
- its presentation
- its services

Business logic must never be duplicated across modules.

---

# Cross Module Communication

Modules communicate only through public interfaces.

Correct

```ts
import { CatalogService } from "@/modules/catalog";
```

Incorrect

```ts
import ProductRepository from "@/modules/catalog/infrastructure/repositories/ProductRepository";
```

Consumers must never access another module's internal implementation.

---

# Shared Layer

The Shared layer contains only business-independent code.

Allowed

- UI components
- utility functions
- generic hooks
- shared schemas
- shared types
- icons

Forbidden

- Product logic
- Order logic
- Customer logic
- Payment logic

If code knows business concepts, it belongs inside a module.

---

# Core Layer

Core contains global infrastructure.

Examples

- configuration
- authentication bootstrap
- providers
- middleware
- environment
- logging

Core must never implement business rules.

---

# Public Module API

Every module exposes exactly one public entry point.

Example

```text
@/modules/catalog
```

Consumers must import only through that entry point.

Deep imports are forbidden.

---

# Circular Dependencies

Circular dependencies are prohibited.

Forbidden example

Catalog

↓

Orders

↓

Catalog

Correct approach

Extract reusable abstraction into Shared or Core only if it is business-independent.

---

# Validation Rules

Validation belongs to the module that owns the business rules.

Shared validation is allowed only for generic reusable schemas.

---

# State Ownership

Business state belongs to modules.

Global application state belongs to Core.

Component state belongs to components.

Avoid duplicated state.

---

# Error Handling

Business errors belong to modules.

Infrastructure errors must be translated into business-friendly errors before reaching Presentation.

Raw database errors must never be exposed to the UI.

---

# Dependency Injection

Prefer constructor or function injection where appropriate.

Avoid global mutable singletons.

Dependencies should be explicit.

---

# Import Strategy

Always use project aliases.

Correct

```ts
import { ProductCard } from "@/modules/catalog";
```

Avoid deep relative imports.

Incorrect

```ts
../../../../catalog/components/ProductCard
```

---

# Code Ownership

Every file has exactly one owner.

Every business rule belongs to exactly one module.

Duplicate implementations are forbidden.

---

# Future Evolution

New modules must follow these rules without modification.

Exceptions require a new approved Architecture Decision Record (ADR).

---

# Acceptance Criteria

Dependency rules are considered complete when:

- module boundaries are respected;
- circular dependencies are impossible;
- business logic is isolated inside its owning module;
- infrastructure does not leak into higher layers;
- every dependency direction follows the approved architecture.

---

# Related Documents

- 02-ArchitectureStyle.md
- 03-DomainModel.md
- 04-FolderStructure.md
- TDR-001-Tech-Stack.md
- API-Design.md
- Database.md
