import { db } from 'hub:db'
import type { drizzle } from 'drizzle-orm/libsql'
import type * as appSchema from '../db/schema'

export type Db = ReturnType<typeof drizzle<typeof appSchema>>

/**
 * Drizzle client from NuxtHub's `hub:db` virtual module — local SQLite file in
 * dev, Turso (libsql) in production on Vercel. Cast to our schema type so
 * query-building stays fully typed.
 */
export function useDb(): Db {
  return db as Db
}
