const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Database setup
const db = new sqlite3.Database('chat.db');
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT,
    username TEXT,
    message TEXT,
    timestamp TEXT
  )
`);

app.use(express.static(path.join(__dirname, 'public')));

const users = {}; // socket.id => { username, room }

function sendActiveRooms() {
  db.all('SELECT DISTINCT room FROM messages', [], (err, rows) => {
    if (!err) {
      const rooms = rows.map(r => r.room);
      io.emit('active rooms', rooms);
    }
  });
}

io.on('connection', (socket) => {
  console.log('A user connected');

  // User joins room
  socket.on('join room', ({ username, room }) => {
    socket.join(room);
    users[socket.id] = { username, room };

    socket.to(room).emit('user joined', username);

    // Send chat history from the room
    db.all(
      'SELECT username, message, timestamp FROM messages WHERE room = ? ORDER BY timestamp ASC',
      [room],
      (err, rows) => {
        if (!err) {
          socket.emit('chat history', rows);
        }
      }
    );

    sendActiveRooms();
  });

  // User leaves room
  socket.on('leave room', ({ username, room }) => {
    socket.leave(room);
    socket.to(room).emit('user left', username);
  });

  // Save and broadcast chat message
  socket.on('chat message', ({ username, message }) => {
    const user = users[socket.id];
    if (user && user.room) {
      const timestamp = new Date().toISOString();
      db.run(
        'INSERT INTO messages (room, username, message, timestamp) VALUES (?, ?, ?, ?)',
        [user.room, username, message, timestamp],
        (err) => {
          if (err) {
            console.error('DB error:', err);
          } else {
            io.to(user.room).emit('chat message', {
              username,
              message,
              timestamp
            });
          }
        }
      );
    }
  });

  // Delete messages in a room
  socket.on('delete messages', ({ room }) => {
    db.run('DELETE FROM messages WHERE room = ?', [room], (err) => {
      if (!err) {
        io.to(room).emit('messages deleted', room);
      }
    });
  });

  // User disconnects
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      socket.to(user.room).emit('user left', user.username);
      delete users[socket.id];
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
