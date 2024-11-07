const { DataTypes } = require('sequelize');
const sequelize = require('./database');
module.exports = (sequelize, DataTypes) => {
  const Move = sequelize.define('Move', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userName1: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    userName2: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    pgn: {
      type: DataTypes.TEXT, // For large text storage (Lob equivalent)
      allowNull: true,
    },
    eventId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    matchId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    challengeId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    fen: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    target: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    minuteLeft: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    time: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    remainingMillis: {
      type: DataTypes.BIGINT, // Using BIGINT for long integers
      allowNull: true,
    },
    currentTimeStampInMillis: {
      type: DataTypes.DATE, // DATE type for timestamps
      allowNull: true,
    },
  }, {
    tableName: 'move',
    timestamps: true, // Automatically adds createdAt and updatedAt fields
  });

  return Move;
};
