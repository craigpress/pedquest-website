-- ============================================================
-- qEEG "Case of the Day" — image licensing / provenance columns
-- Migration: 20260715_case_image_license
-- Idempotent. Implements docs/CASE_IMAGE_SOURCING_POLICY.md:
--   every published case image must carry a license, and images that
--   are not consortium-owned or AI-original must carry attribution.
-- ============================================================

ALTER TABLE eeg_cases
  ADD COLUMN IF NOT EXISTS image_license     TEXT,   -- see CHECK below
  ADD COLUMN IF NOT EXISTS image_attribution TEXT,   -- credit line (required unless consortium/ai-original)
  ADD COLUMN IF NOT EXISTS image_source_url  TEXT;    -- link to the original / source figure

-- Constrain the license vocabulary (Tier 1 consortium, Tier 2 open licenses,
-- public domain, and Tier 3 AI-original). NULL is allowed for drafts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eeg_cases_image_license_chk'
  ) THEN
    ALTER TABLE eeg_cases
      ADD CONSTRAINT eeg_cases_image_license_chk
      CHECK (image_license IS NULL OR image_license IN (
        'consortium','cc0','cc-by','cc-by-sa','cc-by-nc','cc-by-nd',
        'public-domain','ai-original'
      ));
  END IF;
END $$;
