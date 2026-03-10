const Mega = require('megajs');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

class MegaStorage {
    constructor(email, password) {
        this.email = email;
        this.password = password;
        this.storage = null;
        this.botFolder = null;
        this.connected = false;
    }

    async connect() {
        if (this.connected && this.storage) return true;
        
        try {
            console.log(chalk.yellow('🔄 Connecting to Mega...'));
            
            this.storage = new Mega({
                email: this.email,
                password: this.password,
                autologin: true,
                keepalive: true
            });

            await new Promise((resolve, reject) => {
                this.storage.on('ready', () => {
                    console.log(chalk.green('✓ Connected to Mega'));
                    this.connected = true;
                    resolve();
                });
                this.storage.on('error', (err) => {
                    console.log(chalk.red('Mega connection error:', err.message));
                    reject(err);
                });
                this.storage.login();
            });

            // Find or create EvoMDTG folder
            const rootFiles = await this.storage.get('', { includeFiles: true });
            let evoFolder = rootFiles.children.find(f => f.name === 'EvoMDTG');
            
            if (!evoFolder) {
                evoFolder = await this.storage.mkdir({ name: 'EvoMDTG' });
                console.log(chalk.green('✓ Created EvoMDTG folder on Mega'));
            }

            // Find or create Session folder
            const sessionFolders = await evoFolder.children;
            this.botFolder = sessionFolders.find(f => f.name === 'Session');
            
            if (!this.botFolder) {
                this.botFolder = await evoFolder.mkdir({ name: 'Session' });
            }

            // Create subfolders
            const subFolders = ['Downloads', 'Backups'];
            for (const folder of subFolders) {
                const existingFolder = evoFolder.children.find(f => f.name === folder);
                if (!existingFolder) {
                    await evoFolder.mkdir({ name: folder });
                }
            }

            return true;
        } catch (error) {
            console.error('Failed to connect to Mega:', error);
            this.connected = false;
            return false;
        }
    }

    async saveAuthState(authState) {
        try {
            if (!this.connected) await this.connect();

            const sessionDir = './auth_info_baileys';
            await fs.ensureDir(sessionDir);

            // Save creds.json
            if (authState.creds) {
                await fs.writeJSON(path.join(sessionDir, 'creds.json'), authState.creds, { spaces: 2 });
            }

            // Save all files to Mega
            const files = await fs.readdir(sessionDir);
            
            for (const file of files) {
                if (file.endsWith('.json') || file.endsWith('.txt') || file === 'creds') {
                    const filePath = path.join(sessionDir, file);
                    const fileContent = await fs.readFile(filePath);
                    
                    // Check if file exists in Mega
                    const existingFile = this.botFolder.children?.find(f => f.name === file);
                    
                    if (existingFile) {
                        await existingFile.upload(fileContent);
                    } else {
                        await this.botFolder.upload({ name: file }, fileContent);
                    }
                }
            }

            return true;
        } catch (error) {
            console.error('Failed to save auth state:', error);
            return false;
        }
    }

    async loadAuthState() {
        try {
            if (!this.connected) await this.connect();

            const sessionDir = './auth_info_baileys';
            await fs.ensureDir(sessionDir);

            // Refresh folder children
            if (this.botFolder) {
                this.botFolder = await this.storage.get(this.botFolder.objectId, { includeFiles: true });
            }

            const files = this.botFolder?.children || [];
            
            if (files.length === 0) {
                return null;
            }

            // Download all files
            for (const file of files) {
                if (file.name.endsWith('.json') || file.name.endsWith('.txt')) {
                    const filePath = path.join(sessionDir, file.name);
                    
                    try {
                        const content = await file.downloadBuffer();
                        await fs.writeFile(filePath, content);
                    } catch (err) {
                        console.log(`Failed to download ${file.name}:`, err.message);
                    }
                }
            }

            // Load creds.json
            const credsPath = path.join(sessionDir, 'creds.json');
            if (await fs.pathExists(credsPath)) {
                const creds = await fs.readJSON(credsPath);
                return {
                    state: { creds, keys: {} },
                    saveCreds: async () => {}
                };
            }

            return null;
        } catch (error) {
            console.error('Failed to load auth state:', error);
            return null;
        }
    }

    async saveFile(filename, buffer) {
        try {
            if (!this.connected) await this.connect();

            const rootFiles = await this.storage.get('', { includeFiles: true });
            const evoFolder = rootFiles.children.find(f => f.name === 'EvoMDTG');
            
            if (!evoFolder) {
                console.log('EvoMDTG folder not found');
                return false;
            }

            const downloadsFolder = evoFolder.children.find(f => f.name === 'Downloads');
            
            if (!downloadsFolder) {
                console.log('Downloads folder not found');
                return false;
            }

            // Check if file exists
            const existingFile = downloadsFolder.children?.find(f => f.name === filename);
            
            if (existingFile) {
                await existingFile.upload(buffer);
            } else {
                await downloadsFolder.upload({ name: filename }, buffer);
            }

            console.log(chalk.green(`✓ File saved to Mega: ${filename}`));
            return true;
        } catch (error) {
            console.error('Failed to save file to Mega:', error);
            return false;
        }
    }

    async listDownloads() {
        try {
            if (!this.connected) await this.connect();

            const rootFiles = await this.storage.get('', { includeFiles: true });
            const evoFolder = rootFiles.children.find(f => f.name === 'EvoMDTG');
            
            if (!evoFolder) return [];

            const downloadsFolder = evoFolder.children.find(f => f.name === 'Downloads');
            
            if (!downloadsFolder) return [];

            return downloadsFolder.children || [];
        } catch (error) {
            console.error('Failed to list downloads:', error);
            return [];
        }
    }
}

module.exports = MegaStorage;
