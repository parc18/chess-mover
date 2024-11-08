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
const timesUpsDeltaCheck = 100;
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

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: format.combine(
        format.label({
            label: path.basename(process.mainModule.filename)
        }),
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        // Format the metadata object
        format.metadata({
            fillExcept: ['message', 'level', 'timestamp', 'label']
        })
    ),
    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize(),
                logFormat
            )
        }),
        new transports.File({
            filename: 'logs/combined.log',
            format: format.combine(
                // Render in one line in your log file.
                // If you use prettyPrint() here it will be really
                // difficult to exploit your logs files afterwards.
                format.json()
            )
        })
    ],
    exitOnError: false
})
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
var db_config = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
};


function handleDisconnect() {
    connection = mysql.createConnection(db_config); // Recreate the connection, since
    // the old one cannot be reused.

    connection.connect(function(err) { // The server is either down
        if (err) { // or restarting (takes a while sometimes).
            logger.error('error when connecting to db:', JSON.stringify(err));
            setTimeout(handleDisconnect, 2000); // We introduce a delay before attempting to reconnect,
        } // to avoid a hot loop, and to allow our node script to
    }); // process asynchronous requests in the meantime.
    // If you're also serving http, display a 503 error.
    connection.on('error', function(err) {
        logger.error('db error', JSON.stringify(err));
        if (err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
            handleDisconnect(); // lost due to either server restart, or a
        } else { // connnection idle timeout (the wait_timeout
            throw err; // server variable configures this)
        }
    });
}
handleDisconnect();



// Connect to the database
db.connect((err) => {
    if (err) {
        logger.error("Error connecting to Error connecting to MySQL database:", JSON.stringify(err));
        return;
    }
    logger.info("Connected to MySQL database");
});

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
        while (!isLockAcquired) {
            console.log('lock wait for ' + userName)
            await waitForLock(id); // Wait for the lock to be released
            isLockAcquired = await acquireLock(id); // Try to acquire the lock again after waiting
        }

        if (id < 1) throw new Error('Invalid match ID');

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
    console.log('hell yeah  '+payloadInBase64UrlFormat)
    // const signatureInBase64UrlFormat = jwtParts[2];
    var userName1Obj = JSON.parse(base64.decode(payloadInBase64UrlFormat));

    //console.log('hell yeah 2 '+JSON.parse(base64.decode(payloadInBase64UrlFormat)))


    
    
    jwt.verify(token, "javainuse", {
        algorithms: ['HS256'],
        encoding: 'utf-8'
    }, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
         logger.info("JWT USER ", JSON.stringify(userName1Obj));
             console.log('hell yeah  3 '+userName1Obj.sub)

        req.user = userName1Obj.sub; // attach the decoded user information to the request object
        next();
    });
}

async function getLatestMove(id, userName, match, moves) {
  let shouldRunGameOverCheck = false;
  if (userName && (userName.toLowerCase() === match.user_1.toLowerCase() || userName.toLowerCase() === match.user_2.toLowerCase())) {
    shouldRunGameOverCheck = true;
  }
  console.log(match.winner_user_name_id == '')
  if(match.winner_user_name_id == '' || match.winner_user_name_id != 'null' || match.winner_user_name_id != null || match.winner_user_name_id != undefined || match.winner_user_name_id != 'undefined') {
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
    lastMove.minuteLeft2 = getAdjustedTime(lastMove);
  } else {
    lastMove.minuteLeft2 = REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND;
    lastMove.minuteLeft = getAdjustedTime(lastMove);
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
    console.log('match');
    console.log(match);
    console.log(match.winner_user_name_id);

    if(match.winner_user_name_id == '' || match.winner_user_name_id != null || match.winner_user_name_id != 'null' || match.winner_user_name_id != undefined || match.winner_user_name_id != 'undefined') {
        if(isNullOrUndefinedOrEmpty(secondLastMove)){
              if (lastMove.userName1.toLowerCase() === userName.toLowerCase()) {
                lastMove.minuteLeft2 = 0;
                lastMove.minuteLeft = lastMove.remaining_millis;
              } else {
                lastMove.minuteLeft2 = lastMove.remaining_millis;
                lastMove.minuteLeft = 0;
              }
        }else{
              if (lastMove.userName1.toLowerCase() === userName.toLowerCase()) {
                lastMove.minuteLeft2 = secondLastMove.remaining_millis;
                lastMove.minuteLeft = lastMove.remaining_millis;
              } else {
                lastMove.minuteLeft2 = lastMove.remaining_millis;
                lastMove.minuteLeft = secondLastMove.remaining_millis;
              }
        }
    }else{
      const remainingTime = getAdjustedTime(lastMove);

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

function getAdjustedTime(move) {
    logger.info("getAdjustedTime for userName1 " + move.userName1 + " with Date.now() is " + Date.now() + " and move.currentTimeStampInMillis is " + move.current_move_time_millis.getMilliseconds());
let moveTimeUTC = new Date(move.current_move_time_millis);
let moveTimeIST = new Date(moveTimeUTC.getTime() + (5 * 60 + 30) * 60 * 1000);  // Add 5 hours and 30 minutes
logger.info(Date.now());
    logger.info(moveTimeIST.getTime());
   // logger.info(moveTimeUTC+UTC_ADD_UP);
    logger.info("LOL");

// const adjustedTime = new Date(Date.now()).toLocaleString("en-GB", { hour12: false });
// const moveTime = new Date(move.current_move_time_millis).toLocaleString("en-GB", { hour12: false });

// logger.info(`getAdjustedTime for userName1 ${move.userName1} with Date.now() is ${adjustedTime} and move.currentTimeStampInMillis is ${moveTime}`);
const adjustedTime = new Date(Date.now()).toLocaleString("en-GB", { hour12: false });

// Manually convert UTC timestamp to IST
 moveTimeUTC = new Date(move.current_move_time_millis);
 moveTimeIST = new Date(moveTimeUTC.getTime() + (5 * 60 + 30) * 60 * 1000);  // Add 5 hours 30 minutes in milliseconds

// Format the IST time manually to "YYYY-MM-DD HH:MM:SS"
const formattedMoveTimeIST = moveTimeIST.toISOString().replace('T', ' ').substring(0, 19);

//logger.info(`getAdjustedTime for userName1 ${move.userName1} with Date.now() is ${adjustedTime} and move.currentTimeStampInMillis in IST is ${formattedMoveTimeIST}`);
    logger.info(Date.now() - moveTimeIST.getTime());
     logger.info("LOL2");
    logger.info(REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND / 2);
    let getAdjustedTime = (REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND) - (Date.now() - moveTimeIST.getTime());
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
    logger.info('connection estabished');

    socket.on('move', (data) => {
        logger.debug("move event received: " + JSON.stringify(data));

        let isLockAcquired = acquireLock(data.matchId);
        while (!isLockAcquired) {
            waitForLock(id); // Wait for the lock to be released
            isLockAcquired = acquireLock(data.matchId); // Try to acquire the lock again after waiting
        }
        const jwtParts = data.auth.split('.');
        const headerInBase64UrlFormat = jwtParts[0];
        payloadInBase64UrlFormat = jwtParts[1];
        const signatureInBase64UrlFormat = jwtParts[2];
        let secondLastMoveForsocket = null;

        // Validate JWT token
        const tokenData = authenticateToken(data.auth);

        if (tokenData) {
            // Token is valid, handle the move event logic here
            logger.info('User authenticated!!!');

            // VALIDATE THE SECRET LATER
            position = data;
            position.userName1 = null;
            var game = new Chess(data.prevFen);
            const move = game.move({
                from: data.source,
                to: data.target,
                promotion: 'q' // NOTE: always promote to a queen for example simplicity
            })

            // illegal move
            if (move === null) {
                logger.error("Illegal move")
                position.error = true
                position.isReload = true
                releaseLock(data.matchId);
                io.emit(data.matchId, position);
                
                return;
            } else {
                var userName1Obj = JSON.parse(base64.decode(payloadInBase64UrlFormat));
                game = new Chess(data.fen);
                if (game.in_checkmate()) {
                    status = 'CONCLUDED'
                } else if (game.in_draw()) {
                    status = 'DRAW'
                } else {
                    status = RUNNING
                }
                if (data.gameOver) {
                    logger.debug('game over');
                    releaseLock(data.matchId);
                    return;
                }
                var userName1 = userName1Obj.sub;
                position.userName1 = userName1;
                var userName2 = "";
                var eventId = '';
                var matchId = data.matchId;
                var challengeId = '';
                var pgn = data.pgn;
                var fen = data.fen;
                var target = data.target
                var source = data.source
                var millitTimeForUserName_1 = 0;
                var millitTimeForUserName_2 = 0;
                var matchFinal = null;
                var movefinal = null;
                logger.debug(pgn);
                if (true) {
                  logger.debug('Query is : ');
                    connection.beginTransaction(function(err) {

                        const query1 = "SELECT * FROM ?? WHERE id = ? AND (user_1 = ? OR user_2 = ?)";
                        const table1 = ["matches", matchId, userName1, userName1];
                        const formattedQuery1 = mysql.format(query1, table1);
                        logger.debug('Query is : ');
                        logger.debug(formattedQuery1);
                        connection.query(formattedQuery1, function(err, rows1) {
                            if (err) {
                                logger.error("Error while connecting to db " + JSON.stringify(err));
                                    position.error = true
                                    position.isReload = true
                                    releaseLock(matchId);
                                    io.emit(data.matchId, position);
                                    
                                return;
                            } else {
                                logger.debug(rows1[0]);
                                matchFinal = rows1[0];
                                if (rows1.length > 0) {
                                    var query = "select * from ?? where matchId = ?  order by id desc limit 2";
                                    var table = ["move", matchId];
                                    query = mysql.format(query, table);
                                    var currentTimeStampInMillis = new Date().getTime();
                                    let remaining_millis = 0;
                                    connection.query(query, function(err, rows) {
                                        if (err) {
                                            logger.error("Error while connecting to db " + JSON.stringify(err));
                                            eleaseLock(matchId);
                                            return;
                                        } else {
                                            if (rows.length > 0) {
                                                movefinal = rows;
                                                var gameStatus = rows[0].status;
                                                var userNameOfLastMoved = rows[0].userName1;
                                                var userNameOfCurrentMove = userName1;
                                                var totalMovesMadeSoFarInGame = rows.length;
                                                //createThis
                                                var matchStartTimeString = rows[0].matchStartTime;
                                                if (gameStatus === CONCLUDED_STATUS || gameStatus === NO_SHOW_STATUS || userNameOfLastMoved === userNameOfCurrentMove) {
                                                    position.isReload = true
                                                    releaseLock(matchId);
                                                    io.emit(data.matchId, position);
                                                    return;
                                                }
                                                if (totalMovesMadeSoFarInGame == ONE) {
                                                    const mysqlTimestamp = new Date(rows[0].current_move_time_millis);
                                                    millisDiff = new Date().getTime() - (mysqlTimestamp.getTime() + 19800000);
                                                    if (gameStatus === BLACK_EMPTY_MOVE_FOR_NO_SHOW) {
                                                        logger.info("WHITE is moving now, found EMPTY_MOVE from BLACK.. because WHITE was late for first move!! for matchId" + matchId);
                                                        remaining_millis = (REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND) - millisDiff;
                                                    } else if (gameStatus === RUNNING) {
                                                        remaining_millis = (REMAINING_TIME_BLACK_IN_SECONDS * ONE_THOUSAND) - millisDiff
                                                    }
                                                    millitTimeForUserName_1 = remaining_millis;
                                                } else if (totalMovesMadeSoFarInGame > ONE) {
                                                    logger.info("more than one move case executing..!!! for matchId" + matchId);
                                                    var gameStatus = rows[1].status;
                                                    secondLastMoveForsocket = rows[1];
                                                    if (gameStatus === BLACK_EMPTY_MOVE_FOR_NO_SHOW) {
                                                        logger.info("BLACK is moving now, after white made a move follwed by EMPTY_MOVE.. for matchId" + matchId);
                                                        const mysqlTimestamp = new Date(rows[0].current_move_time_millis);
                                                        millisDiff = new Date().getTime() - (mysqlTimestamp.getTime() + 19800000);
                                                        logger.info("millidiff" + millisDiff + "matchId" + matchId);
                                                        logger.info("REMAINING_TIME_BLACK_IN_SECONDS" + REMAINING_TIME_BLACK_IN_SECONDS +" matcheid" + matchId);

                                                        remaining_millis = (REMAINING_TIME_BLACK_IN_SECONDS * ONE_THOUSAND) - millisDiff;
                                                        logger.info("remaining_millis" + remaining_millis +" matcheid" + matchId);
                                                        millitTimeForUserName_1 = rows[0].remaining_millis;
                                                    } else if (gameStatus === RUNNING) { 
                                                        logger.info("LAST CASE RUNNING..!!" + " matcheid" + matchId);
                                                        const mysqlTimestamp = new Date(rows[0].current_move_time_millis);
                                                        millisDiff = new Date().getTime() - (mysqlTimestamp.getTime() + 19800000);
                                                        remaining_millis = rows[1].remaining_millis - millisDiff;
                                                        millitTimeForUserName_1 = rows[0].remaining_millis;
                                                        // position.userName1 = userName1;
                                                        // position.time1 = remaining_millis-3000;
                                                        // position.time2 = rows[0].remaining_millis-3000;
                                                    }
                                                }
                                            } else {
                                                logger.info("last else when no records found" + " matcheid" + matchId);
                                                remaining_millis = REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND;
                                                millitTimeForUserName_1 = REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND;
                                                millitTimeForUserName_2 = REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND;

                                            }
                                        }
                                        if (remaining_millis <= 100) {
                                            position.gameOver = true;
                                            position.isReload = true;
                                            position.millitTimeForUserName_1 = 0;
                                            position.millitTimeForUserName_1 = millitTimeForUserName_1;
                                            releaseLock(matchId);
                                            io.emit(data.matchId, position);
                                            return;
                                        }
                                        // Broadcast the move event to all connected clients

                                        millitTimeForUserName_2 = remaining_millis;
                                        query = "insert into ?? (`userName1`,`userName2`,`eventId`, `matchId`, `challengeId`, `pgn`, `fen`, `current_move_time_millis`, `source`, `target`, `status`, `remaining_millis`) values(?,?,?,?,?,?,?, FROM_UNIXTIME(?), ? ,?, ?, ?)";
                                        table = ["move", userName1, userName2, eventId, matchId, challengeId, pgn, fen, currentTimeStampInMillis / 1000, source, target, status, remaining_millis];
                                        query = mysql.format(query, table);
                                        logger.debug(query);
                                        connection.query(query, function(err, rows) {
                                            if (err) {
                                                 releaseLock(matchId);
                                                logger.error("DB ERROR ", JSON.stringify(err));
                                            } else {
                                                connection.commit(function(err) {
                                                    movefinal = rows;
                                                    console.log('movefinal')
                                                    console.log(movefinal[0])
                                                    if (err) {

                                                        connection.rollback(function() {
                                                            logger.error("error rollback for", JSON.stringify(err));
                                                        });
                                                        releaseLock(matchId);
                                                    } else if(1==2){
                                                        logger.info("successfully made amove");
                                                        logger.info("timestamp" + currentTimeStampInMillis +  "usrname" + userName1 + "status" + status);
                                                        logger.info(JSON.stringify(secondLastMoveForsocket));
                                                        if(status === 'DRAW') {
                                                            if (remaining_millis != secondLastMoveForsocket.remaining_millis) {
                                                                
                                                                desc = 'E_TIME';
                                                                winner = remaining_millis > secondLastMoveForsocket.remaining_millis
                                                                    ? userName1
                                                                    : secondLastMoveForsocket.userName1;

                                                                const qryString = `UPDATE Match SET winner = ?, winDesc = ? WHERE id = ?`;
                                                                queryDatabase(qryString, [winner, desc, lastMove.matchId]);
                                                                logger.debug(`Match table updated with winner based on E_TIME condition ${matchId}`);
                                                            } else {
                                                                // Determine the winner based on other game logic (e.g., by point)
                                                                desc = 'BY_POINT';
                                                                winnerColor = colorOfWinner(fen); // Define this function based on your game logic
                                                                if(ChessColors.WHITE == winnerColor) {
                                                                    let qryString = `UPDATE Match SET winner = ?, winDesc = ? WHERE id = ?`;
                                                                    queryDatabase(qryString, [userName1, desc, matchId]);
                                                                    logger.debug(`Match table updated for WHITE BY_POINT ${matchId} and user ${userName1}`);
                                                                } else if(ChessColors.BLACK == winnerColor) {
                                                                    let qryString = `UPDATE Match SET winner = ?, winDesc = ? WHERE id = ?`;
                                                                    queryDatabase(qryString, [userName2, desc, matchId]);
                                                                    logger.debug(`Match table updated for COLOR BY_POINT ${matchId} and user ${userName2}`);
                                                                } else {
                                                                    desc = 'BY_COLOR';
                                                                    let qryString = `UPDATE Match SET winner = ?, winDesc = ? WHERE id = ?`;
                                                                    queryDatabase(qryString, [userName2, desc, matchId]);
                                                                    logger.debug(`Match table updated for COLOR BY_COLOR ${matchId} and user ${userName2}`);
                                                                }
                                                            }
                                                            qryString = `UPDATE move SET status = ? WHERE id = ?`;
                                                            queryDatabase(qryString, [DONE, matchId]);
                                                        }
                                                        releaseLock(matchId);
                                                    }else if (status == 'CONCLUDED' || status == 'DRAW') {
                                                        logger.info("calling getLastTwoMovesByMatchId");
                                                        //getLastTwoMovesByMatchId(matchId);
                                                        fetchMatchDetails1(matchId, userName1);
                                                        releaseLock(matchId);
                                                    }
                                                });
                                            }
                                        })
                                        if (remaining_millis < 100) {
                                            position.gameOver = true
                                        } else {
                                            position.gameOver = false
                                        }
                                        // Broadcast the move event to all connected clients
                                        position.millitTimeForUserName_1 = millitTimeForUserName_1;
                                        position.millitTimeForUserName_2 = millitTimeForUserName_2;
                                        releaseLock(matchId);
                                        io.emit(data.matchId, position);
                                    });

                                }
                            }
                        });




                    });
                }
            }




        } else {
            // Token is invalid, handle accordingly (e.g., emit an error event)
            logger.error('Invalid token');
            socket.emit('error', 'Invalid token');
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