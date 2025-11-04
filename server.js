const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Для Vercel нужно использовать Serverless с Socket.io
app.use(express.static(path.join(__dirname)));
app.use(express.json());

const users = new Map();
const messages = [];

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API эндпоинты вместо WebSocket
app.post('/api/user-online', (req, res) => {
  const { username, color } = req.body;
  // Здесь будет логика онлайн пользователей
  res.json({ success: true });
});

app.post('/api/send-message', (req, res) => {
  const { sender, text } = req.body;
  const message = {
    id: Date.now(),
    sender: sender,
    text: text,
    timestamp: new Date()
  };
  messages.push(message);
  res.json({ success: true, message: message });
});

app.get('/api/messages', (req, res) => {
  res.json({ success: true, messages: messages });
});

app.get('/api/online-users', (req, res) => {
  const onlineUsers = Array.from(users.values()).map(u => ({
    username: u.username,
    color: u.color
  }));
  res.json({ success: true, users: onlineUsers });
});

// Для звонков - заглушки
app.post('/api/call-user', (req, res) => {
  res.json({ success: true, message: 'Call feature disabled on Vercel' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});

module.exports = app;
