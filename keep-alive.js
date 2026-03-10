const express = require('express');
const axios = require('axios');
const chalk = require('chalk');

const app = express();
let server = null;

// Ping self every 5 minutes to keep Replit alive
function startKeepAlive() {
    const REPL_SLUG = process.env.REPL_SLUG || 'evo-md-tg-bot';
    const REPL_OWNER = process.env.REPL_OWNER || 'your-username';
    const REPL_URL = `https://${REPL_SLUG}.${REPL_OWNER}.repl.co`;
    
    console.log(chalk.blue(`📡 Keep-alive service started for: ${REPL_URL}`));
    
    setInterval(async () => {
        try {
            const response = await axios.get(REPL_URL);
            console.log(chalk.green(`✓ Keep-alive ping successful: ${response.status}`));
        } catch (error) {
            console.log(chalk.yellow(`⚠ Keep-alive ping failed: ${error.message}`));
        }
    }, 5 * 60 * 1000); // Every 5 minutes
}

// Web server for uptime monitoring
function startWebServer() {
    if (!server) {
        app.get('/health', (req, res) => {
            res.json({ 
                status: 'healthy', 
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });

        const PORT = process.env.PORT || 3000;
        server = app.listen(PORT, () => {
            console.log(chalk.green(`✓ Health check server running on port ${PORT}`));
        });
    }
    return server;
}

module.exports = () => {
    startWebServer();
    startKeepAlive();
};
