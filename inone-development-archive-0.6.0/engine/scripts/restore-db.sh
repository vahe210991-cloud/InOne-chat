#!/usr/bin/env bash
# Восстановление из копии в ПУСТУЮ базу и (если задан архив файлов) в ПУСТУЮ папку файлов.
# Архив объектов проверяется до записи: только обычные файлы с 32-hex именами, без ссылок и путей.
# Использование: ./scripts/restore-db.sh <копия базы.dump> <адрес пустой базы> [<архив файлов> <пустая папка файлов>]
set -euo pipefail
umask 077
dump="${1:?укажите файл копии базы}"
target="${2:?укажите адрес пустой базы}"
files_archive="${3:-}"
files_target="${4:-}"
files_stage=""

cleanup() {
  if [ -n "$files_stage" ] && [ -d "$files_stage" ]; then
    rm -rf -- "$files_stage"
  fi
}
trap cleanup EXIT

check_sum() {
  local file="$1" label="$2"
  [ -f "$file" ] || { echo "нет файла: $file" >&2; exit 1; }
  [ -f "$file.sha256" ] || { echo "нет контрольной суммы: $file.sha256" >&2; exit 1; }
  (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256" > /dev/null) \
    || { echo "контрольная сумма не совпала: $label повреждён, восстановление остановлено" >&2; exit 1; }
}

validate_files_archive() {
  local archive="$1"
  # Архив object store должен содержать только ./ и ./<32 lowercase hex>.
  # Запрещаем каталоги, абсолютные/относительные пути, symlink, hardlink и спецфайлы.
  tar -tvzf "$archive" | awk '
    {
      mode = substr($1, 1, 1);
      name = $NF;
      if (name == "." || name == "./") {
        if (mode != "d") exit 1;
        next;
      }
      if (mode != "-" || substr(name, 1, 2) != "./") exit 1;
      key = substr(name, 3);
      if (length(key) != 32 || key !~ /^[0-9a-f]+$/) exit 1;
    }
  ' || { echo "архив файлов содержит недопустимые записи" >&2; exit 1; }
}

check_sum "$dump" "копия базы"
if [ -n "$files_archive" ]; then
  [ -n "$files_target" ] || { echo "укажите пустую папку для файлов" >&2; exit 1; }
  check_sum "$files_archive" "архив файлов"
  validate_files_archive "$files_archive"
  if [ -e "$files_target" ] && { [ ! -d "$files_target" ] || [ -n "$(ls -A "$files_target" 2>/dev/null)" ]; }; then
    echo "путь для файлов должен отсутствовать или указывать на пустую папку" >&2
    exit 1
  fi
  files_parent="$(dirname "$files_target")"
  mkdir -p "$files_parent"
  files_stage="$(mktemp -d "$files_parent/.inone-restore.XXXXXX")"
  tar --no-same-owner --no-same-permissions -C "$files_stage" -xzf "$files_archive"
  if [ -d "$files_target" ]; then rmdir "$files_target"; fi
fi

tables="$(psql "$target" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');")"
[ "$tables" = "0" ] || { echo "цель не пустая ($tables таблиц): восстановление остановлено" >&2; exit 1; }

pg_restore --single-transaction --no-owner --no-acl --exit-on-error --dbname="$target" "$dump"
echo "восстановлено: $target"

if [ -n "$files_archive" ]; then
  mv "$files_stage" "$files_target"
  files_stage=""
  echo "файлы восстановлены: $files_target"
fi
