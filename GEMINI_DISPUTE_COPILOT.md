# Gemini dispute copilot and PayPal conversation history

## Enable Gemini

Set `AI_ENABLED=true`, `AI_PROVIDER=gemini`, `AI_MODEL=gemini-2.5-flash`, and `AI_API_KEY` in the backend API and worker environments. Restart both processes after changing environment variables. The API and worker must share the same configuration. The `/v1/ai/status` endpoint (authenticated) reports enabled/provider/model/key-configured status without revealing the key.

Existing document extraction and evidence-pack AI jobs remain in place. The dispute copilot is an on-demand endpoint:
`POST /v1/disputes/:providerDisputeId/ai-copilot`

It retrieves the current PayPal dispute details and analyzes provider-returned messages. It returns a structured case summary, buyer intent, sentiment, risk, evidence strengths/gaps, contradictions, recommended actions, suggested reply and defense strategy. The result is recorded in `ai_runs` for auditability and reuse. It does not send messages, submit evidence, or take actions automatically.

## PayPal conversation history

The dispute detail endpoint returns the latest PayPal dispute resource. The UI renders the `messages` array when PayPal supplies it. Availability and fields depend on the dispute and PayPal API response. Settle does not fabricate missing buyer/merchant messages. Sending a message still requires the user's explicit action through the existing PayPal message endpoint; after sending, refresh the dispute to see whether PayPal includes it in `messages`.

## Safety

AI output is advisory, not evidence. Verify all claims against source records. Suggested replies are editable drafts and are never sent automatically. Do not use AI-generated claims as proof unless independently supported by records.
