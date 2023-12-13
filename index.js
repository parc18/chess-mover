const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mysql = require('mysql');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { Chess } = require('chess.js')
const base64 = require('base64url');
// Load environment variables from .env file
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// MySQL database connection configuration
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

  connection.connect(function(err) {              // The server is either down
    if(err) {                                     // or restarting (takes a while sometimes).
      console.log('error when connecting to db:', err);
      setTimeout(handleDisconnect, 2000); // We introduce a delay before attempting to reconnect,
    }                                     // to avoid a hot loop, and to allow our node script to
  });                                     // process asynchronous requests in the meantime.
                                          // If you're also serving http, display a 503 error.
  connection.on('error', function(err) {
    console.log('db error', err);
    if(err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
      handleDisconnect();                         // lost due to either server restart, or a
    } else {                                      // connnection idle timeout (the wait_timeout
      throw err;                                  // server variable configures this)
    }
  });
}
handleDisconnect();



// Connect to the database
db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL database:', err);
    return;
  }
  console.log('Connected to MySQL database');
});

// Middleware function to validate JWT token
const authenticateToken = (token) => {
  try {
    token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJBIiwiaWF0IjoxNzAyNDk3NjUzfQ.LW9VKdj4p7QAB78Y0F9ezlX2wTtlWTdJlv4St3VtJVM";
    const decoded = jwt.verify(token, "javainuse", { algorithms: ['HS256'], ignoreExpiration: true, encoding: 'utf-8' });

    return decoded;
  } catch (error) {
    console.error('JWT Token validation error:', error);
    return null;
  }
};

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});
var position = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
var matchDuration = 399;

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('move', (data) => {
    console.log('Move event received:', data);
          const jwtParts = data.auth.split('.');
      const headerInBase64UrlFormat = jwtParts[0];
      payloadInBase64UrlFormat = jwtParts[1];
      const signatureInBase64UrlFormat = jwtParts[2];
      console.log('emitting' +  base64.decode(payloadInBase64UrlFormat));

    // Validate JWT token
    const tokenData = authenticateToken(data.auth);

    if (tokenData) {
      // Token is valid, handle the move event logic here
      console.log('User authenticated:', tokenData);



    console.log("Incoming requests");
    // VALIDATE THE SECRET LATER
    position = data;
    var game = new Chess(data.prevFen);
    const move = game.move({
        from: data.source,
        to: data.target,
        promotion: 'q' // NOTE: always promote to a queen for example simplicity
    })

      // illegal move
    if (move === null) {
      console.log("illegal move")
    }else{
      var userName1Obj = JSON.parse(base64.decode(payloadInBase64UrlFormat));
      game = new Chess(data.fen);
      if (game.in_checkmate()) {
        status = 'CONCLUDED'
      } else if (game.in_draw()) {
        status = 'DRAW'
      } else {
        status = 'RUNNING'
      }
      if(data.gameOver) {
        console.log('game over')
        return;
      }
      var userName1 = userName1Obj.sub;
      var userName2 = "";
      var eventId = '';
      var matchId = data.matchId;
      var challengeId = '';
      var pgn = data.pgn;
      var fen = data.fen;
      var target = data.target
      var source = data.source
      console.log(pgn)
        if (true) {
            connection.beginTransaction(function(err) {
                var query = "select * from ?? where matchId = ?  order by id desc limit 2";
                var table = ["move" , matchId];
                query = mysql.format(query, table);
                connection.query(query, function (err, rows) {
                    if (err) {
                        console.log(err);
                        return;
                    } else {
                        console.log(rows);
                        if(rows.length > 0){
                          if(rows[0].status === 'CONCLUDED'){
                            return;
                          }
                          if(rows[0].userName1===userName1)
                            return
                          if(rows.length == 1){
                            timeStamp = new Date().getTime()/1000;
                            var s = new Date(rows[0].time)
                            var s2 = new Date(s.getTime()+(330*60000));
                            console.log(new Date().getTime(), 'sssss')
                            console.log(s2.getTime())
                            time = matchDuration - ((new Date().getTime() - s2.getTime())/1000);
                            console.log('time', time)
                          } else if(rows.length > 1) {
                            timeStamp = new Date().getTime()/1000;
                            last_remaining_time = rows[1].minute_left;
                             var s = new Date(rows[0].time)
                            var s2 = new Date(s.getTime()+(330*60000));
                            time = last_remaining_time - ((new Date().getTime() - s2.getTime())/1000);
                          }
                          console.log(rows[0].time)
                          var s = new Date(rows[0].time)
                          console.log(new Date(s.getTime()+(330*60000)))
                          console.log(new Date())
                        } else {
                          time = matchDuration;
                          timeStamp = new Date().getTime()/1000;
                        }
                    }
                query = "insert into ?? (`userName1`,`userName2`,`eventId`, `matchId`, `challengeId`, `pgn`, `fen`, `time`, `source`, `target`, `status`, `minute_left`) values(?,?,?,?,?,?,?, FROM_UNIXTIME(?), ? ,?, ?, ?)";
                table = ["move" , userName1, userName2, eventId, matchId, challengeId, pgn, fen, timeStamp ,source, target, status, time ];
                query = mysql.format(query, table);
                console.log(query);
                connection.query(query, function (err, rows) {
                    if (err) {
                        console.log("err bitxh", err)
                    } else {
                        connection.commit(function(err) {
                            if (err) { 
                                connection.rollback(function() {
                                    console.log("err2 bitxh", err)
                                });
                            } else {    
                                console.log("succ bitxh", rows)
                            }
                        });
                    }
                })
                if(time<=0){
                  position.gameOver = true
                }else{
                  position.gameOver = false
                }
                                console.log(data.matchId, 'hi', position)

                      // Broadcast the move event to all connected clients
                io.emit(data.matchId, position);
                //Socketio.emit(data.matchId, position)
            });
          });
        }
    }





    } else {
      // Token is invalid, handle accordingly (e.g., emit an error event)
      console.log('Invalid token');
      socket.emit('error', 'Invalid token');
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
