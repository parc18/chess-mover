// database.js
const { Sequelize } = require('sequelize');
//const sequelize= null;
// Initialize Sequelize with your database configuration
const sequelize = new Sequelize('c47wfg96agk0rjr7', 'zbfqsjvz5tc7tw6w', 'erao2uf5u1ergafr', {
    host: 'rwahxxknm9kwy6c.cbetxkdyhwsb.us-east-1.rds.amazonaws.com', // Your database host
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

//testConnection();

module.exports = sequelize; // Export the sequelize instance
