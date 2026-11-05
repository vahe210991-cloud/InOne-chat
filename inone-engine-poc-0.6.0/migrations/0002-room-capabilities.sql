-- Права участников беседы. Существующие участники получают права по умолчанию,
-- администраторы дополнительно получают права администратора.
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS capabilities TEXT[] NOT NULL DEFAULT '{}';
UPDATE room_members SET capabilities = ARRAY['send_messages', 'send_stickers_gifs', 'forward_messages', 'edit_own_messages', 'delete_own_messages'];
UPDATE room_members SET capabilities = ARRAY['send_messages', 'send_stickers_gifs', 'forward_messages', 'edit_own_messages', 'delete_own_messages', 'invite_members', 'remove_members'] WHERE is_admin;
