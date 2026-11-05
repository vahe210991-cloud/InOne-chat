# Публикация движка в репозиторий InOne-Chat

Ветка `engine/0.6.0-alpha.38` создаётся отдельно от `main`. История `main` не переписывается, принудительного push нет.

1. Получите bundle `inone-engine-0.6.0-alpha.38.bundle` (лежит рядом с этим файлом в выдаче).
2. Проверьте содержимое: `git bundle verify inone-engine-0.6.0-alpha.38.bundle`.
3. Загрузите ветку в свой клон репозитория:
   `git fetch inone-engine-0.6.0-alpha.38.bundle engine/0.6.0-alpha.38:engine/0.6.0-alpha.38`
4. Отправьте ветку на GitHub (нужен доступ на запись к InOne-Chat):
   `git push origin engine/0.6.0-alpha.38`
5. Не переписывайте `main`. В `main` сейчас README мобильного моста и дубли файлов в корне; их убирают отдельным решением владельца.
