const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;
let dbEnabled = false;
const SESSION_ID = 'default';

if (process.env.DATABASE_URL) {
  dbEnabled = true;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  console.log('Database URL detected. PostgreSQL backend initialized.');
} else {
  console.log('No DATABASE_URL found. Falling back to local JSON files.');
}

async function initDB(fallbackData = {}) {
  if (!dbEnabled) return;
  
  console.log('Initializing database tables...');
  
  const client = await pool.connect();
  try {
    // Create WhatsApp sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        session_id VARCHAR(255),
        key VARCHAR(255),
        value TEXT,
        PRIMARY KEY (session_id, key)
      )
    `);

    // Create Application state table
    await client.query(`
      CREATE TABLE IF NOT EXISTS application_state (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT
      )
    `);
    
    // Seed initial data if tables are empty
    // Config
    const configRes = await client.query('SELECT value FROM application_state WHERE key = $1', ['config']);
    if (configRes.rows.length === 0 && fallbackData.config) {
      console.log('Seeding initial config into database...');
      await client.query('INSERT INTO application_state (key, value) VALUES ($1, $2)', ['config', JSON.stringify(fallbackData.config)]);
    }

    // Customers
    const customersRes = await client.query('SELECT value FROM application_state WHERE key = $1', ['customers']);
    if (customersRes.rows.length === 0 && fallbackData.customers) {
      console.log('Seeding initial customers into database...');
      await client.query('INSERT INTO application_state (key, value) VALUES ($1, $2)', ['customers', JSON.stringify(fallbackData.customers)]);
    }

    // Price History
    const historyRes = await client.query('SELECT value FROM application_state WHERE key = $1', ['price_history']);
    if (historyRes.rows.length === 0 && fallbackData.priceHistory) {
      console.log('Seeding initial price history into database...');
      await client.query('INSERT INTO application_state (key, value) VALUES ($1, $2)', ['price_history', JSON.stringify(fallbackData.priceHistory)]);
    }

    console.log('Database initialization completed successfully.');
  } catch (err) {
    console.error('Failed to initialize database:', err);
    dbEnabled = false; // Disable DB if connection or creation failed
  } finally {
    client.release();
  }
}

// Database helper functions for settings/JSONs
async function readConfigDB() {
  if (!dbEnabled) return null;
  try {
    const res = await pool.query('SELECT value FROM application_state WHERE key = $1', ['config']);
    if (res.rows.length > 0) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (err) {
    console.error('Error reading config from DB:', err);
  }
  return null;
}

async function writeConfigDB(config) {
  if (!dbEnabled) return false;
  try {
    await pool.query(
      'INSERT INTO application_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      ['config', JSON.stringify(config)]
    );
    return true;
  } catch (err) {
    console.error('Error writing config to DB:', err);
    return false;
  }
}

async function readCustomersDB() {
  if (!dbEnabled) return null;
  try {
    const res = await pool.query('SELECT value FROM application_state WHERE key = $1', ['customers']);
    if (res.rows.length > 0) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (err) {
    console.error('Error reading customers from DB:', err);
  }
  return null;
}

async function writeCustomersDB(customers) {
  if (!dbEnabled) return false;
  try {
    await pool.query(
      'INSERT INTO application_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      ['customers', JSON.stringify(customers)]
    );
    return true;
  } catch (err) {
    console.error('Error writing customers to DB:', err);
    return false;
  }
}

async function readPriceHistoryDB() {
  if (!dbEnabled) return null;
  try {
    const res = await pool.query('SELECT value FROM application_state WHERE key = $1', ['price_history']);
    if (res.rows.length > 0) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (err) {
    console.error('Error reading price history from DB:', err);
  }
  return null;
}

async function writePriceHistoryDB(history) {
  if (!dbEnabled) return false;
  try {
    await pool.query(
      'INSERT INTO application_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      ['price_history', JSON.stringify(history)]
    );
    return true;
  } catch (err) {
    console.error('Error writing price history to DB:', err);
    return false;
  }
}

// Custom Baileys authentication state provider
async function usePostgresAuthState(sessionId) {
  const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');

  const writeData = async (data, key) => {
    const text = JSON.stringify(data, BufferJSON.replacer);
    await pool.query(
      `INSERT INTO whatsapp_sessions (session_id, key, value) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (session_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [sessionId, key, text]
    );
  };

  const readData = async (key) => {
    try {
      const res = await pool.query(
        `SELECT value FROM whatsapp_sessions WHERE session_id = $1 AND key = $2`,
        [sessionId, key]
      );
      if (res.rows.length === 0) return null;
      return JSON.parse(res.rows[0].value, BufferJSON.reviver);
    } catch (error) {
      console.error(`Error reading key ${key} from DB:`, error);
      return null;
    }
  };

  const removeData = async (key) => {
    try {
      await pool.query(
        `DELETE FROM whatsapp_sessions WHERE session_id = $1 AND key = $2`,
        [sessionId, key]
      );
    } catch (error) {
      console.error(`Error deleting key ${key} from DB:`, error);
    }
  };

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(value, key) : removeData(key));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData(creds, 'creds')
  };
}

module.exports = {
  isDbEnabled: () => dbEnabled,
  initDB,
  readConfigDB,
  writeConfigDB,
  readCustomersDB,
  writeCustomersDB,
  readPriceHistoryDB,
  writePriceHistoryDB,
  usePostgresAuthState,
  SESSION_ID
};
