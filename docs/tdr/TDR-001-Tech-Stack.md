# TDR-001 — Technology Stack

**Document Version:** 1.0

**Status:** Approved

**Owner:** Architect

**Sprint:** Sprint 3 – Core Architecture

---

# Purpose

This Technology Decision Record defines the official technology stack for Commerce Core MVP.

All implementation must follow these decisions unless a newer approved TDR explicitly replaces them.

---

# Decision Summary

Commerce Core is built using a modern TypeScript-first web stack focused on maintainability, developer experience, performance, security and long-term scalability.

Every new dependency introduced into the project must provide measurable value and comply with this document.

---

# Frontend

## Framework

**Next.js 15 (App Router)**

### Reason

- Server Side Rendering (SSR)
- React Server Components
- File-based Routing
- Excellent SEO
- Long-term ecosystem support
- Strong TypeScript integration

---

## Language

**TypeScript**

### Reason

- Static typing
- Safer refactoring
- Better IDE support
- Better AI-assisted development
- Reduced runtime errors

---

## Styling

**Tailwind CSS v4**

### Reason

- Utility-first workflow
- Small production bundles
- Fast UI development
- Easy theme customization
- Excellent ecosystem

---

## UI Components

**shadcn/ui**

### Reason

- Components are owned by the project
- No vendor lock-in
- Accessible by default
- Fully customizable
- Perfect integration with Tailwind CSS

---

## Icons

**Lucide React**

### Reason

- Tree-shakeable
- Consistent design language
- Lightweight
- Large icon library

---

# Forms

## Library

React Hook Form

## Validation

Zod

### Reason

- Type-safe validation
- Shared frontend/backend schemas
- Excellent TypeScript support
- High performance

---

# Backend

## Framework

Next.js Route Handlers

### Reason

- Single deployment target
- Simpler architecture
- Excellent integration with App Router
- Easier maintenance

A separate backend service is intentionally excluded from MVP.

---

# Database

## Engine

PostgreSQL

### Reason

- ACID compliance
- Excellent relational support
- Mature ecosystem
- Powerful indexing
- Prisma compatibility

---

## ORM

Prisma

### Reason

- Type-safe queries
- Excellent migrations
- Great developer experience
- Strong TypeScript integration

---

# Authentication

Auth.js

### Reason

- Native Next.js integration
- Secure session management
- Flexible authentication providers
- Long-term maintenance

---

# Storage

## MVP

Local filesystem

## Future

S3-compatible Object Storage

### Reason

Avoid unnecessary infrastructure during MVP while keeping future migration simple.

---

# Internationalization

next-intl

### Reason

- App Router compatible
- Type-safe translations
- Active maintenance
- Excellent developer experience

---

# State Management

Preferred order

1. React Server Components
2. URL State
3. React Context
4. Local Component State

Global client-side state libraries are intentionally excluded from MVP.

---

# Data Fetching

Native fetch()

React Server Components

Server Actions where appropriate

No additional data-fetching library is required.

---

# Tables

TanStack Table

### Reason

- Headless architecture
- Flexible
- Fully customizable
- Excellent TypeScript support

---

# Testing

## Unit Testing

Vitest

## Component Testing

React Testing Library

## End-to-End Testing

Playwright

---

# Code Quality

ESLint

Prettier

Husky

lint-staged

### Reason

Ensure consistent formatting and prevent low-quality commits.

---

# Package Manager

pnpm

### Reason

- Fast installation
- Efficient disk usage
- Excellent workspace support

---

# Environment Management

Supported files

- .env.local
- .env.example

Rules

- Secrets are never committed.
- Production credentials must never exist inside the repository.

---

# Logging

## MVP

Console logging

## Future

Structured logging

Logging implementation must remain replaceable.

---

# Monitoring

Excluded from MVP.

Potential future solutions

- Sentry
- OpenTelemetry

---

# Performance Strategy

The project prioritizes:

- Server Components
- Code Splitting
- Lazy Loading
- Image Optimization
- Incremental Static Regeneration where appropriate

Performance optimization must always be measured before implementation.

---

# Security Standards

Every implementation must follow:

- OWASP Top 10
- Input validation
- Output encoding
- CSRF protection where required
- Secure authentication
- Principle of least privilege

---

# Technologies Explicitly Excluded

The following technologies are intentionally excluded from MVP:

- Redux
- MobX
- Zustand
- GraphQL
- Microservices
- Kubernetes
- Redis
- Elasticsearch
- RabbitMQ
- Kafka

These technologies may only be introduced through a new approved Technology Decision Record.

---

# Technology Evaluation Principles

Before introducing any new dependency, answer:

- What business problem does it solve?
- Can the current stack solve the same problem?
- Does it reduce long-term maintenance cost?
- Is the dependency actively maintained?
- Does it integrate well with TypeScript?

If the answer is "No", the dependency should not be added.

---

# Acceptance Criteria

The technology stack is considered finalized when:

- every implementation follows this document;
- no unapproved technologies are introduced;
- every new dependency has documented justification;
- implementation teams follow a consistent stack.

---

# Related Documents

- BRS.md
- 02-ArchitectureStyle.md
- 03-DomainModel.md
- 04-FolderStructure.md
- 05-DependencyRules.md
- API-Design.md
- Database.md
