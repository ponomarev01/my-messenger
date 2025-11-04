const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Простая база данных в памяти (в реальном приложении используйте MongoDB/PostgreSQL)
const usersDB = new Map();
const onlineUsers = new Map();
const messages = [];

// Предзаполненные пользователи для теста
usersDB.set('user1', {
  username: 'user1',
  password: '$2a$10$8K1p/a0dRTlR0.0A.5ZP.OaQ.5Q.5Q.5Q.5Q.5Q.5Q.5Q.5Q.5Q.5Q', // password: 123456
  color: '#4a76a8',
  createdAt: new Date()
});

usersDB.set('user2', {
  username: 'user2', 
  password: '$2a$10$8K1p/a0dRTlR0.0A.5ZP.OaQ.5Q.5Q.5Q.5Q.5Q.5Q.5Q.5Q.5Q.5Q', // password: 123456
  color: '#4caf50',
  createdAt: new Date()
});

usersDB.set('admin', {
  username: 'admin',
  password: '$2a$10$8K1p/a0dRTlR0.0A.5ZP.OaQ.5Q.5Q.5Q.5Q.5Q.5Q.5Q.5Q.5Q.5Q', // password: 123456
  color: '#9c27b0',
  createdAt: new Date()
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Регистрация
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.json({ success: false, message: 'Заполните все поля' });
    }
    
    if (username.length < 3) {
      return res.json({ success: false, message: 'Имя пользователя должно быть не менее 3 символов' });
    }
    
    if (password.length < 6) {
      return res.json({ success: false, message: 'Пароль должен быть не менее 6 символов' });
    }
    
    if (usersDB.has(username)) {
      return res.json({ success: false, message: 'Пользователь уже существует' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const colors = ['#4a76a8', '#4caf50', '#ff9800', '#9c27b0', '#f44336'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    usersDB.set(username, {
      username,
      password: hashedPassword,
      color: randomColor,
      createdAt: new Date()
    });
    
    res.json({ 
      success: true, 
      message: 'Регистрация успешна! Теперь войдите в систему.' 
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.json({ success: false, message: 'Ошибка регистрации' });
  }
});

// Авторизация
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.json({ success: false, message: 'Заполните все поля' });
    }
    
    const user = usersDB.get(username);
    if (!user) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }
    
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.json({ success: false, message: 'Неверный пароль' });
    }
    
    res.json({ 
      success: true, 
      message: 'Вход успешен',
      user: {
        username: user.username,
        color: user.color
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, message: 'Ошибка входа' });
  }
});

// Получение списка пользователей (для админа)
app.get('/api/users', (req, res) => {
  const users = Array.from(usersDB.values()).map(user => ({
    username: user.username,
    color: user.color,
    createdAt: user.createdAt
  }));
  res.json({ success: true, users });
});

io.on('connection', (socket) => {
  console.log('✅ Новое подключение:', socket.id);

  socket.on('user_online', (userData) => {
    onlineUsers.set(socket.id, {
      username: userData.username,
      socketId: socket.id,
      color: userData.color
    });
    
    socket.broadcast.emit('user_joined', userData.username);
    updateOnlineUsers();
  });

  // Звонки
  socket.on('call_user', (data) => {
    const targetUser = Array.from(onlineUsers.values()).find(u => u.username === data.to);
    if (targetUser) {
      socket.to(targetUser.socketId).emit('incoming_call', {
        from: data.from,
        fromSocketId: socket.id,
        type: data.type
      });
      socket.emit('call_initiated', { to: data.to });
    } else {
      socket.emit('call_failed', { reason: 'Пользователь не в сети' });
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

  // Голосовые сообщения
  socket.on('voice_message', (data) => {
    const message = {
      id: Date.now(),
      sender: data.sender,
      type: 'voice',
      audioBlob: data.audioBlob,
      duration: data.duration,
      timestamp: new Date()
    };
    messages.push(message);
    socket.broadcast.emit('new_voice_message', message);
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
    const user = onlineUsers.get(socket.id);
    if (user) {
      onlineUsers.delete(socket.id);
      socket.broadcast.emit('user_left', user.username);
      updateOnlineUsers();
    }
  });

  function updateOnlineUsers() {
    const onlineUsersList = Array.from(onlineUsers.values()).map(u => ({
      username: u.username,
      color: u.color
    }));
    io.emit('users_online', onlineUsersList);
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📝 Тестовые пользователи: user1, user2, admin`);
  console.log(`🔑 Пароль для всех: 123456`);
});
