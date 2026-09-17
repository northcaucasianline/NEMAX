# Состав реализации

## Core API

- логин/пароль, `scrypt`, access/refresh rotation, TOTP и отзыв сессий;
- PostgreSQL/file state drivers;
- S3/MinIO/local object storage;
- AES-256-GCM и отдельный клиентский secret-mode payload;
- чаты, группы, каналы, роли, модерация и расширенная платформа;
- persistent realtime outbox;
- REST, media authorization, Bot API и Prometheus metrics.

## Realtime / Worker

- WebSocket, heartbeat и presence;
- Redis/memory offline queue;
- typing/recording и WebRTC signaling;
- закрытие соединений после отзыва сессии;
- запуск запланированных сообщений, auto-delete и cleanup;
- команда пятиминутной ротации ключа в Core.

## Frontend

- React/Vite PWA;
- автоматическое обновление access-токена;
- cursor sync и reconnect;
- сообщения, файлы, реакции, ответы, опросы и звонки;
- настройки безопасности, business и bots;
- service worker и Web Push.

## Production-контур

Docker Compose включает PostgreSQL, Redis, MinIO, Core, Realtime, Coturn, Nginx, Prometheus и Grafana. Все драйверы имеют локальный fallback, чтобы проект можно было открыть без инфраструктуры.
