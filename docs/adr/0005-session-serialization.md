# Per-session serialization, parallel across sessions

Requests are serialized within a single user session (one in-flight agent request per session; later ones queue), while different sessions of the same user may run in parallel. This preserves the "no data loss / no mixing" guarantee: pi writes a session as one JSONL file, so two concurrent requests resuming the same session would race and corrupt it, whereas distinct sessions are distinct files and can proceed safely in parallel (they may still contend on shared workspace files, which is a user-level concern, not a corruption one).
