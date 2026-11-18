-- Persist the user's selected in-app language for profile and pending registration email.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'hy'
  CHECK (locale IN ('hy', 'ru', 'en'));

ALTER TABLE email_codes
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'hy'
  CHECK (locale IN ('hy', 'ru', 'en'));
