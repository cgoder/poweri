# Per-user cost accounting with structured logs

The gateway aggregates per-user token and cost usage from pi's RPC events (`get_session_stats` / session stats) into the metadata store, enabling quotas, billing, and capacity planning. pi's RPC events are already JSONL, so they feed the log pipeline directly, and traces span gateway + pod. This is a paid ~10k-user platform, so usage accounting is a requirement rather than an optional nicety; the trade-off chosen is per-user aggregation now rather than basic logging only.
