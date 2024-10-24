// database.js
const { Sequelize } = require('sequelize');

// Initialize Sequelize with your database configuration
const sequelize = new Sequelize('database_name', 'username', 'password', {
    host: 'localhost', // Your database host
    dialect: 'mysql',  // Your database dialect (e.g., mysql, postgres, sqlite, etc.)
});

// Test the connection (optional)
const testConnection = async () => {
    try {
        await sequelize.authenticate();
        console.log('Connection has been established successfully.');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
};

testConnection();

module.exports = sequelize; // Export the sequelize instance
