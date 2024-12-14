const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mysql = require('mysql');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { query, pool } = require('./db_pool');
const {
    Chess
} = require('chess.js')
const base64 = require('base64url');
const winston = require('winston');
const cors = require('cors');
// const Match = require('./model/Match');
// const move = require('./model/move');
const ResourceFairLock = require('./ResourceFairLock');

const fairLock = new ResourceFairLock();
const { acquireLock, releaseLock, waitForLock } = require('./lockManager'); // Import the lock functions
const lock = {};
var position = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
var MATCH_DURATION_IN_MINUTES = 6;
const ONE_THOUSAND = 1000;
const MINUTE_TO_SECONDS_MULTIPLYER_60 = 60;
const CONCLUDED_STATUS = 'CONCLUDED';
const DRAW = 'DRAW';
const NO_SHOW_STATUS = 'NO_SHOW';
const BLACK_EMPTY_MOVE_FOR_NO_SHOW = 'EMPTY_MOVE';
let REMAINING_TIME_WHITE_IN_SECONDS = (MATCH_DURATION_IN_MINUTES * 60) / 2;
let REMAINING_TIME_BLACK_IN_SECONDS = (MATCH_DURATION_IN_MINUTES * 60) / 2;
const RUNNING = 'RUNNING';
const timesUpsDeltaCheck = 0;
const DONE = 'DONE';
const UTC_ADD_UP = 19800000;
const TIME_OUT_FOR_API = 7000;


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
  origin: ['https://www.32chess.com', 'https://32chess.com'],
  methods: 'GET',
  credentials: true,
}));
const server = http.createServer(app);
const io = socketIO(server);

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
    const release = await fairLock.acquire(id, TIME_OUT_FOR_API);
    try {
        // Acquire the lock

        logger.info('match id for user ' + userName +"match id"+ id);

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
        logger.info('Query Results for match for user :' + userName + " ", JSON.stringify(match));
        if (!match) throw new Error('Match not found');

        // Set color based on userName comparison
        match.color = match.user_1.toLowerCase() === userName.toLowerCase() ? 'white' : 'black';

        // Fetch latest moves
        latestMove1 = await getLastTwoMovesByMatchId(id);

        // Fetch the latest move and calculate the minutes left
        const latestMove = await getLatestMove(id, userName, match, latestMove1);
        release();
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
        release();
    }
}

async function getMatchById(matchId) {
  try {
    const sqlQuery = 'SELECT * FROM matches WHERE id = ?';
    const [results] = await query(sqlQuery, [matchId]);
     logger.info('Query Results:', results.length);
    return results;
  } catch (error) {
    console.error('Error executing query:', error);
    throw error; // Re-throw the error to handle it outside
  }
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
    // const signatureInBase64UrlFormat = jwtParts[2];
    var userName1Obj = JSON.parse(base64.decode(payloadInBase64UrlFormat));
    jwt.verify(token, "javainuse", {
        algorithms: ['HS256'],
        encoding: 'utf-8'
    }, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        logger.info('verifying user  '+userName1Obj.sub)

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
    const results = await query(sqlQuery, [matchId]);
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
                const desc = 'BLACK_EMPTY_MOVE_FOR_NO_SHOW';
                try {
                    // Update matches table
                    let qryString = `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`;
                    await query(qryString, [lastMove.userName1, desc, lastMove.matchId]);

                    // Update move table
                    qryString = `UPDATE move SET status = ? WHERE id = ?`;
                    await query(qryString, ['DONE', lastMove.id]);

                    logger.debug(`Match and move tables updated for BLACK_EMPTY_MOVE_FOR_NO_SHOW and user ${lastMove.userName1} and matchId ${lastMove.matchId}`);
                } catch (error) {
                    logger.error(`Error updating tables for BLACK_EMPTY_MOVE_FOR_NO_SHOW: ${error.message}`, error);
                    throw error; // Propagate the error to handle it upstream
                }
                return;
            }

        if (lastMove.status === 'CONCLUDED' || lastMove.status === 'DRAW' ||(lastMove.minuteLeft2 <= timesUpsDeltaCheck || lastMove.minuteLeft <= timesUpsDeltaCheck )) {
            let desc = 'DIRECT';
        if (lastMove.status === 'CONCLUDED') {
            try {
                const desc = lastMove.pgn.endsWith('#') ? 'DIRECT' : 'D_TIME'; // Determine win description

                // Update matches table
                let qryString = `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`;
                await query(qryString, [lastMove.userName1, desc, lastMove.matchId]);

                // Update move table
                qryString = `UPDATE move SET status = ? WHERE id = ?`;
                await query(qryString, ['DONE', lastMove.id]);

                logger.debug(`Match table updated for CONCLUDED or DRAW with winner ${lastMove.userName1}, user ${lastMove.userName1}, and matchId ${lastMove.matchId}`);
            } catch (error) {
                logger.error(`Error updating tables for CONCLUDED status: ${error.message}`, error);
                throw error; // Propagate the error for upstream handling
            }
        } else {
                try {
                    let winner;
                    let desc;

                    logger.info("got " + secondLastMove);

                    if (!secondLastMove) {
                        // E_TIME condition
                        winner = lastMove.userName1;
                        desc = 'D_TIME';

                        await query(
                            `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`,
                            [winner, desc, lastMove.matchId]
                        );

                        logger.debug(`Match table updated with winner based on E_TIME condition`);

                        await query(
                            `UPDATE move SET status = ? WHERE id = ?`,
                            ['DONE', lastMove.id]
                        );

                    } else if (lastMove.status !== 'DRAW') {
                        // D_TIME condition
                        winner = lastMove.userName1;
                        desc = 'D_TIME';

                        await query(
                            `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`,
                            [winner, desc, lastMove.matchId]
                        );

                        logger.debug(`Match table updated with winner based on D_TIME condition`);

                        await query(
                            `UPDATE move SET status = ? WHERE id = ?`,
                            ['DONE', lastMove.id]
                        );

                    } else if (lastMove.status === 'DRAW') {

                        // Determine the winner based on other game logic (e.g., by point)
                        desc = 'BY_POINT';
                        winnerColor = colorOfWinner(lastMove.fen); // Define this function based on your game logic
                        var blackUser = lastMove.fen.includes('w') ? lastMove.userName1 : secondLastMove.userName1;
                        var whiteUser = lastMove.fen.includes('w') ? secondLastMove.userName1 : lastMove.userName1;
                        logger.debug(`Draw winner color is ${winnerColor}`);
                        if(ChessColors.NONE == winnerColor) {
                            if (lastMove.remaining_millis !== secondLastMove.remaining_millis) {
                                // DRAW_TIME condition
                                winner = lastMove.remaining_millis > secondLastMove.remaining_millis
                                    ? lastMove.userName1
                                    : secondLastMove.userName1;

                                desc = 'DRAW_TIME';

                                await query(
                                    `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`,
                                    [winner, desc, lastMove.matchId]
                                );

                                logger.debug(`Match table updated with winner based on DRAW_TIME condition`);
                            } else {
                                desc = 'DIRECT_BLACK';
                                await query(
                                    `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`,
                                    [blackUser, desc, lastMove.matchId]
                                );
                                logger.debug(`Match table updated for BLACK COLOR ${lastMove.matchId} and user ${blackUser}`);
                            }

                        } else {
                            desc = 'BY_POINT';
                            if(winnerColor == ChessColors.WHITE) {
                                winner = whiteUser;
                            } else if(winnerColor == ChessColors.BLACK) {
                                winner = blackUser;
                            }
                            await query(
                                `UPDATE matches SET winner_user_name_id = ?, win_desc = ? WHERE id = ?`,
                                [winner, desc, lastMove.matchId]
                            );
                            logger.debug(`Match table updated for BY_POINT`);
                        }
                    }
                } catch (error) {
                    logger.error(`Error updating tables for match logic: ${error.message}`, error);
                    throw error; // Propagate the error for upstream handling
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
        const game2 = new Chess();
        const move = game.move({
            from: data.source,
            to: data.target,
            promotion: 'q',
        });
        console.log("pgn" + data.pgn);
        game2.load_pgn(data.pgn);
        const userName1Obj = JSON.parse(base64.decode(payloadInBase64UrlFormat));
        const userName1 = userName1Obj.sub;
        position.userName1 = userName1;
        if (!move) {
            logger.error("Illegal move by " + userName1);
            position.error = true;
            position.isReload = true;
            releaseLock(data.matchId);
            io.emit(data.matchId, position);
            return;
        }
        try {
            //await pool.beginTransaction(); 
            if (game.in_checkmate()) {
                status = 'CONCLUDED'
            } else if (game.in_draw() || game2.in_draw()) {
                console.log("yes its DRAW");
                status = 'DRAW'
            } else {
                status = RUNNING
            }
            logger.info("trying socket for  " + userName1);
            if (data.gameOver) {
                logger.debug('game over');
                releaseLock(data.matchId);
                return;
            }

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
            // Validate match existence
            const query1 = "SELECT * FROM ?? WHERE id = ? AND (user_1 = ? OR user_2 = ?);";
            const table1 = ["matches", data.matchId, userName1, userName1];
            const rows1 = await query(mysql.format(query1, table1));
            logger.info('rows1')
            logger.info(rows1)
            if (rows1.length === 0) {
                logger.error("Match not found or invalid user");
                position.error = true;
                position.isReload = true;
                releaseLock(data.matchId);
                io.emit(data.matchId, position);
                return;
            }
            let currentTimeStampInMillis = new Date().getTime();
            // Fetch last two moves

            const release = await fairLock.acquire(data.matchId, TIME_OUT_FOR_API);
            const query2 = "SELECT * FROM ?? WHERE matchId = ? ORDER BY id DESC LIMIT 2;";
            const table2 = ["move", data.matchId];
            const moves = await query(mysql.format(query2, table2));

            let remainingMillis = REMAINING_TIME_WHITE_IN_SECONDS * 1000;
            if(moves.length == 0) {
                logger.info("No moves found" + " matcheid" + matchId);
                remaining_millis = REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND;
                millitTimeForUserName_1 = REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND;
                millitTimeForUserName_2 = REMAINING_TIME_WHITE_IN_SECONDS * ONE_THOUSAND;
            }
            if (moves.length > 0) {
                var gameStatus = moves[0].status;
                var userNameOfLastMoved = moves[0].userName1;
                var userNameOfCurrentMove = userName1;
                var totalMovesMadeSoFarInGame = moves.length;
                var matchStartTimeString = moves[0].matchStartTime;
                if (gameStatus === DRAW || gameStatus === CONCLUDED_STATUS || gameStatus === NO_SHOW_STATUS || userNameOfLastMoved === userNameOfCurrentMove) {
                    position.isReload = true
                    io.emit(data.matchId, position);
                    release();
                    return;
                }
                if (totalMovesMadeSoFarInGame == ONE) {
                    const mysqlTimestamp = new Date(moves[0].current_move_time_millis);
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
                    var gameStatus = moves[1].status;
                    secondLastMoveForsocket = moves[1];
                    if (gameStatus === BLACK_EMPTY_MOVE_FOR_NO_SHOW) {
                        logger.info("BLACK is moving now, after white made a move follwed by EMPTY_MOVE.. for matchId" + matchId);
                        const mysqlTimestamp = new Date(moves[0].current_move_time_millis);
                        millisDiff = new Date().getTime() - (mysqlTimestamp.getTime() + 19800000);
                        logger.info("millidiff" + millisDiff + "matchId" + matchId);
                        logger.info("REMAINING_TIME_BLACK_IN_SECONDS" + REMAINING_TIME_BLACK_IN_SECONDS +" matcheid" + matchId);

                        remaining_millis = (REMAINING_TIME_BLACK_IN_SECONDS * ONE_THOUSAND) - millisDiff;
                        logger.info("remaining_millis" + remaining_millis +" matcheid" + matchId);
                        millitTimeForUserName_1 = moves[0].remaining_millis;
                    } else if (gameStatus === RUNNING) { 
                        logger.info("LAST CASE RUNNING..!!" + " matcheid" + matchId);
                        const mysqlTimestamp = new Date(moves[0].current_move_time_millis);
                        millisDiff = new Date().getTime() - (mysqlTimestamp.getTime() + 19800000);
                        remaining_millis = moves[1].remaining_millis - millisDiff;
                        millitTimeForUserName_1 = moves[0].remaining_millis;
                    }
                }
            }

            if (remainingMillis <= 0) {
                position.gameOver = true;
                position.isReload = true;
                position.millitTimeForUserName_1 = 0;
                release();
                io.emit(data.matchId, position);
                return;
            }
            millitTimeForUserName_2 = remaining_millis;
            // Insert new move
            const query3 = "INSERT INTO ?? (`userName1`, `userName2`, `eventId`, `matchId`, `challengeId`, `pgn`, `fen`, `current_move_time_millis`, `source`, `target`, `status`, `remaining_millis`) VALUES (?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?);";
            const table3 = ["move", userName1, userName2, eventId, matchId, challengeId, pgn, fen, currentTimeStampInMillis / 1000, source, target, status, remaining_millis];
            await query(mysql.format(query3, table3));

            //await pool.commit();

            position.millitTimeForUserName_1 = millitTimeForUserName_1;
            position.millitTimeForUserName_2 = millitTimeForUserName_2;
            if(status == DRAW)
                position.isDraw = true;
            release();
            io.emit(data.matchId, position);
        } catch (err) {
            logger.error("Database error: " + JSON.stringify(err.stack));
            //await pool.rollback();
            position.error = true;
            position.isReload = true;
            release();
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