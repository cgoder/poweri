# Usage metering and invoice generation (no payment gateway)

The platform tallies per-user usage meters — model tokens/cost from pi RPC events, plus resource/data metrics (CPU, storage, bandwidth, egress) from platform side — into the metadata/metering store, then derives per-user invoices by applying pricing rules. This extends ADR-0006 (which covered token/cost accounting) into a full metering + invoicing pipeline. External payment collection (e.g. Stripe) is explicitly out of scope for now: we generate invoices, not collect payments.
