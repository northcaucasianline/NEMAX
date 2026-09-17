import { createStateStore } from "./state-store.js";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaults = () => ({ users: [], sessions: [], chats: [], messages: [], meta: { sequence: 0 } });
const store = await createStateStore({ file: join(root, "server/data/db.json"), defaults });
const state = await store.load(); await store.save(state); console.log("Миграция хранилища завершена:", await store.health()); await store.close();
