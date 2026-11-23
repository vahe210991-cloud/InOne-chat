-- Preserve the original upload name and validated media type for secure downloads.
-- Existing records remain downloadable with a neutral binary fallback.
ALTER TABLE org_request_documents
  ADD COLUMN IF NOT EXISTS filename TEXT NOT NULL DEFAULT 'document.bin',
  ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'application/octet-stream';
