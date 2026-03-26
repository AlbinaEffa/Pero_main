/**
 * Shared database pool and Drizzle ORM instance.
 * Import `pool` and/or `db` here instead of creating new pools in every route.
 * One pool per process — avoids hitting PG's connection limit under load.
 */

// dotenv must be configured before the Pool is created so DATABASE_URL is available.
// ES-module imports are hoisted, so dotenv.config() cannot be placed in index.ts or
// auth.ts and reliably run first — loading it here guarantees it runs when client.ts
// body executes, which is always before new Pool() below.
import dotenv from 'dotenv';
dotenv.config();

import pkg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected idle-client error:', err.message);
});

export const db = drizzle(pool, { schema });
