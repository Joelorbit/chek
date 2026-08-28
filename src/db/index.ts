import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import logger from '../utils/logger';
import dotenv from 'dotenv';
dotenv.config();

const connectionUri = process.env.DATABASE_URL || 'mysql://root:password@localhost:3306/chek_db';

export const pool = mysql.createPool({
  uri: connectionUri,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 0,
});

export const db = drizzle(pool, { schema, mode: 'default' });

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info('Connected to MySQL via Drizzle ORM successfully.');
    return true;
  } catch (error) {
    logger.warn('MySQL connection ping failed, continuing in fallback mode:', error);
    return false;
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  try {
    await pool.end();
    logger.info('Closed MySQL pool connection.');
  } catch (error) {
    logger.error('Error closing MySQL pool:', error);
  }
}
