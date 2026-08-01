# Agent Platform Context

A multi-tenant platform (~10k users) that serves each user's requests (chat, tools, other agent work) through a routing gateway into containerized worker pods that run pi (pi-coding-agent). Hard requirement: per-user data must never be lost and never mixed between users.

## Language

**Gateway**:
The control plane and business layer. It authenticates users, routes each request to a worker pod, and holds user↔session/bookkeeping. Stateless.
_Avoid_: server, backend, router

**Worker pod**:
A containerized runtime that executes a user's request by driving pi in headless mode. Ephemeral and stateless: it mounts the user's PVC at request time and can be discarded.
_Avoid_: container (when meaning the pod), sandbox, worker

**User data store**:
The per-user PVC holding that user's workspace files, pi session history (chat records), and execution records. Physically isolated per user.
_Avoid_: storage, volume

**Session**:
A user's pi conversation, persisted as JSONL (chat + tool executions) under `~/.pi/agent/sessions/`. Resumable across requests.
_Avoid_: chat thread, history (when meaning a specific session)

**User Memory**:
A per-user, cumulative record of preferences, history, and evolving understanding of the user, persisted as files in the user's workspace (on the per-user PVC) and consulted across sessions so the platform increasingly understands the user.
_Avoid_: profile, context, history (when meaning cumulative memory vs a single session)

**Usage meter**:
A per-user aggregation of resource, data, and model consumption (tokens, cost, storage, egress) tallied from pi RPC events and platform metrics.
_Avoid_: stats, analytics (when meaning the metering record)

**Invoice**:
A per-user charge derived from usage meters by applying pricing rules. Payment collection is out of scope.
_Avoid_: bill (ambiguous)

**Legacy user data**:
Pre-existing user profile, persona, and historical usage records held before the platform launched, to be onboarded into a user's User Memory (at launch or on first run).
_Avoid_: archive, history
