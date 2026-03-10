const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');
const express = require('express');
const MegaStorage = require('./mega-storage');
const config = require('./config');
const cfonts = require('cfonts');
const keepAlive = require('./keep-alive');

// Initialize Express for Replit web server
const app = express();
const PORT = process.env.PORT || 3000;

// Display banner
cfonts.say('EVO MD|TG BOT', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'magenta'],
    background: 'black',
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: '0'
});

console.log(chalk.cyan('╔════════════════════════════════════╗'));
console.log(chalk.cyan('║     Evo MD Telegram Bot v2.0       ║'));
console.log(chalk.cyan('║     Optimized for Replit           ║'));
console.log(chalk.cyan('╚════════════════════════════════════╝\n'));

// Initialize Mega storage
const megaStorage = new MegaStorage(
    config.mega.email,
    config.mega.password
);

// Ensure auth directory exists
fs.ensureDirSync('./auth_info_baileys');

// Global variables
let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// Web server endpoints for Replit
app.get('/', (req, res) => {
    const status = sock?.user ? '🟢 Connected' : '🟡 Connecting';
    res.json({
        status: status,
        botName: config.bot.name,
        version: '2.0.0',
        platform: 'Replit',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        session: fs.existsSync('./auth_info_baileys/creds.json') ? '✅ Active' : '❌ Not found'
    });
});

app.get('/status', (req, res) => {
    res.json({
        connected: !!sock?.user,
        user: sock?.user,
        mega: megaStorage.storage ? '✅ Connected' : '❌ Disconnected',
        commands: fs.readdirSync('./commands').length
    });
});

app.get('/qr', (req, res) => {
    res.sendFile(path.join(__dirname, 'auth_info_baileys', 'qr-code.png'));
});

// Start web server
app.listen(PORT, () => {
    console.log(chalk.green(`✓ Web server running on port ${PORT}`));
    console.log(chalk.blue(`📊 Status page: http://localhost:${PORT}`));
});

// Keep Replit alive
keepAlive();

async function connectToWhatsApp() {
    try {
        console.log(chalk.yellow('🔄 Connecting to WhatsApp...'));
        
        // Load auth state from Mega
        let { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

        // Try to sync with Mega
        try {
            const megaState = await megaStorage.loadAuthState();
            if (megaState) {
                state = megaState.state;
                saveCreds = megaState.saveCreds;
                console.log(chalk.green('✓ Session loaded from Mega'));
            }
        } catch (error) {
            console.log(chalk.yellow('! Using local session only:', error.message));
        }

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' }),
            browser: ['Evo MD TG Bot', 'Replit', '2.0.0'],
            syncFullHistory: true,
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            defaultQueryTimeoutMs: 60000
        });

        // Save credentials to Mega periodically
        setInterval(async () => {
            try {
                if (fs.existsSync('./auth_info_baileys/creds.json')) {
                    const sessionData = await fs.readJSON('./auth_info_baileys/creds.json');
                    await megaStorage.saveAuthState({ creds: sessionData });
                    console.log(chalk.blue('✓ Session synced to Mega'));
                }
            } catch (error) {
                console.log(chalk.red('Failed to sync to Mega:', error.message));
            }
        }, 60000); // Every minute

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log(chalk.green('\n✓ Scan this QR code with WhatsApp'));
                // Save QR as image for Replit web view
                const QRCode = require('qrcode');
                QRCode.toFile('./auth_info_baileys/qr-code.png', qr);
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(chalk.red('Connection closed. Reconnecting:', shouldReconnect));
                
                if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    console.log(chalk.yellow(`Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`));
                    setTimeout(connectToWhatsApp, 5000 * reconnectAttempts);
                } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.log(chalk.red('Max reconnection attempts reached. Please check your connection.'));
                } else {
                    console.log(chalk.red('Logged out. Please delete session and restart'));
                    process.exit(0);
                }
            } else if (connection === 'open') {
                reconnectAttempts = 0;
                console.log(chalk.green('✓ Connected to WhatsApp successfully'));
                console.log(chalk.cyan(`✓ Logged in as: ${sock.user?.name || 'Unknown'}`));
                
                // Set bot status
                await sock.sendPresenceUpdate('available');
                
                // Save session to Mega
                try {
                    const sessionData = await fs.readJSON('./auth_info_baileys/creds.json');
                    await megaStorage.saveAuthState({ creds: sessionData });
                } catch (error) {}
            }
        });

        // Load all commands
        const commands = new Map();
        const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
        
        for (const file of commandFiles) {
            try {
                const command = require(`./commands/${file}`);
                if (command.pattern) {
                    commands.set(command.pattern, command);
                    console.log(chalk.gray(`✓ Loaded command: ${command.pattern}`));
                }
            } catch (error) {
                console.log(chalk.red(`Failed to load command ${file}:`, error.message));
            }
        }

        console.log(chalk.green(`✓ Loaded ${commands.size} commands`));

        // Message handler
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type === 'notify') {
                for (const msg of messages) {
                    if (!msg.key.fromMe && msg.message) {
                        const messageContent = msg.message?.conversation || 
                                              msg.message?.extendedTextMessage?.text || 
                                              msg.message?.imageMessage?.caption || '';
                        
                        if (messageContent.startsWith(config.bot.prefix)) {
                            const args = messageContent.slice(config.bot.prefix.length).trim().split(/ +/);
                            const commandName = args.shift().toLowerCase();
                            
                            // Find matching command
                            for (const [pattern, command] of commands) {
                                if (commandName === pattern || (command.pattern && commandName.match(new RegExp(pattern)))) {
                                    try {
                                        console.log(chalk.blue(`Executing command: ${commandName}`));
                                        await command.execute(sock, msg, msg, { 
                                            from: msg.key.remoteJid, 
                                            q: args.join(' '), 
                                            reply: async (text) => {
                                                await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
                                            },
                                            args: args,
                                            pushname: msg.pushName || 'User',
                                            prefix: config.bot.prefix
                                        });
                                    } catch (error) {
                                        console.error('Command error:', error);
                                        await sock.sendMessage(msg.key.remoteJid, { 
                                            text: `❌ Error: ${error.message}` 
                                        }, { quoted: msg });
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        });

        return sock;
    } catch (error) {
        console.error(chalk.red('Fatal error:', error));
        setTimeout(connectToWhatsApp, 10000);
    }
}

// Start the bot
connectToWhatsApp();

// Handle process termination
process.on('SIGINT', async () => {
    console.log(chalk.yellow('\nShutting down...'));
    try {
        if (fs.existsSync('./auth_info_baileys/creds.json')) {
            const sessionData = await fs.readJSON('./auth_info_baileys/creds.json');
            await megaStorage.saveAuthState({ creds: sessionData });
            console.log(chalk.green('✓ Final session saved to Mega'));
        }
    } catch (error) {
        console.log(chalk.red('Failed to save final session:', error.message));
    }
    process.exit(0);
});
