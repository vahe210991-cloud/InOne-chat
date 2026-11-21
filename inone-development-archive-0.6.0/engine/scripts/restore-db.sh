#!/usr/bin/env bash
# Восстановление из копии в ПУСТУЮ базу и (если задан архив файлов) в ПУСТУЮ папку файлов.
# Проверки дампов/архивов проходят до записи; файлы распаковываются во временный каталог.
# Использование: ./scripts/restore-db.sh <копия базы.dump> <адрес пустой базы> [<архив файлов> <пустая папка файлов>]
set -euo pipefail
dump="${1:?укажите файл копии базы}"
target="${2:?укажите адрес пустой базы}"
files_archive="${3:-}"
files_target="${4:-}"
staging=""

cleanup() {
  if [ -n "$staging" ] && [ -d "$staging" ]; then
    # При ошибке переносов возвращаем уже перемещённые элементы в staging.
    shopt -s dotglob nullglob
    for moved in "$files_target"/*; do
      if [ "$moved" != "$staging" ]; then mv -- "$moved" "$staging/" || true; fi
    done
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
  # Полный проход gzip/tar до любых изменений БД или файлового каталога.
  tar -tzf "$archive" > /dev/null || {
    echo "архив файлов некорректен или повреждён: восстановление остановлено" >&2
    return 1
  }
  # Не допускаем абсолютные пути и компоненты '..' (включая ./../ и повторные ./).
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
  # Символические/жёсткие ссылки и специальные файлы могут перенаправить запись за staging.
  # Разрешаем только обычные файлы и каталоги.
  while IFS= read -r entry; do
    type="${entry:0:1}"
    case "$type" in
      -|d) ;;
      *)
        echo "архив файлов содержит ссылки или специальные файлы: восстановление остановлено" >&2
        return 1
        ;;
    esac
  done < <(tar -tvzf "$archive" --quoting-style=c)
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

# Подготавливаем и полностью проверяем файловое дерево до записи в PostgreSQL.
if [ -n "$files_archive" ]; then
  # FILES_DIR может быть корнем Docker volume/mountpoint: сам каталог не переименовываем.
  # staging создаётся внутри назначения, перенос элементов остаётся в пределах той же FS.
  mkdir -p "$files_target"
  staging="$(mktemp -d "$files_target/.inone-restore.XXXXXX")"
  tar --no-same-owner --no-same-permissions -C "$staging" -xzf "$files_archive"
fi

pg_restore --no-owner --no-acl --exit-on-error --dbname="$target" "$dump"
echo "восстановлено: $target"

if [ -n "$files_archive" ]; then
  shopt -s dotglob nullglob
  staged_entries=("$staging"/*)
  for entry in "${staged_entries[@]}"; do
    if ! mv -- "$entry" "$files_target/"; then
      echo "не удалось переместить восстановленные файлы; выполняется откат" >&2
      exit 1
    fi
  done
  rmdir "$staging"
  staging=""
  echo "файлы восстановлены: $files_target"
fi
