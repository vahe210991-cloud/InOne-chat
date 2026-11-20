-- Bind unfinished upload capabilities to the device that reserved the file.
-- Existing pending uploads without an owner device are intentionally denied by the
-- object-upload handler; they expire through the existing stale-upload cleanup.
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS owner_device_id TEXT NOT NULL DEFAULT '';
