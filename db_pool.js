const mysql = require('mysql');
const logger = require('./logger_config');
const dotenv = require('dotenv');
dotenv.config();

// Database configuration
const db_config = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 10, // Maximum number of connections in the pool
};

// Create a connection pool
const pool = mysql.createPool(db_config);

function handleDisconnect() {
  pool.on('acquire', (connection) => {
    logger.info(`Connection ${connection.threadId} acquired`);
  });

  pool.on('release', (connection) => {
    logger.info(`Connection ${connection.threadId} released`);
  });

  pool.on('error', (err) => {
    logger.error('Database error:', err.code);

    // If the error is recoverable, reconnect
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      logger.warn('Recreating the connection pool due to lost connection...');
      pool.end(() => {
        pool = mysql.createPool(db_config); // Recreate the pool
        handleDisconnect();
      });
    } else {
      throw err; // Unexpected errors should still be thrown
    }
  });
}

// Initialize the pool and error handling
handleDisconnect();

// Function to query the database
function query(sql, params) {
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (error, results) => {
      if (error) {
        logger.error('Query error:', error);
        return reject(error);
      }
      resolve(results);
    });
  });
}

module.exports = { query, pool };
