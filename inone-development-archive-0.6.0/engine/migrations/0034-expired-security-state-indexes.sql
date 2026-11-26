-- Stage 4 B-07: support bounded pruning of stale rate-limit state.
-- Retain active windows and active login blocks; cleanup uses window_start and blocked_until.
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx
  ON rate_limits (window_start);

CREATE INDEX IF NOT EXISTS login_throttle_expiry_idx
  ON login_throttle (window_start, blocked_until);
