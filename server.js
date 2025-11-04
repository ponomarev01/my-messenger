const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Создаем папки для файлов
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}
if (!fs.existsSync('uploads/voices')) {
  fs.mkdirSync('uploads/voices');
}
if (!fs.existsSync('uploads/files')) {
  fs.mkdirSync('uploads/files');
}
if (!fs.existsSync('uploads/photos')) {
  fs.mkdirSync('uploads/photos');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, 'uploads/voices/');
    } else if (file.mimetype.startsWith('image/')) {
      cb(null, 'uploads/photos/');
    } else {
      cb(null, 'uploads/files/');
    }
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const usersDB = new Map();
const onlineUsers = new Map();
const messages = [];
const calls = new Map();

// Создаем тестовых пользователей
async function createTestUsers() {
  const testUsers = [
    { username: 'user1', password: '123456', color: '#4a76a8' },
    { username: 'user2', password: '123456', color: '#4caf50' },
    { username: 'admin', password: '123456', color: '#9c27b0' }
  ];

  for (const user of testUsers) {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    usersDB.set(user.username, {
      username: user.username,
      password: hashedPassword,
      color: user.color,
      createdAt: new Date()
    });
  }
  console.log('✅ Тестовые пользователи созданы');
}

createTestUsers();

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
      return res.json({ success: false, message: 'Имя должно быть от 3 символов' });
    }
    
    if (password.length < 6) {
      return res.json({ success: false, message: 'Пароль должен быть от 6 символов' });
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
      message: 'Регистрация успешна!' 
    });
    
  } catch (error) {
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
    res.json({ success: false, message: 'Ошибка входа' });
  }
});

// Загрузка голосовых сообщений
app.post('/api/upload-voice', upload.single('voice'), (req, res) => {
  if (!req.file) {
    return res.json({ success: false, message: 'Файл не загружен' });
  }
  
  res.json({ 
    success: true, 
    filename: req.file.filename,
    path: `/uploads/voices/${req.file.filename}`,
    size: req.file.size
  });
});

// Загрузка файлов
app.post('/api/upload-file', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.json({ success: false, message: 'Файл не загружен' });
  }
  
  res.json({ 
    success: true, 
    filename: req.file.filename,
    originalName: req.file.originalname,
    path: `/uploads/files/${req.file.filename}`,
    size: req.file.size,
    type: req.file.mimetype
  });
});

// Загрузка фото
app.post('/api/upload-photo', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.json({ success: false, message: 'Фото не загружено' });
  }
  
  res.json({ 
    success: true, 
    filename: req.file.filename,
    path: `/uploads/photos/${req.file.filename}`,
    size: req.file.size
  });
});

io.on('connection', (socket) => {
  console.log('✅ Новое подключение:', socket.id);

  socket.on('user_online', (userData) => {
    onlineUsers.set(socket.id, {
      username: userData.username,
      socketId: socket.id,
      color: userData.color,
      avatar: userData.avatar
    });
    
    socket.broadcast.emit('user_joined', userData.username);
    updateOnlineUsers();
  });

  // Звонки
  socket.on('call_user', (data) => {
    const targetUser = Array.from(onlineUsers.values()).find(u => u.username === data.to);
    if (targetUser) {
      const callId = 'call_' + Date.now();
      calls.set(callId, {
        id: callId,
        from: data.from,
        to: data.to,
        fromSocketId: socket.id,
        toSocketId: targetUser.socketId,
        type: data.type,
        status: 'calling'
      });
      
      socket.to(targetUser.socketId).emit('incoming_call', {
        from: data.from,
        fromSocketId: socket.id,
        type: data.type,
        callId: callId
      });
      
      socket.emit('call_initiated', { 
        to: data.to,
        callId: callId 
      });
    } else {
      socket.emit('call_failed', { reason: 'Пользователь не в сети' });
    }
  });

  socket.on('accept_call', (data) => {
    const call = calls.get(data.callId);
    if (call) {
      call.status = 'active';
      socket.to(call.fromSocketId).emit('call_accepted', {
        targetSocketId: socket.id,
        callId: data.callId
      });
    }
  });

  socket.on('reject_call', (data) => {
    const call = calls.get(data.callId);
    if (call) {
      socket.to(call.fromSocketId).emit('call_rejected');
      calls.delete(data.callId);
    }
  });

  socket.on('end_call', (data) => {
    const call = calls.get(data.callId);
    if (call) {
      socket.to(call.fromSocketId).emit('call_ended');
      if (call.toSocketId) {
        socket.to(call.toSocketId).emit('call_ended');
      }
      calls.delete(data.callId);
    }
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
  socket.on('send_voice_message', (data) => {
    const message = {
      id: Date.now(),
      sender: data.sender,
      type: 'voice',
      voiceUrl: data.voiceUrl,
      duration: data.duration,
      timestamp: new Date()
    };
    messages.push(message);
    socket.broadcast.emit('new_voice_message', message);
  });

  // Файлы
  socket.on('send_file_message', (data) => {
    const message = {
      id: Date.now(),
      sender: data.sender,
      type: 'file',
      fileName: data.fileName,
      fileUrl: data.fileUrl,
      fileSize: data.fileSize,
      fileType: data.fileType,
      timestamp: new Date()
    };
    messages.push(message);
    socket.broadcast.emit('new_file_message', message);
  });

  // Фото
  socket.on('send_photo_message', (data) => {
    const message = {
      id: Date.now(),
      sender: data.sender,
      type: 'photo',
      photoUrl: data.photoUrl,
      timestamp: new Date()
    };
    messages.push(message);
    socket.broadcast.emit('new_photo_message', message);
  });

  // Сообщения
  socket.on('send_message', (data) => {
    const message = {
      id: Date.now(),
      sender: data.sender,
      text: data.text,
      timestamp: new Date(),
      type: 'text'
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
      color: u.color,
      avatar: u.avatar
    }));
    io.emit('users_online', onlineUsersList);
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
