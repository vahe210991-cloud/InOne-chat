-- Идентификатор сообщения, который задаёт клиент: повтор отправки не создаёт второго сообщения.
CREATE TABLE mls_client_messages (
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (room_id, user_id, client_message_id)
);
