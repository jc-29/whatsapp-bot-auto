const axios = require('axios');

class TriggerManager {
  /**
   * @param {Object} options
   * @param {Function} options.onTrigger - Callback function when codeword is activated
   * @param {Function} options.getConfig - Function returning current configuration object
   * @param {Function} options.log - Logging helper
   */
  constructor(options) {
    this.onTrigger = options.onTrigger;
    this.getConfig = options.getConfig;
    this.log = options.log || console.log;

    this.telegramBot = null;
    this.isTriggering = false;
  }

  /**
   * Check if a message matches the configured codeword.
   * @param {string} incomingMessage 
   * @returns {boolean}
   */
  matchesCodeword(incomingMessage) {
    if (!incomingMessage || typeof incomingMessage !== 'string') return false;
    const config = this.getConfig();
    const codeword = (config.codeword || '').trim();
    if (!codeword) return false;

    const cleanedIncoming = incomingMessage.trim().toLowerCase();
    const cleanedCodeword = codeword.toLowerCase();

    // Direct match or prefix match
    if (cleanedIncoming === cleanedCodeword || cleanedIncoming.startsWith(cleanedCodeword + ' ')) {
      return true;
    }

    // Strip leading punctuation (# or !) if present
    const strippedCodeword = cleanedCodeword.replace(/^[#!]/, '');
    if (strippedCodeword && (cleanedIncoming === strippedCodeword || cleanedIncoming.startsWith(strippedCodeword + ' '))) {
      return true;
    }

    return false;
  }

  extractCodewordArgs(incomingMessage) {
    if (!incomingMessage || typeof incomingMessage !== 'string') return '';
    const config = this.getConfig();
    const codeword = (config.codeword || '').trim();
    if (!codeword) return '';

    const cleanedIncoming = incomingMessage.trim();
    const cleanedCodeword = codeword.toLowerCase();
    const strippedCodeword = cleanedCodeword.replace(/^[#!]/, '');

    let rest = '';
    if (cleanedIncoming.toLowerCase().startsWith(cleanedCodeword)) {
      rest = cleanedIncoming.substring(cleanedCodeword.length).trim();
    } else if (strippedCodeword && cleanedIncoming.toLowerCase().startsWith(strippedCodeword)) {
      rest = cleanedIncoming.substring(strippedCodeword.length).trim();
    }

    return rest;
  }

  /**
   * Handle WhatsApp incoming message.
   * @param {Object} msg - whatsapp-web.js Message object
   * @param {Object} client - whatsapp-web.js Client object
   */
  async handleWhatsAppMessage(msg, client) {
    try {
      const config = this.getConfig();
      const body = (msg.body || '').trim();

      if (!body) return;

      // Determine sender and target JIDs
      const senderJid = msg.fromMe ? (client.info ? client.info.wid._serialized : msg.from) : (msg.author || msg.from);
      const targetChatJid = msg.from;
      const senderNumber = senderJid.replace(/@c\.us|@g\.us/g, '').replace(/\D/g, '');

      if (!this.matchesCodeword(body)) return;

      this.log(`Incoming message '${body}' matched codeword '${config.codeword}' from ${senderNumber}`, 'info');

      // Check admin authorization if specified
      if (config.adminNumbers && Array.isArray(config.adminNumbers) && config.adminNumbers.length > 0) {
        const isAuthorized = config.adminNumbers.some(admin => {
          const cleanAdmin = String(admin).replace(/\D/g, '');
          return cleanAdmin && (senderNumber.includes(cleanAdmin) || cleanAdmin.includes(senderNumber));
        });

        if (!isAuthorized) {
          this.log(`Unauthorized trigger attempt on WhatsApp from ${senderNumber}`, 'warning');
          await client.sendMessage(targetChatJid, '⚠️ Unauthorized: Your number is not listed as an admin in the bot configuration.');
          return;
        }
      }

      const extraArg = this.extractCodewordArgs(body);
      const targetSheetTab = extraArg || config.defaultSheetTab || '';

      this.log(`🚀 Codeword '${config.codeword}' triggered via WhatsApp by ${senderNumber}${targetSheetTab ? ` (Tab: ${targetSheetTab})` : ''}`, 'success');
      await client.sendMessage(targetChatJid, `🤖 *Codeword Received!* Starting Google Spreadsheet broadcast${targetSheetTab ? ` (Tab: *${targetSheetTab}*)` : ''}...`);

      // Execute trigger callback
      const result = await this.executeTrigger({ source: 'WhatsApp', sender: senderNumber, targetSheetTab });
      
      await client.sendMessage(targetChatJid, `✅ *Broadcast Completed!*${targetSheetTab ? ` (Tab: *${targetSheetTab}*)` : ''}\n\n- Sent: ${result.success}\n- Failed: ${result.failed}\n- Total Processed: ${result.total}`);
    } catch (err) {
      this.log(`Error handling WhatsApp trigger: ${err.message}`, 'error');
    }
  }

  /**
   * Initialize Telegram Bot listener if token is provided.
   */
  initTelegramBot() {
    const config = this.getConfig();
    const token = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      this.log('Telegram bot token not provided. Skipping Telegram listener.', 'info');
      return;
    }

    try {
      const TelegramBot = require('node-telegram-bot-api');
      this.telegramBot = new TelegramBot(token, { polling: true });

      this.log('Telegram Bot initialized & listening for codewords...', 'success');

      this.telegramBot.on('message', async (msg) => {
        const text = msg.text || '';
        if (this.matchesCodeword(text)) {
          const chatId = msg.chat.id;
          const sender = msg.from ? (msg.from.username || msg.from.first_name) : chatId;

          this.log(`🚀 Codeword '${config.codeword}' triggered via Telegram by ${sender}`, 'success');
          await this.telegramBot.sendMessage(chatId, `🤖 *Codeword Received!* Starting WhatsApp broadcast from Google Spreadsheets...`, { parse_mode: 'Markdown' });

          const result = await this.executeTrigger({ source: 'Telegram', sender: sender });

          await this.telegramBot.sendMessage(chatId, `✅ *Broadcast Completed!*\n\n- Sent: ${result.success}\n- Failed: ${result.failed}\n- Total: ${result.total}`, { parse_mode: 'Markdown' });
        }
      });
    } catch (err) {
      this.log(`Failed to initialize Telegram Bot: ${err.message}`, 'warning');
    }
  }

  /**
   * Send notification to Telegram if chat ID is configured.
   * @param {string} message 
   */
  async notifyTelegram(message) {
    const config = this.getConfig();
    const chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
    if (this.telegramBot && chatId) {
      try {
        await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (err) {
        this.log(`Failed to send Telegram notification: ${err.message}`, 'warning');
      }
    }
  }

  /**
   * Send notification to Discord webhook if configured.
   * @param {string} message 
   */
  async notifyDiscord(message) {
    const config = this.getConfig();
    const webhookUrl = config.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, { content: message });
      } catch (err) {
        this.log(`Failed to send Discord webhook: ${err.message}`, 'warning');
      }
    }
  }

  /**
   * Execute trigger callback.
   * @param {Object} metadata 
   * @returns {Promise<{ success: number, failed: number, total: number }>}
   */
  async executeTrigger(metadata = {}) {
    if (this.isTriggering) {
      this.log('Trigger requested but a broadcast is already running!', 'warning');
      return { success: 0, failed: 0, total: 0, alreadyRunning: true };
    }

    this.isTriggering = true;
    try {
      const summaryMsg = `📢 *Broadcast Triggered via ${metadata.source || 'Codeword'}* (User: ${metadata.sender || 'System'})`;
      await this.notifyTelegram(summaryMsg);
      await this.notifyDiscord(summaryMsg);

      const result = await this.onTrigger(metadata);
      return result;
    } finally {
      this.isTriggering = false;
    }
  }
}

module.exports = TriggerManager;
