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
backup=""

cleanup() {
  if [ -n "$staging" ] && [ -d "$staging" ]; then
    rm -rf -- "$staging"
  fi
  # Если переключение каталогов оборвалось, возвращаем прежний пустой каталог.
  if [ -n "$backup" ] && [ -d "$backup" ]; then
    if [ ! -e "$files_target" ]; then
      mv -- "$backup" "$files_target" || true
    else
      rm -rf -- "$backup"
    fi
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
  parent="$(dirname "$files_target")"
  base="$(basename "$files_target")"
  mkdir -p "$parent"
  staging="$(mktemp -d "$parent/.${base}.restore.XXXXXX")"
  tar --no-same-owner --no-same-permissions -C "$staging" -xzf "$files_archive"
fi

pg_restore --no-owner --no-acl --exit-on-error --dbname="$target" "$dump"
echo "восстановлено: $target"

if [ -n "$files_archive" ]; then
  if [ -d "$files_target" ]; then
    backup="$(mktemp -d "$parent/.${base}.previous.XXXXXX")"
    rmdir "$backup"
    mv -- "$files_target" "$backup"
  fi
  if ! mv -- "$staging" "$files_target"; then
    if [ -n "$backup" ] && [ -d "$backup" ] && [ ! -e "$files_target" ]; then
      mv -- "$backup" "$files_target"
      backup=""
    fi
    echo "не удалось переключить каталог восстановленных файлов" >&2
    exit 1
  fi
  staging=""
  if [ -n "$backup" ] && [ -d "$backup" ]; then
    rmdir "$backup"
    backup=""
  fi
  echo "файлы восстановлены: $files_target"
fi
