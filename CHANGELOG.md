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
