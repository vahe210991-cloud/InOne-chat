-- P0.2: preserve the server-declared membership delta beside the exact MLS Commit.
-- Existing epochs remain NULL (legacy/unknown) and must not be treated as verified metadata.
ALTER TABLE mls_commits
  ADD COLUMN IF NOT EXISTS changes JSONB,
  ADD COLUMN IF NOT EXISTS welcome_recipients JSONB;
