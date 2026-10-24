/**
 * store.ts — MemoryStore factory.
 *
 * Prefers IndexedDB (durable across restarts, same-origin, no native code)
 * and falls back to an in-memory driver when storage is blocked. The active
 * driver is reported via `store.driver` so the UI can show an accurate
 * persistence status instead of pretending.
 */

import { IndexedDBMemoryStore } from "./indexeddb";
import { InMemoryMemoryStore } from "./inmemory";
import { isIndexedDBAvailable } from "./indexeddb";
import type { MemoryStore } from "../runtime/boundaries";

let singleton: MemoryStore | null = null;

export function createMemoryStore(): MemoryStore {
  if (singleton) return singleton;
  singleton = isIndexedDBAvailable() ? new IndexedDBMemoryStore() : new InMemoryMemoryStore();
  return singleton;
}

export function resetMemoryStoreForTesting(): void {
  singleton = null;
}
