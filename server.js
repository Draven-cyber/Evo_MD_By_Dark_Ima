const express = require('express');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs-extra');
const chalk = require('chalk');
const MegaStorage = require('./mega-storage');
const config = require('./config');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const bodyParser = require('body-parser');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  secret: 'evo-md-tg-bot-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Initialize Mega storage
const megaStorage = new MegaStorage(
  config.mega.email,
  config.mega.password
);

// Ensure directories exist
fs.ensureDirSync('./auth_info_baileys');
fs.ensureDirSync('./public/images');
fs.ensureDirSync('./public/css');
fs.ensureDirSync('./public/js');
fs.ensureDirSync('./public/webfonts');

// Store active pairing sessions
const activeSessions = new Map();

// ============================================
// ROUTES
// ============================================

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Pairing page
app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

// Dashboard page
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API Routes
app.get('/api/status', async (req, res) => {
  try {
    const sessionExists = fs.existsSync('./auth_info_baileys/creds.json');
    const megaConnected = megaStorage.storage ? true : false;
    
    res.json({
      success: true,
      status: 'online',
      session: sessionExists ? 'active' : 'inactive',
      mega: megaConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    // Get bot stats
    const sessionDir = './auth_info_baileys';
    const files = fs.readdirSync(sessionDir);
    const sessionFiles = files.filter(f => f.endsWith('.json') || f.endsWith('.txt'));
    
    // Get Mega storage stats
    let megaFiles = [];
    try {
      megaFiles = await megaStorage.listDownloads();
    } catch (e) {
      console.log('Mega stats error:', e.message);
    }
    
    res.json({
      success: true,
      stats: {
        sessionFiles: sessionFiles.length,
        megaFiles: megaFiles.length,
        totalDownloads: megaFiles.length,
        lastSync: new Date().toISOString()
      }
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/pair/request', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.json({ success: false, error: 'Phone number is required' });
    }
    
    // Clean phone number
    let cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (!cleanNumber.startsWith('94')) {
      cleanNumber = '94' + cleanNumber.replace(/^0/, '');
    }
    
    // Generate session ID
    const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    // Store session
    activeSessions.set(sessionId, {
      phoneNumber: cleanNumber,
      status: 'pending',
      code: null,
      createdAt: new Date()
    });
    
    // Start pairing process in background
    startPairingProcess(sessionId, cleanNumber, io);
    
    res.json({
      success: true,
      sessionId: sessionId,
      message: 'Pairing request received. Check the pairing page for updates.'
    });
    
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/pair/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  
  if (!session) {
    return res.json({ success: false, error: 'Session not found' });
  }
  
  res.json({
    success: true,
    status: session.status,
    code: session.code,
    phoneNumber: session.phoneNumber
  });
});

// ============================================
// SOCKET.IO for real-time updates
// ============================================

io.on('connection', (socket) => {
  console.log(chalk.green('✓ New client connected to socket'));
  
  socket.on('join-pairing', (sessionId) => {
    socket.join(`pairing-${sessionId}`);
    console.log(chalk.blue(`Socket joined room: pairing-${sessionId}`));
  });
  
  socket.on('disconnect', () => {
    console.log(chalk.yellow('Client disconnected from socket'));
  });
});

// ============================================
// PAIRING FUNCTION
// ============================================

async function startPairingProcess(sessionId, phoneNumber, io) {
  try {
    console.log(chalk.blue(`Starting pairing for ${phoneNumber} (Session: ${sessionId})`));
    
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: ['Evo MD TG Bot', 'Chrome', '3.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    // Request pairing code
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        const formattedCode = code.match(/.{1,4}/g).join('-');
        
        console.log(chalk.green(`✓ Pairing code for ${phoneNumber}: ${formattedCode}`));
        
        // Update session
        const session = activeSessions.get(sessionId);
        if (session) {
          session.status = 'code_generated';
          session.code = formattedCode;
          activeSessions.set(sessionId, session);
        }
        
        // Emit to socket room
        io.to(`pairing-${sessionId}`).emit('pairing-code', {
          code: formattedCode,
          phoneNumber: phoneNumber
        });
        
        // Save code to file
        await fs.writeFile(`./auth_info_baileys/pairing_${sessionId}.txt`, formattedCode);
        
        // Save to Mega
        try {
          await megaStorage.connect();
          const sessionData = await fs.readJSON('./auth_info_baileys/creds.json');
          await megaStorage.saveAuthState({ creds: sessionData });
          console.log(chalk.green('✓ Session saved to Mega'));
        } catch (error) {
          console.log(chalk.yellow('! Failed to save to Mega:', error.message));
        }
        
        // Update status after 2 minutes
        setTimeout(() => {
          const session = activeSessions.get(sessionId);
          if (session && session.status === 'code_generated') {
            session.status = 'expired';
            activeSessions.set(sessionId, session);
            io.to(`pairing-${sessionId}`).emit('pairing-expired', {
              message: 'Pairing code expired. Please try again.'
            });
          }
        }, 120000); // 2 minutes
        
      } catch (error) {
        console.log(chalk.red('Error generating pairing code:', error.message));
        
        const session = activeSessions.get(sessionId);
        if (session) {
          session.status = 'error';
          session.error = error.message;
          activeSessions.set(sessionId, session);
        }
        
        io.to(`pairing-${sessionId}`).emit('pairing-error', {
          error: error.message
        });
      }
    }, 2000);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      
      if (connection === 'open') {
        console.log(chalk.green(`✓ Successfully paired with ${phoneNumber}`));
        
        const session = activeSessions.get(sessionId);
        if (session) {
          session.status = 'connected';
          activeSessions.set(sessionId, session);
        }
        
        io.to(`pairing-${sessionId}`).emit('pairing-success', {
          message: 'Successfully connected to WhatsApp!'
        });
        
        // Clean up after 30 seconds
        setTimeout(() => {
          activeSessions.delete(sessionId);
        }, 30000);
      }
      
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (!shouldReconnect) {
          console.log(chalk.red(`Logged out from ${phoneNumber}`));
          
          const session = activeSessions.get(sessionId);
          if (session) {
            session.status = 'logged_out';
            activeSessions.set(sessionId, session);
          }
          
          io.to(`pairing-${sessionId}`).emit('pairing-logout', {
            message: 'Logged out from WhatsApp'
          });
        }
      }
    });

  } catch (error) {
    console.error(chalk.red('Pairing process error:', error));
    
    const session = activeSessions.get(sessionId);
    if (session) {
      session.status = 'error';
      session.error = error.message;
      activeSessions.set(sessionId, session);
    }
    
    io.to(`pairing-${sessionId}`).emit('pairing-error', {
      error: error.message
    });
  }
}

// ============================================
// CLEANUP OLD SESSIONS
// ============================================

setInterval(() => {
  const now = new Date();
  for (const [sessionId, session] of activeSessions.entries()) {
    // Remove sessions older than 10 minutes
    if (now - session.createdAt > 10 * 60 * 1000) {
      activeSessions.delete(sessionId);
      console.log(chalk.yellow(`Cleaned up old session: ${sessionId}`));
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// ============================================
// START SERVER
// ============================================

server.listen(PORT, () => {
  console.log(chalk.magenta('╔════════════════════════════════════╗'));
  console.log(chalk.magenta('║    Evo MD TG Bot - Web Server     ║'));
  console.log(chalk.magenta('╚════════════════════════════════════╝\n'));
  
  console.log(chalk.cyan(`🌐 Web server running on: http://localhost:${PORT}`));
  console.log(chalk.cyan(`📱 Pairing page: http://localhost:${PORT}/pair`));
  console.log(chalk.cyan(`📊 Dashboard: http://localhost:${PORT}/dashboard\n`));
  
  // Create default logo if not exists
  createDefaultLogo();
});

// Create default logo function
function createDefaultLogo() {
  const logoPath = path.join(__dirname, 'public', 'images', 'logo.png');
  if (!fs.existsSync(logoPath)) {
    // You can add a default logo creation logic here
    console.log(chalk.yellow('⚠ No logo found. Please add your logo to public/images/logo.png'));
  }
}

console.log(chalk.green('✓ Bot web interface loaded successfully'));
