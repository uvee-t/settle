## 0.12.0

- Added Redis-backed concurrency locks for AI defense generation and PayPal evidence submission.
- Added crash recovery for evidence submission using provider-side evidence reconciliation.
- Added `SUBMITTING` evidence submission state.
- Added concrete evidence submission IDs/types to evidence-pack audit metadata.
- Added `.env.example` and removed secret-bearing environment files from release artifacts.

## 0.10.0
- Added milestone delivery and acceptance lifecycle.
- Added verified document attachments to deliveries.
- Added immutable acceptance/rejection event history.
- Added delivery evidence candidates to dispute evidence generation.


## 0.11.0
- Persist dispute-to-payment and dispute-to-invoice links.
- Reconcile PayPal seller transaction IDs only through exact provider identifiers/payload matches; no fuzzy financial matching.
- Correct PayPal response deadline and seller-protection mapping from current dispute payload shapes.
- Evidence collection prefers persisted dispute financial links and only treats accepted deliveries as fulfillment evidence.
