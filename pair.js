const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const chalk = require('chalk');
const fs = require('fs-extra');
const readline = require('readline');
const MegaStorage = require('./mega-storage');
const config = require('./config');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log(chalk.cyan('╔════════════════════════════════════╗'));
console.log(chalk.cyan('║     Evo MD TG Bot - Pair Code      ║'));
console.log(chalk.cyan('║         Optimized for Replit        ║'));
console.log(chalk.cyan('╚════════════════════════════════════╝\n'));

const megaStorage = new MegaStorage(config.mega.email, config.mega.password);

async function question(text) {
    return new Promise((resolve) => rl.question(text, resolve));
}

async function startPair() {
    try {
        // Ensure auth directory exists
        await fs.ensureDir('./auth_info_baileys');
        
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
        
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['Evo MD TG Bot', 'Replit', '2.0.0'],
        });

        sock.ev.on('creds.update', saveCreds);

        let phoneNumber = await question(chalk.yellow('Enter your phone number (with country code, e.g., 94716480935): '));
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        if (!phoneNumber.startsWith('94')) {
            phoneNumber = '94' + phoneNumber.replace(/^0/, '');
        }

        console.log(chalk.blue('\n📱 Requesting pairing code...'));

        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(chalk.green('\n✓ Your pairing code:'));
                console.log(chalk.bold.cyan('\n' + code.match(/.{1,4}/g).join('-') + '\n'));
                
                // Save to file
                await fs.writeFile('./auth_info_baileys/pairing_code.txt', code);
                console.log(chalk.green('✓ Pairing code saved to auth_info_baileys/pairing_code.txt'));
                
                // Save to Mega
                try {
                    await megaStorage.connect();
                    if (fs.existsSync('./auth_info_baileys/creds.json')) {
                        const sessionData = await fs.readJSON('./auth_info_baileys/creds.json');
                        await megaStorage.saveAuthState({ creds: sessionData });
                        console.log(chalk.green('✓ Session saved to Mega'));
                    }
                } catch (error) {
                    console.log(chalk.yellow('! Failed to save to Mega:', error.message));
                }
                
                console.log(chalk.yellow('\n📱 Now you can start the bot with: npm start'));
                rl.close();
                process.exit(0);
            } catch (error) {
                console.log(chalk.red('Error getting pairing code:', error.message));
                rl.close();
                process.exit(1);
            }
        }, 2000);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log(chalk.yellow('Reconnecting...'));
                } else {
                    console.log(chalk.red('\nConnection closed. Please try again.'));
                    process.exit(0);
                }
            }
        });

    } catch (error) {
        console.error(chalk.red('Error:', error));
        process.exit(1);
    }
}

startPair();
