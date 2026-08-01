# User Memory persists on the per-user PVC

A per-user cumulative "User Memory" (preferences, history, evolving understanding of the user) persists as files in the user's workspace on the per-user PVC, so it is physically isolated per user and survives across sessions, devices, and pod churn — the platform gets better at understanding a user the longer they interact.

**Mechanism (decided):** a pi extension maintains the memory files and reads/writes them dynamically within the agent execution loop, so memory can be consulted and updated during execution (not just injected once at request start). The extension is bundled into every worker pod image. Pre-existing "Legacy user data" (profiles, personas, historical usage) is onboarded into each user's memory at platform launch — a one-time, batched, idempotent initialization writing to the user's memory files on the PVC, with first-run loading as a fallback.
