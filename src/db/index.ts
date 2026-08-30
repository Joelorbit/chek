import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const rawUrl = process.env.DATABASE_URL;
// If DATABASE_URL is missing or contains placeholder brackets like [PROJECT-REF], fallback to dummy local connection string for safe module loading / testing
const connectionString =
  !rawUrl || rawUrl.includes('[') || rawUrl.includes(']')
    ? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
    : rawUrl;

// Supabase uses Transaction Pool mode → must disable prepared statements. Fast timeout for instant offline fallback.
const client = postgres(connectionString, { prepare: false, connect_timeout: 1, max: 10 });

export const db = drizzle(client, { schema });

export async function checkDatabaseConnection() {
  try {
    await client`SELECT 1`;
    return true;
  } catch (err) {
    console.error(`[DB] connection failed: ${(err as Error).message}`);
    return false;
  }
}

export async function closeDatabaseConnection() {
  await client.end({ timeout: 5 });
}
