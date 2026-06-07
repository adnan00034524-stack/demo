require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const whatsapp = require('./whatsapp');
const { handleIncomingMessage } = require('./agent');
const RagClient = require('./ragClient');
const DocumentManager = require('./documentManager');

const settingsRoutes = require('./routes/settings');
const faqsRoutes = require('./routes/faqs');
const whatsappRoutes = require('./routes/whatsapp');
const simulatorRoutes = require('./routes/simulator');
const documentsRoutes = require('./routes/documents');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

app.use('/api/settings', settingsRoutes);
app.use('/api/faqs', faqsRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/simulator', simulatorRoutes);
app.use('/api/documents', documentsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', whatsappState: whatsapp.getState() });
});

io.on('connection', (socket) => {
  console.log('Frontend connected:', socket.id);
  // Send current state immediately so they don't miss QR
  const currentState = whatsapp.getState();
  const lastState = whatsapp.lastEmittedState();
  if (currentState === 'SCAN_QR' && lastState) {
    socket.emit('status-update', lastState);
  } else {
    socket.emit('status-update', { status: currentState });
  }
  socket.on('connect-whatsapp', () => {
    console.log('Connect WhatsApp requested by frontend');
    whatsapp.destroy();
    setTimeout(() => whatsapp.initClient(), 1000);
  });
  socket.on('disconnect', () => {
    console.log('Frontend disconnected:', socket.id);
  });
});

whatsapp.setSocketIO(io);
global.io = io;

const ragClient = new RagClient();
global.ragClient = ragClient;
global.documentManager = new DocumentManager(ragClient);

whatsapp.onMessage(handleIncomingMessage);

const PORT = process.env.PORT || 5000;

async function start() {
  console.log('Database: data.db (SQLite + FTS5)');
  await ragClient.init();
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    whatsapp.initClient();
  });
}

start().catch(err => {
  console.error('Server startup error:', err.message);
  process.exit(1);
});
