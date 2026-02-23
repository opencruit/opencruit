---
name: update-docs
description: 'Audit and update project documentation (CLAUDE.md, docs/CONTEXT.md) to match the current codebase state.'
user-invocable: true
---

# Update Docs

Scan the codebase and bring project documentation in sync with reality.

## Target Files

| File              | Purpose                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `CLAUDE.md`       | Agent instructions — monorepo structure, commands, conventions, architecture decisions, version policy |
| `docs/CONTEXT.md` | Deep context — architecture, approaches, tech stack versions, current package structure                |

## Workflow

### 1) Gather Facts

Read current state:

- `pnpm-workspace.yaml` — workspace globs, catalog versions
- `package.json` (root) — scripts, devDependencies
- `tsconfig.json` (root) — references
- `turbo.json` — pipeline tasks
- All `packages/*/package.json` and `packages/parsers/*/package.json` — names, deps
- All `apps/*/package.json` — if any exist
- Current `CLAUDE.md` and `docs/CONTEXT.md`

### 2) Diff Analysis

Compare facts against documentation. Find discrepancies:

- **Monorepo structure** — new/removed packages, apps
- **Commands** — new scripts in root package.json
- **Tech stack versions** — catalog vs docs mismatch
- **Architecture decisions** — new patterns, changed approaches
- **Conventions** — new rules, stale sections
- **Dependencies** — new shared deps in catalog

### 3) Update

Apply minimal, targeted edits to both files:

- Add new items (packages, decisions, conventions)
- Remove stale content (no dead documentation)
- Update versions, structure, descriptions
- Preserve existing style and formatting of each file

### 4) Report

After updating, output a brief summary of changes:

```
Updated:
- CLAUDE.md: added parser-sdk to structure, updated versions
- docs/CONTEXT.md: added section on X, removed stale Y
```

Or:

```
Documentation is up to date, no changes needed.
```

## Rules

- Do NOT add speculative information — only what is confirmed by code
- Do NOT duplicate content between files — CLAUDE.md for instructions, CONTEXT.md for context
- Do NOT bloat documents — keep it concise
- If a discrepancy is found but the correct state is unclear — ask the user
