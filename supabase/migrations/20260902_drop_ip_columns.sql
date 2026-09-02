-- ============================================================
-- Data minimisation: stop retaining submitter IP addresses.
-- Migration: 20260902_drop_ip_columns
--
-- The API routes no longer write ip_address — the client IP is held in memory
-- for rate limiting only. This drops the columns (and the historical IPs still
-- sitting in them) so the retained data matches the published privacy notice.
--
-- DESTRUCTIVE: the existing IP values are deleted and cannot be recovered.
-- Review before applying. Abuse forensics remain available in Vercel's request
-- logs for their own retention window.
-- ============================================================

ALTER TABLE IF EXISTS membership_applications DROP COLUMN IF EXISTS ip_address;
ALTER TABLE IF EXISTS contact_messages       DROP COLUMN IF EXISTS ip_address;
ALTER TABLE IF EXISTS sponsor_inquiries      DROP COLUMN IF EXISTS ip_address;
ALTER TABLE IF EXISTS event_registrations    DROP COLUMN IF EXISTS ip_address;
