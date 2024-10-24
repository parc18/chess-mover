const { DataTypes } = require('sequelize');
const sequelize = require('./database');
module.exports = (sequelize, DataTypes) => {
  const Match = sequelize.define('Match', {
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
    maxScore: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    teamId1: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    teamId2: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    score1: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    score2: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    amortizeScore1: {
      type: DataTypes.DOUBLE,
      allowNull: true,
    },
    amortizeScore2: {
      type: DataTypes.DOUBLE,
      allowNull: true,
    },
    matchStartTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    matchEndTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    eventId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    winner: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    winDesc: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  }, {
    tableName: 'matches',
    timestamps: true, // Automatically add `createdAt` and `updatedAt` fields
  });

  return Match;
};
