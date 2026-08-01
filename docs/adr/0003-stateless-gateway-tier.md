# Horizontally-scaled stateless gateway tier

The gateway is a stateless, horizontally scalable tier behind a load balancer, not a single instance. All state lives outside it — user data on per-user PVCs, plus a metadata store for user→session and accounting. Any gateway instance can route any request, so the tier scales out for ~10k concurrent users and has no single point of failure. The user's original "one gateway" holds only as a logical concept: one gateway as a scaling tier, not one process.

_Considered and rejected:_ a single gateway instance (simplest, but a single point of failure and one process cannot sustain ~10k concurrent WebSockets); a primary/standby pair (still a hard per-instance concurrency ceiling).
