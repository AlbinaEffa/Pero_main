import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function enableVector() {
  try {
    console.log('Enabling vector extension...');
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('Vector extension enabled successfully!');
  } catch (err) {
    console.error('Error enabling vector extension:', err);
  } finally {
    pool.end();
  }
}

enableVector();
