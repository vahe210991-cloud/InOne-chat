#!/usr/bin/env bash
# Резервная копия: база PostgreSQL и (если задана FILES_DIR) папка файлов. Для каждого вида — контрольная сумма
# рядом и хранение последних N копий. Использование:
#   DATABASE_URL=... [FILES_DIR=/var/lib/inone/objects] BACKUP_DIR=/var/backups/inone BACKUP_KEEP=14 ./scripts/backup-db.sh
# Печатает путь к копии базы и, если снят архив файлов, путь к нему.
set -euo pipefail
: "${DATABASE_URL:?задайте DATABASE_URL}"
dir="${BACKUP_DIR:-./backups}"
keep="${BACKUP_KEEP:-14}"
mkdir -p "$dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
name="inone-$stamp.dump"
file="$dir/$name"
pg_dump --format=custom --no-owner --no-acl --file="$file" "$DATABASE_URL"
(cd "$dir" && sha256sum "$name" > "$name.sha256")
echo "$file"
if [ -n "${FILES_DIR:-}" ]; then
  fname="inone-files-$stamp.tar.gz"
  ffile="$dir/$fname"
  tar -C "$FILES_DIR" -czf "$ffile" .
  (cd "$dir" && sha256sum "$fname" > "$fname.sha256")
  echo "$ffile"
fi
# Хранение: оставляем последние $keep копий каждого вида по времени изменения, остальные удаляем вместе с суммами.
for pattern in 'inone-*.dump' 'inone-files-*.tar.gz'; do
  (ls -1t "$dir"/$pattern 2>/dev/null || true) | tail -n +"$((keep + 1))" | while read -r old; do
    rm -f "$old" "$old.sha256"
  done
done
