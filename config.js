module.exports = {
    mega: {
        email: process.env.MEGA_EMAIL || 'Rithikaimansara25894@gmail.com',
        password: process.env.MEGA_PASSWORD || 'Rithika25894#'
    },
    telegram: {
        apiId: process.env.TELEGRAM_API_ID || '29145458',
        apiHash: process.env.TELEGRAM_API_HASH || '00b32d6c9f385662edfed86f047b4116',
        group: process.env.TELEGRAM_GROUP || 'https://t.me/your_group',
        defaultNumber: process.env.TELEGRAM_NUMBER || '+94716480935',
        sessionFile: './auth_info_baileys/temp.txt'
    },
    bot: {
        name: process.env.BOT_NAME || 'Evo MD TG Bot',
        prefix: process.env.BOT_PREFIX || '.',
        logo: process.env.BOT_LOGO || 'https://i.ibb.co/your-logo-url/evo-logo.png',
        footer: '\n\n*Join our Evo Movies Official Channel✅*\n> https://chat.whatsapp.com/BtCwNUpJapkHYM5TQ81IGE',
        adminNumbers: (process.env.ADMIN_NUMBERS || '').split(',').map(n => n.trim() + '@s.whatsapp.net'),
        maxFileSize: 2000 * 1024 * 1024 // 2GB
    },
    replit: {
        url: process.env.REPLIT_URL || '',
        db: process.env.REPLIT_DB_URL || ''
    }
};
