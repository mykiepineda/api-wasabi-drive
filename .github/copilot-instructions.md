# Wasabi Drive - Copilot Instructions

## Project context

Wasabi Drive is an existing working MERN-based application for browsing
and previewing files stored in Wasabi Cloud Storage.

The application is currently intended for a small number of trusted users,
but it may eventually evolve into a multi-user product.

This project is also being used to learn enterprise-level software
architecture and engineering practices.

## Modernization approach

The application is being modernized incrementally.

Do not perform large-scale rewrites unless explicitly requested.

Prefer small, reviewable, behavior-preserving changes.

The developer remains responsible for architectural decisions.
When asked to refactor code, explain the proposed change and its rationale
before making broad structural changes.

## Current phase

We are currently in Phase 2: Structural Refactoring.

The objective is to improve code organization, separation of concerns,
dependency boundaries, and maintainability without intentionally changing
existing application behavior.

Do not introduce unrelated new features during structural refactoring.

## Architectural direction

The target architecture is a modular monolith with clear boundaries.

For the backend, prefer the dependency direction:

Routes
-> Controllers
-> Application/Service logic
-> Storage abstraction
-> Wasabi/S3 implementation

HTTP-specific concerns should remain in routes/controllers.

Application/business logic should not depend directly on Express.

Wasabi/S3 SDK usage should eventually be isolated behind a storage boundary.

Environment variables and application configuration should be centralized.

Frontend components should not contain unnecessary HTTP/API implementation
details. API access should eventually be isolated behind an API/service layer.

## Scope constraints

During Phase 2, do not introduce the following unless explicitly requested:

- Microservices
- A new database
- Authentication redesign
- AWS infrastructure
- Azure infrastructure
- Terraform or CDK
- CI/CD redesign
- Major UI redesign
- Framework replacements
- JavaScript-to-TypeScript migration
- Major dependency upgrades

## Refactoring rules

Preserve existing behavior unless a behavior change is explicitly approved.

Prefer one architectural change at a time.

Avoid speculative abstractions.

Do not introduce design patterns merely for the sake of using a pattern.

Before significant refactoring:
1. Identify the current responsibility of the code.
2. Identify the structural problem.
3. Explain the proposed boundary or responsibility.
4. Propose the smallest useful change.
5. Identify risks or behavior that should be verified afterward.

When possible, keep changes small enough to be reviewed and committed
independently.

## Testing

A comprehensive test safety-net phase was intentionally deferred.

Existing tests should continue to pass.

When refactoring code that is particularly risky, recommend a small targeted
test when it provides meaningful protection, but do not turn the task into
a comprehensive testing initiative unless requested.

## Engineering goal

The goal is not to make the code appear "enterprise."

The goal is to learn and apply enterprise engineering principles where they
solve actual problems in this application, particularly:

- separation of concerns
- dependency management
- modularity
- configuration management
- maintainability
- testability
- observability
- security