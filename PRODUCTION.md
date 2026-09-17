# Production-развёртывание

## 1. Настройка

```bash
cp .env.example .env
```

Создайте сильные значения минимум для:

```env
INTERNAL_SERVICE_SECRET=
POSTGRES_PASSWORD=
MINIO_ROOT_PASSWORD=
GRAFANA_PASSWORD=
TURN_CREDENTIAL=
```

Для Web Push добавьте VAPID-ключи.

## 2. Запуск

```bash
docker compose up --build -d
```

## 3. TLS

Встроенный Nginx рассчитан на локальный HTTP. Для публичного развёртывания используйте внешний load balancer/CDN или добавьте сертификаты в Nginx. Клиент должен работать только по HTTPS/WSS.

## 4. Backup

```bash
npm run backup
```

В Docker необходимо отдельно резервировать PostgreSQL, bucket MinIO и volume с `message-keys.json`. Копия одной базы без ключей недостаточна.

## 5. Наблюдаемость

- Core: `/metrics`;
- Realtime: `:3002/metrics`;
- Prometheus: `:9090`;
- Grafana: `:3000`.

Настройте алерты на недоступность сервисов, рост outbox/offline queue, ошибки расшифровки, latency PostgreSQL и заполнение дисков.


## 6. Code Runner

Code Runner запускается отдельным сервисом `runner` без Docker-сети. Core взаимодействует с ним через volume `runner-socket`. Не публикуйте порт runner и не добавляйте его в общую сеть.

Проверьте состояние через Core:

```bash
curl http://localhost/api/code/status
```

Для публичной площадки с недоверенным кодом рекомендуется вынести runner на отдельный worker-узел или microVM-кластер, а не размещать его рядом с базой и ключами.


## Game Server

Compose поднимает отдельный сервис `games` на внутреннем порту `3004`. Nginx направляет `/game-api/` на этот сервис. Для изоляции состояния задайте `GAME_DATABASE_URL`; сервис не должен получать ключи шифрования сообщений или доступ к хранилищу вложений. Метрики доступны Prometheus по `games:3004/metrics`.
