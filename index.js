const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mysql = require('mysql');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const {
    Chess
} = require('chess.js')
const base64 = require('base64url');
const winston = require('winston');
const cors = require('cors');
// const Match = require('./model/Match');
// const move = require('./model/move');
const { acquireLock, releaseLock, waitForLock } = require('./lockManager'); // Import the lock functions
const lock = {};
var position = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
var MATCH_DURATION_IN_MINUTES = 6;
const ONE_THOUSAND = 1000;
const MINUTE_TO_SECONDS_MULTIPLYER_60 = 60;
const CONCLUDED_STATUS = 'CONCLUDED';
const NO_SHOW_STATUS = 'NO_SHOW';
const BLACK_EMPTY_MOVE_FOR_NO_SHOW = 'EMPTY_MOVE';
let REMAINING_TIME_WHITE_IN_SECONDS = (MATCH_DURATION_IN_MINUTES * 60) / 2;
let REMAINING_TIME_BLACK_IN_SECONDS = (MATCH_DURATION_IN_MINUTES * 60) / 2;
const RUNNING = 'RUNNING';
const timesUpsDeltaCheck = 0;
const DONE = 'DONE';
const UTC_ADD_UP = 19800000;


//############################################################################################
//########################### LOGGER  STARTS #################################################

const {
    format,
    transports
} = winston
const path = require('path')
const ONE = 1;
const logFormat = format.printf(info => `${info.timestamp} ${info.level} [${info.label}]: ${info.message}`)

const logger = require('./logger_config');

//############################################################################################
//########################### LOGGER  ENDS #################################################


// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(cors({
  origin: ['https://32chess.com', 'https://www.32chess.com'],
  methods: 'GET',
  credentials: true,
}));
const server = http.createServer(app);
const io = socketIO(server);

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

var connection;
// Database configuration
const db_config = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 40, // Maximum number of connections in the pool
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


// Middleware function to validate JWT token
const authenticateToken = (token) => {
    try {
        logger.debug(`authetication started of jwt token ${token}`, token);
        const decoded = jwt.verify(token, "javainuse", {
            algorithms: ['HS256'],
            encoding: 'utf-8'
        });
        return decoded;
    } catch (error) {
        logger.error(`JWT Token validation error with ${error} returning null`, error);
        return null;
    }
};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});





// Route handler using the refactored function
app.get('/match/:id', verifyJWT, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const userName = req.user;

    try {
        const response = await fetchMatchDetails(id, userName);
        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'An error occurred while retrieving the match',
            error: error.message,
        });
    }
});

async function fetchMatchDetails1(id, userName) { 
await fetchMatchDetails(id, userName);
}

// Refactored function to handle the main logic of fetching a match by ID and username
async function fetchMatchDetails(id, userName) {
    let match = null;
    let latestMove1 = null;

    try {
        // Acquire the lock
        let isLockAcquired = await acquireLock(id);
        if (!isLockAcquired) {
            logger.info('lock wait for ' + userName)
            await waitForLock(id); // Wait for the lock to be released
            isLockAcquired = await acquireLock(id); // Try to acquire the lock again after waiting
        }

        logger.info('match id for user ' + userName +"match id"+ id);
        logger.info("lock acquireLock " + isLockAcquired)

        if (id < 1) {
            return {
                code: 200,
                result: "SUCCESS!!",
                response: {
                    match: null,
                    move: null,
                }
            };
        }

        // Fetch match details
        match = await getMatchById(id);
        if (!match) throw new Error('Match not found');

        // Set color based on userName comparison
        match.color = match.user_1.toLowerCase() === userName.toLowerCase() ? 'white' : 'black';

        // Fetch latest moves
        latestMove1 = await getLastTwoMovesByMatchId(id);

        // Fetch the latest move and calculate the minutes left
        const latestMove = await getLatestMove(id, userName, match, latestMove1);
        releaseLock(id);
        // Set up the response structure
        return {
            code: 200,
            result: "SUCCESS!!",
            response: {
                match: {
                    id: match.id,
                    userName1: match.user_1,
                    userName2: match.user_2,
                    status: match.status,
                    eventId: match.eventId,
                    color: match.color,
                    minuteLeft: latestMove ? latestMove.minuteLeft : MATCH_DURATION_IN_MINUTES / 2,
                    minuteLeft2: latestMove ? latestMove.minuteLeft2 : MATCH_DURATION_IN_MINUTES / 2,
                },
                move: latestMove,
            }
        };
    } finally {
        // Release the lock after processing is complete
        releaseLock(id);
    }
}




function queryDatabase(sqlQuery, values) {
  return new Promise((resolve, reject) => {
    connection.query(sqlQuery, values, (error, results) => {
      if (error) {
        return reject(error);
      }
      resolve(results);
    });
  });
}

async function getMatchById(matchId) {
  try {
    const sqlQuery = 'SELECT * FROM matches WHERE id = ?';
    const results = await queryDatabase(sqlQuery, [matchId]);
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error('Error executing query:', error);
    throw error; // re-throw the error to handle it outside
  } //finally {
    //connection.end(); // Close the connection when done
  //}
}

function verifyJWT(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization header missing or malformed' });
    }

    const token = authHeader.split(' ')[1];
    const jwtParts = token.split('.');
    //const headerInBase64UrlFormat = jwtParts[0];
    payloadInBase64UrlFormat = jwtParts[1];
    logger.info('hell yeah  '+payloadInBase64UrlFormat)
    // const signatureInBase64UrlFormat = jwtParts[2];
    var userName1Obj = JSON.parse(base64.decode(payloadInBase64UrlFormat));

    //logger.info('hell yeah 2 '+JSON.parse(base64.decode(payloadInBase64UrlFormat)))


    
    
    jwt.verify(token, "javainuse", {
        algorithms: ['HS256'],
        encoding: 'utf-8'
    }, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
         logger.info("JWT USER ", JSON.stringify(userName1Obj));
             logger.info('hell yeah  3 '+userName1Obj.sub)

        req.user = userName1Obj.sub; // attach the decoded user information to the request object
        next();
    });
}

async function getLatestMove(id, userName, match, moves) {
  let shouldRunGameOverCheck = false;
  if (userName && (userName.toLowerCase() === match.user_1.toLowerCase() || userName.toLowerCase() === match.user_2.toLowerCase())) {
    shouldRunGameOverCheck = true;
  }

  if(match.winner_user_name_id != 'null' && match.winner_user_name_id != null) {
    shouldRunGameOverCheck = false
  }
  if (moves.length === 0) return null;

  let lastMove = moves[0];
  let secondLastMove = moves.length > 1 ? moves[1] : null;

  // If the move status is DONE or specific no-show cases
  if (lastMove.status === BLACK_EMPTY_MOVE_FOR_NO_SHOW) {
    logger.info("BLACK_EMPTY_MOVE_FOR_NO_SHOW RUNNING..!! " + lastMove.userName1);
    handleNoShowCase(lastMove, userName, shouldRunGameOverCheck, secondLastMove);
    return lastMove;
  }

  // Handle case for running moves and conclusion checks
  handleRunningMove(lastMove, userName, secondLastMove, shouldRunGameOverCheck, match);

  // if (shouldRunGameOverCheck) {
  //   await isGameOver(lastMove, secondLastMove, lastMove.userName1);
  // }

  return lastMove;
}

async function getLastTwoMovesByMatchId(matchId) {
  const sqlQuery = `
    SELECT * FROM move
    WHERE matchId = ?
    ORDER BY id DESC
    LIMIT 2;
  `;
  
  try {
    const results = await queryDatabase(sqlQuery, [matchId]);
    return results;
  } catch (error) {
    console.error('Error executing query:', error);
    throw error;
  }
}

function handleNoShowCase(lastMove, userName, shouldRunGameOverCheck, secondLastMove) {
  if (lastMove.userName1.toLowerCase() === userName.toLowerCase()) {
    lastMove.minuteLeft = REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND;
    lastMove.minuteLeft2 = getAdjustedTime(lastMove, null);
  } else {
    lastMove.minuteLeft2 = REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND;
    lastMove.minuteLeft = getAdjustedTime(lastMove, null);
  }

  if ((lastMove.minuteLeft2 <= timesUpsDeltaCheck || lastMove.minuteLeft <= timesUpsDeltaCheck || lastMove.pgn.endsWith('#'))  &&  shouldRunGameOverCheck) {
        isGameOver(lastMove, secondLastMove);
  }
}
function isNullOrUndefinedOrEmpty(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') || // empty string
    (Array.isArray(value) && value.length === 0) ||       // empty array
    (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) // empty object
  );
}
function handleRunningMove(lastMove, userName, secondLastMove, shouldRunGameOverCheck, match) {
    logger.info("handleRunningMove CASE RUNNING..!! " + lastMove.userName1);

    if(match.winner_user_name_id != null && match.winner_user_name_id != 'null') {
        logger.info("handleRunningMove winner got RUNNING..!! " + match.winner_user_name_id);
        if(isNullOrUndefinedOrEmpty(secondLastMove)){
              if (lastMove.userName1.toLowerCase() === userName.toLowerCase()) {
                lastMove.minuteLeft2 = 0;
                lastMove.minuteLeft = lastMove.remaining_millis;
              } else {
                lastMove.minuteLeft2 = lastMove.remaining_millis;
                lastMove.minuteLeft = 0;
              }
        }else if(lastMove.status == 'DRAW' || lastMove.pgn.endsWith('#')){
              if (lastMove.userName1.toLowerCase() === userName.toLowerCase()) {
                lastMove.minuteLeft2 = secondLastMove.remaining_millis;
                lastMove.minuteLeft = lastMove.remaining_millis;
              } else {
                lastMove.minuteLeft2 = lastMove.remaining_millis;
                lastMove.minuteLeft = secondLastMove.remaining_millis;
              }
        } else {
                  const remainingTime = getAdjustedTime(lastMove, secondLastMove);
                  if (lastMove.userName1.toLowerCase() === userName.toLowerCase()) {
                    lastMove.minuteLeft2 = remainingTime;
                    lastMove.minuteLeft = lastMove.remaining_millis;
                  } else {
                    lastMove.minuteLeft2 = lastMove.remaining_millis;
                    lastMove.minuteLeft = remainingTime;
                  }
        }
    }else{
      const remainingTime = getAdjustedTime(lastMove, secondLastMove);

      if (lastMove.userName1.toLowerCase() === userName.toLowerCase()) {
        lastMove.minuteLeft2 = remainingTime;
        lastMove.minuteLeft = lastMove.remaining_millis;
      } else {
        lastMove.minuteLeft2 = lastMove.remaining_millis;
        lastMove.minuteLeft = remainingTime;
      }
    }
  if ((lastMove.minuteLeft2 <= timesUpsDeltaCheck || lastMove.minuteLeft <= timesUpsDeltaCheck || lastMove.pgn.endsWith('#') || lastMove.status == 'DRAW')  &&   (shouldRunGameOverCheck || match.winner_user_name_id == '' || match.winner_user_name_id != 'null' || match.winner_user_name_id != null)) {
        isGameOver(lastMove, secondLastMove);
  }
}

function getAdjustedTime(move, secondLastMove) {
    logger.info("getAdjustedTime for userName1 " + move.userName1 + " with Date.now() is " + Date.now() + " and move.currentTimeStampInMillis is " + move.current_move_time_millis.getMilliseconds());
    let moveTimeUTC = new Date(move.current_move_time_millis);
    let moveTimeIST = new Date(moveTimeUTC.getTime() + (5 * 60 + 30) * 60 * 1000);  // Add 5 hours and 30 minutes

    logger.info("inside getAdjustedTime");
    let getAdjustedTime = (REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND) - (Date.now() - moveTimeIST.getTime());
    if(!isNullOrUndefinedOrEmpty(secondLastMove)) {
        logger.info("inside getAdjustedTime more than one move i e second move found");
        getAdjustedTime = secondLastMove.remaining_millis - (Date.now() - moveTimeIST.getTime());
    }
    logger.info("returning getAdjustedTime " + getAdjustedTime + " for userName1 " + move.userName1);
    return getAdjustedTime < 0 ? 0 : getAdjustedTime;
}

async function isGameOver(lastMove, secondLastMove) {
    try {
            logger.info(`isGameOver for status: ${lastMove.status} and user ${lastMove.userName1}`);
            if (lastMove.status === DONE) {
                logger.info(`isGameOver DONE case, so just return user ${lastMove.userName1} and matchid ${lastMove.matchId}`);
                return;
            }
            if (lastMove.status === 'BLACK_EMPTY_MOVE_FOR_NO_SHOW') {
                let desc = 'BLACK_EMPTY_MOVE_FOR_NO_SHOW';
                let qryString = `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`;
                await queryDatabase(qryString, [lastMove.userName1, desc, lastMove.matchId]);
                qryString = `UPDATE move SET status = ? WHERE id = ?`;
                await queryDatabase(qryString, [DONE, lastMove.id]);
                logger.debug(`Match and move tables updated for BLACK_EMPTY_MOVE_FOR_NO_SHOW and user ${lastMove.userName1} and matchid ${lastMove.matchId}`);
                return;
            }

        if (lastMove.status === 'CONCLUDED' || lastMove.status === 'DRAW' ||(lastMove.minuteLeft2 <= timesUpsDeltaCheck || lastMove.minuteLeft <= timesUpsDeltaCheck )) {
            let desc = 'DIRECT';
            if (lastMove.status === 'CONCLUDED') {
                if (lastMove.pgn.endsWith('#')) {
                    desc = 'DIRECT';
                } else {
                    desc = 'D_TIME'; // direct time lost game
                }

                let qryString = `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`;
                await queryDatabase(qryString, [lastMove.userName1, desc, lastMove.matchId]);
                qryString = `UPDATE move SET status = ? WHERE id = ?`;
                await queryDatabase(qryString, [DONE, lastMove.id]);
                logger.debug(`Match table updated for CONCLUDED or DRAW with winner ${lastMove.userName1} user ${lastMove.userName1} and matchid ${lastMove.matchId}`);
            } else {
                let winner;
                logger.info("got" + secondLastMove);
                if((secondLastMove == null || secondLastMove == 'undefined')) {
                    winner = lastMove.userName1;
                    desc = 'D_TIME';

                    let qryString = `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`;
                    await queryDatabase(qryString, [winner, desc, lastMove.matchId]);
                    logger.debug(`Match table updated with winner based on E_TIME condition`);
                    qryString = `UPDATE move SET status = ? WHERE id = ?`;
                    await queryDatabase(qryString, [DONE, lastMove.id]);
                }else if (lastMove.status != 'DRAW') {
                    
                    desc = 'D_TIME';
                    winner = lastMove.userName1;

                    let qryString = `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`;
                    await queryDatabase(qryString, [winner, desc, lastMove.matchId]);
                    logger.debug(`Match table updated with winner based on D_TIME condition`);
                    qryString = `UPDATE move SET status = ? WHERE id = ?`;
                    await queryDatabase(qryString, [DONE, lastMove.id]);
                } else if (lastMove.status == 'DRAW') {

                    if(lastMove.remaining_millis != secondLastMove.remaining_millis) {
                        winner = lastMove.remaining_millis > secondLastMove.remaining_millis
                        ? lastMove.userName1
                        : secondLastMove.userName1;
                        desc = 'DRAW_TIME';
                         let qryString = `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`;
                        await queryDatabase(qryString, [winner, desc, lastMove.matchId]);
                        logger.debug(`Match table updated with winner based on DRAW_TIME condition`);
                        // qryString = `UPDATE move SET status = ? WHERE id = ?`;
                        // await queryDatabase(qryString, [DONE, lastMove.id]);

                    }else{
                         desc = 'BY_POINT';
                        winner = determineWinnerByColor(lastMove); // Define this function based on your game logic

                        let qryString = `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`;
                        await queryDatabase(qryString, [winner, desc, lastMove.matchId]);
                        logger.debug(`Match table updated for BY_POINT`);
                        qryString = `UPDATE move SET status = ? WHERE id = ?`;
                        await queryDatabase(qryString, [DONE, lastMove.id]);
                    }
                    // Determine the winner based on other game logic (e.g., by point)
                   
                }
            }
        }

    } catch (error) {
        logger.error(`Error in isGameOver: ${error.message}`);
    }
}

// Helper function to determine the winner by color (stub - replace with actual game logic)
function determineWinnerByColor(lastMove) {
    // Logic to determine if the winner is based on ChessColors
    return lastMove.fen.includes('w') ? lastMove.userName1 : lastMove.userName2;
}
const ChessColors = {
    NONE: 'NONE',
    WHITE: 'WHITE',
    BLACK: 'BLACK'
};


const chessCoinPoints = Object.freeze({
    'P': 1,  // White Pawn
    'p': -1, // Black Pawn
    'N': 3,  // White Knight
    'n': -3, // Black Knight
    'B': 3,  // White Bishop
    'b': -3, // Black Bishop
    'R': 5,  // White Rook
    'r': -5, // Black Rook
    'Q': 9,  // White Queen
    'q': -9, // Black Queen
    'K': 0,  // White King (usually not counted for points)
    'k': 0   // Black King (usually not counted for points)
});

function colorOfWinner(fen) {
    let totalPointDiff = 0;

    for (const char of fen) {
        if (/\s/.test(char)) break; // Stop if whitespace is encountered
        totalPointDiff += chessCoinPoints[char] || 0; // Get point from mapping, default to 0
    }

    logger.info(`Total point difference: ${totalPointDiff} for FEN: ${fen}`);

    if (totalPointDiff === 0) return ChessColors.NONE;
    return totalPointDiff > 0 ? ChessColors.WHITE : ChessColors.BLACK;
}


io.on('connection', (socket) => {
    logger.info('Connection established');

    socket.on('move', async (data) => {
        logger.debug("Move event received: " + JSON.stringify(data));

        let isLockAcquired = acquireLock(data.matchId);
        if (!isLockAcquired) {
            await waitForLock(data.matchId); // Wait for the lock to be released
            isLockAcquired = acquireLock(data.matchId); // Try to acquire the lock again after waiting
        }

        const jwtParts = data.auth.split('.');
        const payloadInBase64UrlFormat = jwtParts[1];

        // Validate JWT token
        const tokenData = authenticateToken(data.auth);

        if (!tokenData) {
            // Token is invalid, handle accordingly
            logger.error('Invalid token');
            socket.emit('error', 'Invalid token');
            return;
        }

        logger.info('User authenticated');

        const position = {
            ...data,
            userName1: null,
        };

        const game = new Chess(data.prevFen);
        const move = game.move({
            from: data.source,
            to: data.target,
            promotion: 'q',
        });

        if (!move) {
            logger.error("Illegal move");
            position.error = true;
            position.isReload = true;
            releaseLock(data.matchId);
            io.emit(data.matchId, position);
            return;
        }

        const userName1Obj = JSON.parse(base64.decode(payloadInBase64UrlFormat));
        const userName1 = userName1Obj.sub;
        position.userName1 = userName1;

        try {
            await db_pool.beginTransaction();

            // Validate match existence
            const query1 = "SELECT * FROM ?? WHERE id = ? AND (user_1 = ? OR user_2 = ?);";
            const table1 = ["matches", data.matchId, userName1, userName1];
            const [rows1] = await db_pool.query(mysql.format(query1, table1));

            if (rows1.length === 0) {
                logger.error("Match not found or invalid user");
                position.error = true;
                position.isReload = true;
                releaseLock(data.matchId);
                io.emit(data.matchId, position);
                return;
            }

            // Fetch last two moves
            const query2 = "SELECT * FROM ?? WHERE matchId = ? ORDER BY id DESC LIMIT 2;";
            const table2 = ["move", data.matchId];
            const [moves] = await db_pool.query(mysql.format(query2, table2));

            let remainingMillis = REMAINING_TIME_WHITE_IN_SECONDS * 1000;

            if (moves.length > 0) {
                const lastMove = moves[0];
                const millisDiff = Date.now() - new Date(lastMove.current_move_time_millis).getTime();
                remainingMillis = lastMove.remaining_millis - millisDiff;
            }

            if (remainingMillis <= 0) {
                position.gameOver = true;
                position.isReload = true;
                position.millitTimeForUserName_1 = 0;
                releaseLock(data.matchId);
                io.emit(data.matchId, position);
                return;
            }

            // Insert new move
            const query3 = "INSERT INTO ?? (`userName1`, `userName2`, `eventId`, `matchId`, `challengeId`, `pgn`, `fen`, `current_move_time_millis`, `source`, `target`, `status`, `remaining_millis`) VALUES (?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?);";
            const table3 = ["move", userName1, "", "", data.matchId, "", data.pgn, data.fen, Date.now() / 1000, data.source, data.target, RUNNING, remainingMillis];
            await db_pool.query(mysql.format(query3, table3));

            await db_pool.commit();

            position.millitTimeForUserName_1 = remainingMillis;
            position.millitTimeForUserName_2 = remainingMillis;
            releaseLock(data.matchId);
            io.emit(data.matchId, position);
        } catch (err) {
            logger.error("Database error: " + JSON.stringify(err));
            await db_pool.rollback();
            position.error = true;
            position.isReload = true;
            releaseLock(data.matchId);
            io.emit(data.matchId, position);
        }
    });

    socket.on('disconnect', () => {
        logger.info('User disconnected');
    });
});


const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    logger.info(`Server is running on http://localhost:${PORT}`);
});