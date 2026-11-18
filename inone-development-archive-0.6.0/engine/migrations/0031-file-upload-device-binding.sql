-- Bind unfinished upload capabilities to the device that reserved the file.
-- Legacy pending uploads without an owner device are denied and expire through cleanup.
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS owner_device_id TEXT NOT NULL DEFAULT '';
