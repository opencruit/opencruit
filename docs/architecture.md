# OpenCruit — Architecture Overview

High-level system architecture. For implementation details see `CONTEXT.md`.

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Web UI (SvelteKit)                   │
│                   candidate-facing frontend                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                        API Layer                            │
│              jobs · search · matching · tracker             │
└─────┬────────────┬───────────────┬──────────────┬───────────┘
      │            │               │              │
      ▼            ▼               ▼              ▼
┌──────────┐ ┌──────────┐ ┌────────────┐ ┌───────────────┐
│ Job      │ │ AI       │ │ Job Search │ │ Application   │
│ Ingestion│ │ Services │ │ & Matching │ │ Tracker (CRM) │
│ Pipeline │ │          │ │            │ │               │
└────┬─────┘ └──────────┘ └────────────┘ └───────────────┘
     │
     ▼
┌──────────────────────────────────────────────────────────────┐
│                     Parser Orchestrator                      │
│              BullMQ · scheduling · retries                   │
└─────┬──────────┬──────────┬──────────┬──────────────────────┘
      │          │          │          │
      ▼          ▼          ▼          ▼
  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
  │Parser 1│ │Parser 2│ │Parser 3│ │Parser N│   HTTP contract
  │remoteok│ │  ...   │ │  ...   │ │  ...   │   /manifest
  └────────┘ └────────┘ └────────┘ └────────┘   /health
                                                 /parse
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                             │
│         PostgreSQL · Redis (queues + streams + cache)       │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### Parsers

Standalone HTTP services that scrape/fetch jobs from external sources. Language-agnostic — any runtime that implements the HTTP contract (`/manifest`, `/health`, `/parse`) works.

Three distribution models:
- **Open** — main repo, public API sources
- **Private** — separate repo, anti-bot sensitive sources
- **Community** — external repos, anyone can build and publish

### Parser Orchestrator

Manages parser scheduling, retries, and concurrency. Powered by BullMQ + Redis.

### Ingestion Pipeline

Processes raw jobs from parsers through a multi-stage pipeline:

```
raw job → normalize → validate → fingerprint → deduplicate → enrich → store → emit event
```

Deduplication uses 3 tiers: exact ID match, content fingerprint (SHA-256), fuzzy match (pg_trgm).

### Event Bus

Redis Streams for async job events (`job.new`, `job.updated`, `job.expired`). Consumer groups decouple downstream services (notifications, search indexer, analytics).

### Search & Matching

MVP: PostgreSQL full-text search (tsvector with weighted ranking). AI-powered matching scores jobs against user profile and resume.

### AI Services

Multi-provider LLM integration (OpenAI, Anthropic, Ollama for self-hosted):
- Resume analysis and scoring against specific jobs
- Resume generation tailored to job requirements
- Job-candidate matching and recommendations

### Application Tracker

Kanban-style CRM for managing job search: status tracking, reminders, follow-ups, conversion analytics.

### Web UI

SvelteKit frontend. Candidate-first: search, match, apply, track.

## Infrastructure

```
docker compose up
├── PostgreSQL    — primary data store
├── Redis         — BullMQ queues + Streams + cache (single instance)
├── App services  — API + workers + UI
└── Parsers       — one container per parser
```

Single `docker compose up` for self-hosting. One Redis instance handles everything (queues, events, cache).

## Data Flow

1. **Orchestrator** triggers parsers on schedule
2. **Parsers** fetch jobs, return via HTTP (`/parse`)
3. **Ingestion pipeline** normalizes, deduplicates, stores in PostgreSQL
4. **Event bus** emits `job.new` / `job.updated` events via Redis Streams
5. **Search indexer** updates PostgreSQL tsvector index
6. **AI matching** scores new jobs against user profiles
7. **Web UI** presents results, user applies and tracks
