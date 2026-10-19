-- Settle v0.16.1 fresh baseline generated from the checked-in Drizzle schema snapshot plus migration 0013 changes.

-- Intended only for a brand-new, empty database. Do not apply to an existing database.

CREATE SCHEMA IF NOT EXISTS public;

SET search_path TO public;

CREATE TABLE public.ai_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  task text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  input_hash text NOT NULL,
  status text NOT NULL,
  result jsonb,
  error text,
  tokens_in text,
  tokens_out text,
  latency_ms text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid,
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  request_id text,
  before jsonb,
  after jsonb,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.clients (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  company_name text,
  country_code text,
  metadata jsonb,
  archived_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.communications (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  client_id uuid,
  contract_id uuid,
  invoice_id uuid,
  dispute_id uuid,
  channel text NOT NULL,
  direction text NOT NULL,
  subject text,
  body text,
  external_id text,
  metadata jsonb,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.contract_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  contract_id uuid NOT NULL,
  version text NOT NULL,
  document_id uuid,
  extracted_terms jsonb,
  content_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.contracts (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  client_id uuid NOT NULL,
  title text NOT NULL,
  status text DEFAULT 'draft' NOT NULL,
  currency text DEFAULT 'USD' NOT NULL,
  total_amount text,
  signed_at timestamp with time zone,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.dead_letter_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  queue text NOT NULL,
  job_id text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  payload jsonb NOT NULL,
  error text,
  attempts text DEFAULT '0' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone
);

CREATE TABLE public.dispute_evidence_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  dispute_id uuid NOT NULL,
  provider_evidence_type text NOT NULL,
  source text,
  required text DEFAULT 'true' NOT NULL,
  status text DEFAULT 'PENDING' NOT NULL,
  metadata jsonb,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  due_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.dispute_evidence_submissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  dispute_id uuid NOT NULL,
  evidence_request_id uuid,
  evidence_type text NOT NULL,
  notes text,
  status text DEFAULT 'PENDING' NOT NULL,
  provider_response jsonb,
  submitted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.disputes (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid,
  provider text DEFAULT 'paypal' NOT NULL,
  provider_dispute_id text NOT NULL,
  provider_transaction_id text,
  payment_id uuid,
  invoice_id uuid,
  reason text,
  status text,
  dispute_state text,
  lifecycle_stage text,
  channel text,
  amount text,
  currency text,
  seller_response_due_at timestamp with time zone,
  seller_protection_eligible text,
  seller_protection_type text,
  raw_payload jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  CONSTRAINT disputes_provider_dispute_id_unique UNIQUE (provider_dispute_id)
);

CREATE TABLE public.documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  owner_user_id uuid,
  object_key text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes text NOT NULL,
  sha256 text NOT NULL,
  status text DEFAULT 'uploaded' NOT NULL,
  verification_status text DEFAULT 'pending' NOT NULL,
  verification_error text,
  detected_content_type text,
  verified_at timestamp with time zone,
  encrypted boolean DEFAULT true NOT NULL,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.evidence_facts (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  fact_type text NOT NULL,
  value jsonb NOT NULL,
  confidence text,
  source_excerpt text,
  ai_run_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.evidence_pack_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  evidence_pack_id uuid NOT NULL,
  evidence_type text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  claim text NOT NULL,
  confidence text,
  selected text DEFAULT 'true' NOT NULL,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.evidence_packs (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  dispute_id uuid NOT NULL,
  status text DEFAULT 'DRAFT' NOT NULL,
  strength_score text,
  defense_draft text,
  analysis jsonb,
  ai_run_id uuid,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  submitted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT evidence_packs_dispute_id_unique UNIQUE (dispute_id)
);

CREATE TABLE public.idempotency_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  key text NOT NULL,
  operation text NOT NULL,
  resource_id text,
  request_hash text NOT NULL,
  status text DEFAULT 'PROCESSING' NOT NULL,
  response jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone
);

CREATE TABLE public.invoice_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  invoice_id uuid NOT NULL,
  description text NOT NULL,
  quantity text DEFAULT '1' NOT NULL,
  unit_amount text NOT NULL,
  amount text NOT NULL,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.invoices (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid,
  client_id uuid,
  contract_id uuid,
  provider text DEFAULT 'paypal' NOT NULL,
  provider_invoice_id text,
  invoice_number text,
  reference text,
  status text DEFAULT 'draft' NOT NULL,
  currency text DEFAULT 'USD' NOT NULL,
  amount text DEFAULT '0' NOT NULL,
  due_at timestamp with time zone,
  sent_at timestamp with time zone,
  paid_at timestamp with time zone,
  provider_payload jsonb,
  raw_payload jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.milestone_acceptance_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  milestone_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  action text NOT NULL,
  actor_user_id uuid,
  note text,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  metadata jsonb
);

CREATE TABLE public.milestone_deliveries (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  milestone_id uuid NOT NULL,
  submitted_by uuid,
  title text NOT NULL,
  description text,
  status text DEFAULT 'SUBMITTED' NOT NULL,
  submitted_at timestamp with time zone DEFAULT now() NOT NULL,
  accepted_at timestamp with time zone,
  accepted_by uuid,
  rejected_at timestamp with time zone,
  rejected_by uuid,
  rejection_reason text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.milestone_delivery_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  delivery_id uuid NOT NULL,
  document_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.milestone_invoices (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  milestone_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.milestones (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  contract_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  status text DEFAULT 'pending' NOT NULL,
  amount text,
  due_at timestamp with time zone,
  completed_at timestamp with time zone,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.outbox_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid,
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'PENDING' NOT NULL,
  attempts text DEFAULT '0' NOT NULL,
  available_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.payments (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  invoice_id uuid,
  provider text DEFAULT 'paypal' NOT NULL,
  provider_payment_id text,
  provider_order_id text,
  method text,
  failure_reason text,
  status text DEFAULT 'created' NOT NULL,
  amount text NOT NULL,
  currency text NOT NULL,
  captured_at timestamp with time zone,
  refunded_at timestamp with time zone,
  raw_payload jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.paypal_accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  merchant_id text,
  email text,
  environment text DEFAULT 'sandbox' NOT NULL,
  scopes jsonb,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  client_id_encrypted text,
  client_secret_encrypted text,
  webhook_id_encrypted text,
  connection_status text DEFAULT 'DISCONNECTED' NOT NULL
);

CREATE TABLE public.paypal_resources (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid,
  resource_type text NOT NULL,
  provider_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.refresh_tokens (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL,
  token_hash text NOT NULL,
  family_id uuid NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  replaced_by_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  email_verified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.webhook_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'RECEIVED' NOT NULL,
  attempts text DEFAULT '0' NOT NULL,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  workspace_id uuid
);

CREATE TABLE public.workspace_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'member' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workspaces (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT workspaces_slug_unique UNIQUE (slug)
);

ALTER TABLE public.clients ADD CONSTRAINT clients_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.contract_versions ADD CONSTRAINT contract_versions_contract_id_contracts_id_fk FOREIGN KEY (contract_id) REFERENCES public.contracts (id) ON DELETE CASCADE;

ALTER TABLE public.contracts ADD CONSTRAINT contracts_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.contracts ADD CONSTRAINT contracts_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients (id) ON DELETE RESTRICT;

ALTER TABLE public.documents ADD CONSTRAINT documents_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.documents ADD CONSTRAINT documents_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices (id) ON DELETE CASCADE;

ALTER TABLE public.milestone_acceptance_events ADD CONSTRAINT milestone_acceptance_events_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.milestone_acceptance_events ADD CONSTRAINT milestone_acceptance_events_milestone_id_milestones_id_fk FOREIGN KEY (milestone_id) REFERENCES public.milestones (id) ON DELETE CASCADE;

ALTER TABLE public.milestone_acceptance_events ADD CONSTRAINT milestone_acceptance_events_delivery_id_milestone_deliveries_id_fk FOREIGN KEY (delivery_id) REFERENCES public.milestone_deliveries (id) ON DELETE CASCADE;

ALTER TABLE public.milestone_acceptance_events ADD CONSTRAINT milestone_acceptance_events_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.milestone_deliveries ADD CONSTRAINT milestone_deliveries_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.milestone_deliveries ADD CONSTRAINT milestone_deliveries_milestone_id_milestones_id_fk FOREIGN KEY (milestone_id) REFERENCES public.milestones (id) ON DELETE CASCADE;

ALTER TABLE public.milestone_deliveries ADD CONSTRAINT milestone_deliveries_submitted_by_users_id_fk FOREIGN KEY (submitted_by) REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.milestone_deliveries ADD CONSTRAINT milestone_deliveries_accepted_by_users_id_fk FOREIGN KEY (accepted_by) REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.milestone_deliveries ADD CONSTRAINT milestone_deliveries_rejected_by_users_id_fk FOREIGN KEY (rejected_by) REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.milestone_delivery_documents ADD CONSTRAINT milestone_delivery_documents_delivery_id_milestone_deliveries_id_fk FOREIGN KEY (delivery_id) REFERENCES public.milestone_deliveries (id) ON DELETE CASCADE;

ALTER TABLE public.milestone_delivery_documents ADD CONSTRAINT milestone_delivery_documents_document_id_documents_id_fk FOREIGN KEY (document_id) REFERENCES public.documents (id) ON DELETE RESTRICT;

ALTER TABLE public.milestone_invoices ADD CONSTRAINT milestone_invoices_milestone_id_milestones_id_fk FOREIGN KEY (milestone_id) REFERENCES public.milestones (id) ON DELETE CASCADE;

ALTER TABLE public.milestone_invoices ADD CONSTRAINT milestone_invoices_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices (id) ON DELETE CASCADE;

ALTER TABLE public.milestones ADD CONSTRAINT milestones_contract_id_contracts_id_fk FOREIGN KEY (contract_id) REFERENCES public.contracts (id) ON DELETE CASCADE;

ALTER TABLE public.payments ADD CONSTRAINT payments_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.refresh_tokens ADD CONSTRAINT refresh_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;

ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;

CREATE INDEX ai_runs_workspace_idx ON public.ai_runs USING btree (workspace_id);

CREATE INDEX ai_runs_input_hash_idx ON public.ai_runs USING btree (input_hash);

CREATE INDEX clients_workspace_idx ON public.clients USING btree (workspace_id);

CREATE INDEX communications_workspace_idx ON public.communications USING btree (workspace_id);

CREATE INDEX communications_client_idx ON public.communications USING btree (client_id);

CREATE INDEX communications_invoice_idx ON public.communications USING btree (invoice_id);

CREATE UNIQUE INDEX contract_versions_contract_version_unique ON public.contract_versions USING btree (contract_id, version);

CREATE INDEX contracts_workspace_idx ON public.contracts USING btree (workspace_id);

CREATE INDEX contracts_client_idx ON public.contracts USING btree (client_id);

CREATE UNIQUE INDEX dead_letter_jobs_source_unique ON public.dead_letter_jobs USING btree (source_type, source_id);

CREATE INDEX dead_letter_jobs_queue_idx ON public.dead_letter_jobs USING btree (queue, created_at);

CREATE INDEX dead_letter_jobs_unresolved_idx ON public.dead_letter_jobs USING btree (resolved_at);

CREATE INDEX dispute_evidence_requests_dispute_idx ON public.dispute_evidence_requests USING btree (dispute_id);

CREATE UNIQUE INDEX dispute_evidence_requests_type_unique ON public.dispute_evidence_requests USING btree (dispute_id, provider_evidence_type);

CREATE INDEX dispute_evidence_submissions_dispute_idx ON public.dispute_evidence_submissions USING btree (dispute_id);

CREATE INDEX documents_workspace_idx ON public.documents USING btree (workspace_id);

CREATE INDEX documents_sha256_idx ON public.documents USING btree (sha256);

CREATE INDEX evidence_facts_workspace_idx ON public.evidence_facts USING btree (workspace_id);

CREATE INDEX evidence_facts_source_idx ON public.evidence_facts USING btree (source_type, source_id);

CREATE INDEX evidence_pack_items_pack_idx ON public.evidence_pack_items USING btree (evidence_pack_id);

CREATE INDEX evidence_packs_workspace_idx ON public.evidence_packs USING btree (workspace_id);

CREATE UNIQUE INDEX idempotency_keys_key_unique ON public.idempotency_keys USING btree (key, operation);

CREATE INDEX invoice_items_invoice_idx ON public.invoice_items USING btree (invoice_id);

CREATE UNIQUE INDEX invoices_provider_invoice_unique ON public.invoices USING btree (provider, provider_invoice_id);

CREATE INDEX invoices_workspace_idx ON public.invoices USING btree (workspace_id);

CREATE INDEX invoices_client_idx ON public.invoices USING btree (client_id);

CREATE INDEX invoices_due_idx ON public.invoices USING btree (due_at);

CREATE INDEX milestone_acceptance_events_milestone_idx ON public.milestone_acceptance_events USING btree (milestone_id);

CREATE INDEX milestone_acceptance_events_delivery_idx ON public.milestone_acceptance_events USING btree (delivery_id);

CREATE INDEX milestone_deliveries_workspace_idx ON public.milestone_deliveries USING btree (workspace_id);

CREATE INDEX milestone_deliveries_milestone_idx ON public.milestone_deliveries USING btree (milestone_id);

CREATE INDEX milestone_deliveries_status_idx ON public.milestone_deliveries USING btree (status);

CREATE UNIQUE INDEX milestone_deliveries_one_accepted_unique ON public.milestone_deliveries USING btree (milestone_id) WHERE status = 'ACCEPTED';

CREATE UNIQUE INDEX milestone_delivery_documents_unique ON public.milestone_delivery_documents USING btree (delivery_id, document_id);

CREATE INDEX milestone_delivery_documents_delivery_idx ON public.milestone_delivery_documents USING btree (delivery_id);

CREATE INDEX milestone_delivery_documents_document_idx ON public.milestone_delivery_documents USING btree (document_id);

CREATE UNIQUE INDEX milestone_invoices_milestone_unique ON public.milestone_invoices USING btree (milestone_id);

CREATE UNIQUE INDEX milestone_invoices_invoice_unique ON public.milestone_invoices USING btree (invoice_id);

CREATE INDEX milestone_invoices_milestone_idx ON public.milestone_invoices USING btree (milestone_id);

CREATE INDEX milestone_invoices_invoice_idx ON public.milestone_invoices USING btree (invoice_id);

CREATE INDEX milestones_contract_idx ON public.milestones USING btree (contract_id);

CREATE INDEX milestones_due_idx ON public.milestones USING btree (due_at);

CREATE UNIQUE INDEX outbox_topic_aggregate_unique ON public.outbox_events USING btree (topic, aggregate_type, aggregate_id);

CREATE INDEX outbox_pending_idx ON public.outbox_events USING btree (status, available_at);

CREATE INDEX outbox_workspace_idx ON public.outbox_events USING btree (workspace_id);

CREATE UNIQUE INDEX payments_provider_payment_unique ON public.payments USING btree (provider, provider_payment_id);

CREATE INDEX payments_workspace_idx ON public.payments USING btree (workspace_id);

CREATE UNIQUE INDEX paypal_accounts_workspace_unique ON public.paypal_accounts USING btree (workspace_id);

CREATE UNIQUE INDEX paypal_resources_type_id_unique ON public.paypal_resources USING btree (resource_type, provider_id);

CREATE INDEX paypal_resources_workspace_idx ON public.paypal_resources USING btree (workspace_id);

CREATE UNIQUE INDEX refresh_tokens_hash_unique ON public.refresh_tokens USING btree (token_hash);

CREATE UNIQUE INDEX users_email_unique ON public.users USING btree (email);

CREATE UNIQUE INDEX webhook_events_provider_event_unique ON public.webhook_events USING btree (provider, provider_event_id);

CREATE INDEX webhook_events_workspace_idx ON public.webhook_events USING btree (workspace_id);

CREATE UNIQUE INDEX workspace_members_workspace_user_unique ON public.workspace_members USING btree (workspace_id, user_id);

CREATE INDEX workspace_members_workspace_idx ON public.workspace_members USING btree (workspace_id);
