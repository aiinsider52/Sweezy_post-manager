import { config } from "../config.js";
import { PostgresStore } from "./postgres-store.js";
import { SqliteStore } from "./sqlite-store.js";
import type { Store } from "./store.js";

export function createStore(): Store {
  return config.DATABASE_URL ? new PostgresStore(config.DATABASE_URL) : new SqliteStore(config.SQLITE_PATH);
}
