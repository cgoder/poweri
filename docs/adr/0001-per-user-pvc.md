# Per-user PVC for user data

Each user's data (workspace files, pi session history, chat and execution records) lives on its own dedicated PersistentVolumeClaim. The agent platform is multi-tenant for ~10k users with hard "no data loss / no mixing" requirements, and pi is a file-based workflow (working directory = user's files, session history = JSONL under `~/.pi/agent/sessions/`). We chose a dedicated volume per user so isolation is enforced at the storage layer, not by path+permission checks, and so backup, snapshot, cost accounting, and deletion are cleanly partitioned per user.

_Considered and rejected:_ shared RWX filesystem with per-user subdirectories (cheaper, but "no mixing" degrades to path+permission isolation); object storage with pull/push sync (most elastic, but consistency risk and a poor fit for pi's file-based model).
