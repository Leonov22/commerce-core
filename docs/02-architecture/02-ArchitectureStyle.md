# Architecture Style

Status: Approved

Owner: Architect

Last Updated: 2026-08-07

---

# Purpose

This document defines the architectural style used throughout Commerce Core.

Every module, feature, and future extension must follow the principles described here.

This document is considered mandatory for all contributors.

---

# Selected Architecture

Commerce Core uses a **Feature-First Modular Monolith** architecture.

The application is deployed as a single system while remaining internally divided into isolated business modules.

The objective is to achieve simplicity during development while preserving long-term scalability.

---

# Why Modular Monolith

The project currently has:

- one development team
- one deployment target
- one database
- one application

Introducing distributed systems would increase complexity without providing measurable business value.

A modular monolith provides:

- fast development
- simple deployment
- easier debugging
- lower operational cost
- clean module boundaries
- future migration path

---

# Architectural Principles

## Module First

Business functionality is grouped by feature.

Never group files by technical type across the whole application.

Correct:

Catalog

Orders

Checkout

Authentication

Administration

Incorrect:

Components

Hooks

Utils

Services

Repositories

---

## Business Isolation

Every module owns its own business logic.

Modules must never manipulate another module's internal implementation.

Communication happens only through published interfaces.

---

## Single Responsibility

Every module has one clear responsibility.

Every service has one responsibility.

Every component has one responsibility.

---

## Dependency Direction

Dependencies always point inward.

Presentation

↓

Application

↓

Domain

↓

Infrastructure

Lower layers never depend on upper layers.

---

## Explicit Dependencies

Hidden dependencies are forbidden.

Every dependency should be visible through imports or dependency injection.

---

## Configuration over Modification

Whenever practical, behavior should be configurable.

New stores should require configuration instead of rewriting source code.

---

## Convention over Configuration

Common development tasks should follow predictable conventions.

Avoid unnecessary configuration.

---

## Composition over Inheritance

Prefer composition.

Avoid inheritance except where absolutely justified.

---

## Reusable Components

UI components must remain independent from business logic.

Business rules never belong inside reusable UI.

---

## Stateless UI

Presentation components should remain as stateless as practical.

Business state belongs to application modules.

---

## Feature Encapsulation

Each feature owns:

- components
- services
- schemas
- types
- validation
- business rules

Avoid cross-feature file sharing unless promoted into Shared.

---

## Shared Module

Shared contains only generic functionality.

Examples:

Buttons

Inputs

Dialogs

Icons

Utilities

Generic hooks

Shared must never contain business logic.

---

## Core Module

Core contains global application services.

Examples:

Configuration

Logging

Authentication bootstrap

Environment

Global providers

Core never depends on business modules.

---

## Admin Independence

Administration is a client of the business modules.

It does not own business rules.

---

## Theme Independence

Theme controls appearance only.

Theme never changes business behavior.

---

## Internationalization

Translations must never affect application logic.

Only displayed text changes.

---

## API Independence

Business logic must be reusable.

Whether requests originate from:

- Web
- Mobile
- REST API
- Future integrations

The same business rules must execute.

---

## Database Independence

Business logic should not depend directly on the database implementation.

Persistence must remain replaceable.

---

# Architecture Goals

Priority order:

1. Maintainability

2. Simplicity

3. Readability

4. Testability

5. Security

6. Performance

7. Scalability

---

# Future Evolution

The architecture intentionally allows future extraction of individual modules into independent services.

Such migration must not require rewriting business logic.

---

# Compliance

Every implementation must comply with this document.

Code Review verifies compliance.

Architect approves exceptions.

Any violation requires an ADR before implementation.
