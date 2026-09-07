-- Add HOSPITAL_SITE to the SubscriptionTier enum.
-- Positioned between DIAGNOSTIC_CENTER and ENTERPRISE to mirror the schema.
--
-- Additive-only. Cannot run inside a transaction (Postgres restriction on
-- ALTER TYPE … ADD VALUE), so this migration must run as a single statement.

ALTER TYPE "SubscriptionTier" ADD VALUE IF NOT EXISTS 'HOSPITAL_SITE' BEFORE 'ENTERPRISE';
