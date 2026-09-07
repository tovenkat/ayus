-- Add DOCTOR_NOTE to the ShareResource enum so doctor visits can be shared
-- via /api/share alongside emergency cards, visit prep, reports, and full wiki.
--
-- Additive-only. ALTER TYPE … ADD VALUE cannot run in a transaction.

ALTER TYPE "ShareResource" ADD VALUE IF NOT EXISTS 'DOCTOR_NOTE' AFTER 'FULL_WIKI';
