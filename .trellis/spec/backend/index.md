# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Partial |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | Partial |
| [Error Handling](./error-handling.md) | Error types, handling strategies | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels, provider upstream request logs | Partial |
| [Provider Ops CLI Guidelines](./provider-ops-cli.md) | Provider CLI contracts, secret handling, tenant boundary, verification | Partial |
| [Frozen Frontend Legacy API](./legacy-api-v1.md) | `/api/v1` compatibility, auth token separation, legacy IDs, and old-host proxy rollout | Active |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
