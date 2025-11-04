const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Настройка CORS для Vercel
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname)));
app.use(express.json());

const users = new Map();
const messages = [];

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('✅ Новое подключение:', socket.id);

    socket.on('user_online', (userData) => {
        users.set(socket.id, {
            username: userData.username,
            socketId: socket.id,
            color: userData.color || '#4a76a8'
        });
        
        socket.broadcast.emit('user_joined', userData.username);
        updateOnlineUsers();
    });

    // Звонки
    socket.on('call_user', (data) => {
        const targetUser = Array.from(users.values()).find(u => u.username === data.to);
        if (targetUser) {
            socket.to(targetUser.socketId).emit('incoming_call', {
                from: data.from,
                fromSocketId: socket.id,
                type: data.type
            });
        }
    });

    socket.on('accept_call', (data) => {
        socket.to(data.fromSocketId).emit('call_accepted', {
            targetSocketId: socket.id
        });
    });

    socket.on('reject_call', (data) => {
        socket.to(data.fromSocketId).emit('call_rejected');
    });

    socket.on('end_call', (targetSocketId) => {
        socket.to(targetSocketId).emit('call_ended');
    });

    // WebRTC
    socket.on('webrtc_offer', (data) => {
        socket.to(data.target).emit('webrtc_offer', data);
    });

    socket.on('webrtc_answer', (data) => {
        socket.to(data.target).emit('webrtc_answer', data);
    });

    socket.on('webrtc_ice_candidate', (data) => {
        socket.to(data.target).emit('webrtc_ice_candidate', data);
    });

    // Сообщения
    socket.on('send_message', (data) => {
        const message = {
            id: Date.now(),
            sender: data.sender,
            text: data.text,
            timestamp: new Date(),
            type: data.type || 'text'
        };
        messages.push(message);
        socket.broadcast.emit('new_message', message);
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            users.delete(socket.id);
            socket.broadcast.emit('user_left', user.username);
            updateOnlineUsers();
        }
    });

    function updateOnlineUsers() {
        const onlineUsers = Array.from(users.values()).map(u => ({
            username: u.username,
            color: u.color
        }));
        io.emit('users_online', onlineUsers);
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});

module.exports = app;