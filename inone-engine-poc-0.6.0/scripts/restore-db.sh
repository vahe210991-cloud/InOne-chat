#!/usr/bin/env bash
# Восстановление из копии в ПУСТУЮ базу и (если задан архив файлов) в ПУСТУЮ папку файлов.
# Все проверки проходят до записи: повреждённая копия не оставляет частично восстановленных данных.
# Использование: ./scripts/restore-db.sh <копия базы.dump> <адрес пустой базы> [<архив файлов> <пустая папка файлов>]
set -euo pipefail
dump="${1:?укажите файл копии базы}"
target="${2:?укажите адрес пустой базы}"
files_archive="${3:-}"
files_target="${4:-}"

check_sum() {
  local file="$1" label="$2"
  [ -f "$file" ] || { echo "нет файла: $file" >&2; exit 1; }
  [ -f "$file.sha256" ] || { echo "нет контрольной суммы: $file.sha256" >&2; exit 1; }
  (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256" > /dev/null) \
    || { echo "контрольная сумма не совпала: $label повреждён, восстановление остановлено" >&2; exit 1; }
}

check_sum "$dump" "копия базы"
tables="$(psql "$target" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');")"
[ "$tables" = "0" ] || { echo "цель не пустая ($tables таблиц): восстановление остановлено" >&2; exit 1; }
if [ -n "$files_archive" ]; then
  [ -n "$files_target" ] || { echo "укажите пустую папку для файлов" >&2; exit 1; }
  check_sum "$files_archive" "архив файлов"
  if [ -d "$files_target" ] && [ -n "$(ls -A "$files_target" 2>/dev/null)" ]; then
    echo "папка для файлов не пустая: восстановление остановлено" >&2
    exit 1
  fi
fi

pg_restore --no-owner --no-acl --exit-on-error --dbname="$target" "$dump"
echo "восстановлено: $target"
if [ -n "$files_archive" ]; then
  mkdir -p "$files_target"
  tar -C "$files_target" -xzf "$files_archive"
  echo "файлы восстановлены: $files_target"
fi
