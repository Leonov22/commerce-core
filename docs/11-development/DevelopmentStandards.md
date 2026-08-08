# Development Standards

**Document Version:** 1.0

**Status:** Approved

**Owner:** Architect

**Sprint:** Sprint 4 – Engineering Standards

---

# Purpose

This document defines the mandatory development standards for Commerce Core.

The goal is to ensure:

- consistency
- readability
- maintainability
- scalability
- predictable implementation

Every contributor must follow these standards.

---

# General Principles

All implementation must follow:

- SOLID
- DRY
- KISS
- YAGNI
- Clean Architecture
- Clean Code
- Composition over Inheritance
- Explicit Dependencies

Business value is always preferred over unnecessary complexity.

---

# Code Style

Every file must have a single responsibility.

Prefer small modules over large files.

Prefer explicit code over clever code.

Readable code is more valuable than short code.

---

# Naming

Folders

kebab-case

React Components

PascalCase

Functions

camelCase

Variables

camelCase

Constants

UPPER_SNAKE_CASE

Enums

PascalCase

Types

PascalCase

Interfaces

PascalCase

---

# Components

Each component should have one responsibility.

Avoid components longer than approximately 250 lines.

Extract reusable logic before duplicating code.

Never create generic components without a real reuse case.

---

# Hooks

Custom hooks start with:

use

Hooks should contain logic.

Hooks should not render UI.

---

# Server Components

Use Server Components by default.

Only use Client Components when required.

Examples

- forms
- browser APIs
- local interactive state

---

# Client Components

Every Client Component must include

"use client"

only when necessary.

Avoid unnecessary hydration.

---

# Server Actions

Prefer Server Actions for:

- form submission
- mutations
- authenticated operations

Do not use Server Actions for simple data retrieval.

---

# API

Every endpoint follows:

API-Design.md

No endpoint may introduce a custom response format.

---

# Validation

Validation uses:

Zod

Validation schemas belong to the owning module.

---

# Styling

Use Tailwind CSS utilities.

Avoid inline styles.

Avoid custom CSS unless justified.

Reusable UI belongs inside shadcn/ui components.

---

# Imports

Prefer aliases.

Correct

@/modules/catalog

Avoid

../../../../catalog

---

# Error Handling

Never swallow errors.

Provide meaningful user-facing messages.

Never expose internal implementation details.

Log unexpected errors appropriately.

---

# Logging

Console logging is allowed only during development.

Production debugging should use the project's logging abstraction.

---

# Comments

Avoid explaining obvious code.

Comments should explain:

- business reasoning
- architectural decisions
- non-obvious constraints

---

# Functions

Functions should:

- have one responsibility;
- be predictable;
- avoid side effects where possible;
- receive explicit parameters.

Avoid excessively long functions.

---

# Services

Services contain business orchestration.

Services do not render UI.

Services do not access browser APIs directly.

---

# Repositories

Repositories encapsulate persistence.

Repositories contain no business rules.

---

# Testing

Every new feature should include:

- unit tests where appropriate;
- integration tests when business logic spans modules;
- end-to-end tests for critical user flows.

---

# Git

Every commit should:

- solve one logical problem;
- have a descriptive message;
- keep the repository buildable.

Avoid unrelated changes in the same commit.

---

# Pull Requests

Each Pull Request should:

- address one feature or fix;
- pass linting;
- pass tests;
- include a short description.

---

# Security

Never commit:

- secrets
- tokens
- passwords
- API keys

Always validate user input.

Always respect authorization boundaries.

---

# Performance

Measure before optimizing.

Avoid premature optimization.

Prefer maintainability over micro-optimizations.

---

# Accessibility

UI must target WCAG 2.2 AA.

Use:

- semantic HTML;
- keyboard navigation;
- visible focus states;
- accessible labels.

---

# Documentation

Every architectural decision must be documented through ADRs.

Complex business logic should be documented close to the implementation.

---

# Definition of Done

A feature is complete only when:

- implementation follows the architecture;
- lint passes;
- tests pass;
- documentation is updated if required;
- code review passes;
- QA acceptance passes.

---

# Related Documents

- TDR-001-Tech-Stack.md
- FolderStructure.md
- DependencyRules.md
- API-Design.md
- Database.md
