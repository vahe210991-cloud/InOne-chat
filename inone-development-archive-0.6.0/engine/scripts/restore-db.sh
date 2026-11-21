#!/usr/bin/env bash
# Восстановление из копии в ПУСТУЮ базу и (если задан архив файлов) в ПУСТУЮ папку файлов.
# Архив сначала проверяется и распаковывается в staging; файлы публикуются до атомарного pg_restore.
# Использование: ./scripts/restore-db.sh <копия базы.dump> <адрес пустой базы> [<архив файлов> <пустая папка файлов>]
set -euo pipefail
dump="${1:?укажите файл копии базы}"
target="${2:?укажите адрес пустой базы}"
files_archive="${3:-}"
files_target="${4:-}"
staging=""
moved_entries=()

cleanup() {
  # При любой ошибке до завершения восстановления удаляем только файлы,
  # опубликованные этим запуском; посторонние файлы в FILES_DIR не трогаем.
  for moved in "${moved_entries[@]}"; do
    rm -rf -- "$moved" || true
  done
  if [ -n "$staging" ] && [ -d "$staging" ]; then
    rm -rf -- "$staging"
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
  local archive="$1" entry normalized type
  tar -tzf "$archive" > /dev/null || {
    echo "архив файлов некорректен или повреждён: восстановление остановлено" >&2
    return 1
  }
  while IFS= read -r entry; do
    normalized="$entry"
    while [[ "$normalized" == ./* ]]; do normalized="${normalized#./}"; done
    case "$normalized" in
      /*|..|../*|*/../*|*/..|[A-Za-z]:/*)
        echo "небезопасный путь в архиве файлов: восстановление остановлено" >&2
        return 1
        ;;
    esac
  done < <(tar -tzf "$archive")
  # Разрешаем только обычные файлы и каталоги: никаких symlink/hardlink/FIFO/device.
  while IFS= read -r entry; do
    type="${entry:0:1}"
    case "$type" in
      -|d) ;;
      *)
        echo "архив файлов содержит ссылки или специальные файлы: восстановление остановлено" >&2
        return 1
        ;;
    esac
  done < <(tar -tvzf "$archive")
}

check_sum "$dump" "копия базы"
if [ -n "$files_archive" ]; then
  [ -n "$files_target" ] || { echo "укажите пустую папку для файлов" >&2; exit 1; }
  check_sum "$files_archive" "архив файлов"
  validate_files_archive "$files_archive"
  if [ -L "$files_target" ]; then
    echo "папка для файлов не должна быть символической ссылкой" >&2
    exit 1
  fi
  if [ -e "$files_target" ] && [ ! -d "$files_target" ]; then
    echo "назначение файлов не является папкой: восстановление остановлено" >&2
    exit 1
  fi
  if [ -d "$files_target" ] && [ -n "$(ls -A "$files_target" 2>/dev/null)" ]; then
    echo "папка для файлов не пустая: восстановление остановлено" >&2
    exit 1
  fi
fi

tables="$(psql "$target" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');")"
[ "$tables" = "0" ] || { echo "цель не пустая ($tables таблиц): восстановление остановлено" >&2; exit 1; }

# Полностью распаковываем и проверяем дерево до публикации файлов и изменения БД.
if [ -n "$files_archive" ]; then
  # FILES_DIR может быть корнем Docker volume/mountpoint: сам каталог не переименовываем.
  mkdir -p "$files_target"
  staging="$(mktemp -d "$files_target/.inone-restore.XXXXXX")"
  tar --no-same-owner --no-same-permissions -C "$staging" -xzf "$files_archive"
  shopt -s dotglob nullglob
  staged_entries=("$staging"/*)
  for entry in "${staged_entries[@]}"; do
    if ! mv -- "$entry" "$files_target/"; then
      echo "не удалось опубликовать восстановленные файлы; выполнен откат файлов" >&2
      exit 1
    fi
    moved_entries+=("$files_target/${entry##*/}")
  done
fi

# Одна транзакция: при ошибке PostgreSQL откатывает все изменения БД,
# а EXIT cleanup удаляет опубликованные этим запуском файлы.
pg_restore --single-transaction --no-owner --no-acl --exit-on-error --dbname="$target" "$dump"
# DB commit point: after this succeeds, cleanup must never remove published files.
moved_entries=()
echo "восстановлено: $target"

if [ -n "$files_archive" ]; then
  rm -rf -- "$staging"
  staging=""
  echo "файлы восстановлены: $files_target"
fi
