const { cmd } = require('../lib/command');
const config = require('../config');
const fs = require("fs-extra");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const mime = require("mime-types");
const path = require("path");
const MegaStorage = require('../mega-storage');
const chalk = require('chalk');

const apiId = config.telegram.apiId;
const apiHash = config.telegram.apiHash;
const group = config.telegram.group;

const sessionFile = config.telegram.sessionFile;
let sessionString = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, "utf8") : "";
const stringSession = new StringSession(sessionString);

// Temp store for PIN request
let waitingForCode = {};

// Initialize Mega storage for downloads
const megaStorage = new MegaStorage(config.mega.email, config.mega.password);

cmd({
    pattern: "telegram",
    react: "📥",
    desc: "Download file from Telegram group and send to WhatsApp",
    category: "download",
    filename: __filename
}, async (bot, mek, m, { from, q, reply, pushname }) => {
    if (!q) return reply(`❌ *Usage:* ${config.bot.prefix}telegram <file name>\n\n*Example:* ${config.bot.prefix}telegram Oppenheimer`);

    await reply("⏳ *Connecting to Telegram...*");

    try {
        const client = new TelegramClient(stringSession, Number(apiId), apiHash, {
            connectionRetries: 5,
            timeout: 30000
        });

        // First login (session not exists)
        if (!sessionString) {
            await client.start({
                phoneNumber: async () => config.telegram.defaultNumber,
                password: async () => "", // Add if you have 2FA
                phoneCode: async () => {
                    await reply("📱 *Please reply with your Telegram verification code*\n*Example:* .code 12345\n\n_Check your Telegram app for the code_");
                    return await new Promise((resolve) => {
                        waitingForCode[from] = resolve;
                    });
                },
                onError: (err) => {
                    console.log("Login error:", err);
                    reply("❌ *Telegram login error:* " + err.message);
                }
            });

            console.log(chalk.green("✅ Telegram login successful!"));
            const newSession = client.session.save();
            fs.writeFileSync(sessionFile, newSession, "utf8");
            await reply("✅ *Telegram login successful!*\n_Now searching for your file..._");
        } else {
            await client.connect();
        }

        // Search message in Telegram group
        await reply("🔍 *Searching for file in Telegram group...*");
        
        // Try to get group entity
        let groupEntity;
        try {
            groupEntity = await client.getEntity(group);
        } catch (e) {
            groupEntity = group; // Use as string if entity fetch fails
        }
        
        const messages = await client.getMessages(groupEntity, { 
            search: q, 
            limit: 10,
            filter: { className: 'InputMessagesFilterDocument' } // Filter for documents only
        });
        
        if (!messages.length) {
            return reply("❌ *File not found in Telegram group!*\n_Try a different search term_");
        }

        // Filter messages with media
        const mediaMessages = messages.filter(msg => msg.media);
        
        if (mediaMessages.length === 0) {
            return reply("❌ *No media found with that name!*");
        }

        // Let user select if multiple files found
        let selectedMsg = mediaMessages[0];
        
        if (mediaMessages.length > 1) {
            let fileList = "*Multiple files found:*\n\n";
            mediaMessages.slice(0, 5).forEach((msg, index) => {
                const fileName = msg.media?.document?.attributes?.find(a => a.fileName)?.fileName || `File ${index + 1}`;
                const fileSize = msg.media?.document?.size || 0;
                fileList += `${index + 1}. 📁 ${fileName} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)\n`;
            });
            fileList += `\n_Sending the first file. Use more specific search term for better results._`;
            await reply(fileList);
        }

        const msg = selectedMsg;

        // Get filename
        let fileName = msg.media?.document?.attributes?.find(a => a.fileName)?.fileName || 
                      msg.message || 
                      q + ".mp4";
        
        // Clean filename
        fileName = fileName.replace(/[^\w\s.-]/gi, '');

        let ext = path.extname(fileName);
        if (!ext) ext = ".mp4";
        if (!fileName.endsWith(ext)) fileName += ext;
        
        let mimeType = mime.lookup(ext) || "application/octet-stream";

        // File size check (2GB max)
        const fileSize = msg.media?.document?.size || 0;
        if (fileSize > config.bot.maxFileSize) {
            return reply(`❌ *File is too large!*\nSize: ${(fileSize / (1024 * 1024 * 1024)).toFixed(2)}GB\nMax: 2GB`);
        }

        await reply(`📥 *Downloading from Telegram...*\n📁 *File:* ${fileName}\n📦 *Size:* ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);

        // Download from Telegram
        const buffer = await client.downloadMedia(msg, {
            workers: 1,
            progressCallback: (received, total) => {
                if (received % (1024 * 1024 * 10) === 0) { // Log every 10MB
                    console.log(`Download progress: ${(received / (1024 * 1024)).toFixed(2)}MB / ${(total / (1024 * 1024)).toFixed(2)}MB`);
                }
            }
        });

        // Save to Mega as backup
        try {
            await megaStorage.connect();
            await megaStorage.saveFile(fileName, buffer);
        } catch (e) {
            console.log("Mega backup failed:", e.message);
        }

        // Create caption with footer
        const caption = `╭━━━〔 *EVO MD TG BOT* 〕━━━╮
┃
┃ 📁 *File:* ${fileName}
┃ 📦 *Size:* ${(fileSize / (1024 * 1024)).toFixed(2)} MB
┃ 📤 *Source:* Telegram Group
┃ 👤 *Requested by:* ${pushname || 'User'}
┃
╰━━━━━━━━━━━━━━━━╯
${config.bot.footer}`;

        // Send to WhatsApp
        if (fileSize > 100 * 1024 * 1024) { // > 100MB
            await bot.sendMessage(from, { 
                document: buffer,
                mimetype: mimeType,
                fileName: fileName,
                caption: caption
            }, { quoted: mek });
        } else {
            await bot.sendMessage(from, { 
                document: buffer,
                mimetype: mimeType,
                fileName: fileName,
                caption: caption
            }, { quoted: mek });
        }

        await reply("✅ *File sent successfully!*");
        
        // Disconnect client to save resources
        await client.disconnect();

    } catch (e) {
        console.error(e);
        reply("❌ *Error:* " + e.message);
    }
});

// Export waitingForCode for use in code command
module.exports = { waitingForCode };
