ALTER TABLE paypal_accounts
  ADD COLUMN IF NOT EXISTS client_id_encrypted text,
  ADD COLUMN IF NOT EXISTS client_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS webhook_id_encrypted text,
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'DISCONNECTED';

-- Keep old global-account rows disconnected until a workspace explicitly validates its own app credentials.
UPDATE paypal_accounts SET connection_status = 'DISCONNECTED' WHERE client_id_encrypted IS NULL OR client_secret_encrypted IS NULL;

ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS workspace_id uuid;
CREATE INDEX IF NOT EXISTS webhook_events_workspace_idx ON webhook_events(workspace_id);
