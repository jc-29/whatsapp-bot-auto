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

    // Interactive campaign setup sessions per user number
    this.userSessions = new Map();
  }

  /**
   * Check if text matches compose command.
   * @param {string} incomingMessage 
   * @returns {boolean}
   */
  matchesComposeCodeword(incomingMessage) {
    if (!incomingMessage || typeof incomingMessage !== 'string') return false;
    const cleaned = incomingMessage.trim().toLowerCase();
    return (
      cleaned === '#composemessage' ||
      cleaned === '#compose' ||
      cleaned === 'composemessage' ||
      cleaned === 'compose' ||
      cleaned === '#startcompose'
    );
  }

  /**
   * Check if text matches broadcast start command.
   * @param {string} incomingMessage 
   * @returns {boolean}
   */
  matchesCodeword(incomingMessage) {
    if (!incomingMessage || typeof incomingMessage !== 'string') return false;
    const config = this.getConfig();
    const codeword = (config.codeword || '').trim();

    const cleanedIncoming = incomingMessage.trim().toLowerCase();
    const cleanedCodeword = (codeword || '#STARTBROADCAST').toLowerCase();

    if (cleanedIncoming === cleanedCodeword || cleanedIncoming.startsWith(cleanedCodeword + ' ')) {
      return true;
    }

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
   * Handle WhatsApp incoming message with strict 1-by-1 sequential prompts.
   * @param {Object} msg - whatsapp-web.js Message object
   * @param {Object} client - whatsapp-web.js Client object
   */
  async handleWhatsAppMessage(msg, client) {
    try {
      const config = this.getConfig();
      const body = (msg.body || '').trim();
      const hasMedia = msg.hasMedia;

      if (!body && !hasMedia) return;

      // Determine sender and target JIDs
      const senderJid = msg.fromMe ? (client.info ? client.info.wid._serialized : msg.from) : (msg.author || msg.from);
      const targetChatJid = msg.from;
      const senderNumber = senderJid.replace(/@c\.us|@g\.us/g, '').replace(/\D/g, '');

      // Check admin authorization if specified
      if (config.adminNumbers && Array.isArray(config.adminNumbers) && config.adminNumbers.length > 0) {
        const isAuthorized = config.adminNumbers.some(admin => {
          const cleanAdmin = String(admin).replace(/\D/g, '');
          return cleanAdmin && (senderNumber.includes(cleanAdmin) || cleanAdmin.includes(senderNumber));
        });

        if (!isAuthorized) {
          if (this.matchesComposeCodeword(body) || this.matchesCodeword(body)) {
            this.log(`Unauthorized trigger attempt on WhatsApp from ${senderNumber}`, 'warning');
            await client.sendMessage(targetChatJid, '⚠️ Unauthorized: Your number is not listed as an admin in the bot configuration.');
          }
          return;
        }
      }

      // Handle Cancel Command
      if (body.toUpperCase() === 'CANCEL' || body.toUpperCase() === '#CANCEL') {
        if (this.userSessions.has(senderNumber)) {
          this.userSessions.delete(senderNumber);
          await client.sendMessage(targetChatJid, '❌ *Campaign setup canceled.* Send #COMPOSEMESSAGE whenever you want to start a new campaign.');
        }
        return;
      }

      // 1. Step 0: User sends #COMPOSEMESSAGE -> Bot asks ONLY for the message content
      if (this.matchesComposeCodeword(body)) {
        this.userSessions.set(senderNumber, {
          step: 'AWAITING_MESSAGE',
          template: '',
          mediaItem: null,
          sheetUrl: '',
          phoneColumn: '',
          timestamp: new Date()
        });

        this.log(`Interactive campaign setup initiated by ${senderNumber}`, 'info');

        await client.sendMessage(
          targetChatJid,
          `📝 *Step 1 of 3: Message Content*\n\nPlease reply with the message you would like to send.\n*(You can include text, or attach an image/video with a caption!)*`
        );
        return;
      }

      // Check if user is in an active session state
      const session = this.userSessions.get(senderNumber);

      // 2. Step 1: User sends message text/media -> Bot asks ONLY for Google Spreadsheet link
      if (session && session.step === 'AWAITING_MESSAGE') {
        let mediaItem = null;

        if (hasMedia) {
          try {
            this.log(`Downloading attached media from ${senderNumber}...`, 'info');
            const media = await msg.downloadMedia();
            if (media) {
              mediaItem = {
                name: media.filename || `attachment_${Date.now()}`,
                dataUrl: `data:${media.mimetype};base64,${media.data}`
              };
              this.log(`Attached media ${mediaItem.name} (${media.mimetype}) processed successfully.`, 'success');
            }
          } catch (mediaErr) {
            this.log(`Failed to download attached media: ${mediaErr.message}`, 'error');
            await client.sendMessage(targetChatJid, `⚠️ Could not process media attachment. Please try sending again or send text only.`);
            return;
          }
        }

        const templateText = body || (mediaItem ? mediaItem.name : 'Image/Video Message');
        session.template = templateText;
        session.mediaItem = mediaItem;
        session.step = 'AWAITING_SPREADSHEET';

        this.log(`Message template recorded for ${senderNumber}: "${templateText}"`, 'info');

        await client.sendMessage(
          targetChatJid,
          `📊 *Step 2 of 3: Google Spreadsheet Link*\n\nPlease reply with your Google Spreadsheet link.`
        );
        return;
      }

      // 3. Step 2: User sends Google Spreadsheet Link -> Bot asks ONLY for Phone Number Column Name
      if (session && session.step === 'AWAITING_SPREADSHEET') {
        if (!body.includes('docs.google.com/spreadsheets') && !body.includes('/d/')) {
          await client.sendMessage(targetChatJid, `⚠️ Please reply with a valid Google Spreadsheet link (e.g., \`https://docs.google.com/spreadsheets/d/...\`) or reply CANCEL.`);
          return;
        }

        session.sheetUrl = body.trim();
        session.step = 'AWAITING_COLUMN';

        this.log(`Google Spreadsheet URL recorded for ${senderNumber}: ${session.sheetUrl}`, 'info');

        await client.sendMessage(
          targetChatJid,
          `📱 *Step 3 of 3: Phone Number Column Name*\n\nPlease reply with the column name containing phone numbers (e.g. \`Phone\`, \`Mobile\`, or reply \`AUTO\` to auto-detect).`
        );
        return;
      }

      // 4. Step 3: User sends Phone Number Column Name -> Bot presents Campaign Summary & confirmation request
      if (session && session.step === 'AWAITING_COLUMN') {
        const colInput = body.trim();
        session.phoneColumn = colInput.toUpperCase() === 'AUTO' ? '' : colInput;
        session.step = 'AWAITING_CONFIRMATION';

        this.log(`Phone column recorded for ${senderNumber}: ${session.phoneColumn || 'AUTO'}`, 'info');

        await client.sendMessage(
          targetChatJid,
          `📋 *Campaign Summary*\n\n• **Message**: "${session.template}"\n• **Media**: ${session.mediaItem ? 'Attached' : 'None'}\n• **Spreadsheet**: ${session.sheetUrl}\n• **Phone Column**: ${session.phoneColumn || 'Auto-Detect'}\n\nReply with *#STARTBROADCAST* to confirm and start sending!\n*(Or reply CANCEL to discard)*`
        );
        return;
      }

      // 5. Step 4: User confirms by sending #STARTBROADCAST
      if (this.matchesCodeword(body)) {
        if (session && session.step === 'AWAITING_CONFIRMATION') {
          this.log(`🚀 #STARTBROADCAST confirmed by ${senderNumber} for interactive campaign!`, 'success');
          await client.sendMessage(targetChatJid, `🤖 *Confirmation Received!* Starting Google Spreadsheet data extraction & WhatsApp broadcast pipeline...`);

          const overrideParams = {
            source: 'WhatsApp Interactive',
            sender: senderNumber,
            sheets: [session.sheetUrl],
            template: session.template,
            phoneColumn: session.phoneColumn,
            mediaItems: session.mediaItem ? [session.mediaItem] : []
          };

          // Clear interactive session
          this.userSessions.delete(senderNumber);

          // Execute campaign broadcast
          const result = await this.executeTrigger(overrideParams);

          await client.sendMessage(
            targetChatJid,
            `✅ *Broadcast Completed!*\n\n- Sent: ${result.success}\n- Failed: ${result.failed}\n- Total Processed: ${result.total}`
          );
          return;
        }

        // Standard direct codeword trigger (fallback to config default)
        const extraArg = this.extractCodewordArgs(body);
        const targetSheetTab = extraArg || config.defaultSheetTab || '';

        this.log(`🚀 Codeword '${config.codeword || '#STARTBROADCAST'}' triggered via WhatsApp by ${senderNumber}${targetSheetTab ? ` (Tab: ${targetSheetTab})` : ''}`, 'success');
        await client.sendMessage(targetChatJid, `🤖 *Codeword Received!* Starting Google Spreadsheet broadcast${targetSheetTab ? ` (Tab: *${targetSheetTab}*)` : ''}...`);

        const result = await this.executeTrigger({ source: 'WhatsApp', sender: senderNumber, targetSheetTab });

        await client.sendMessage(
          targetChatJid,
          `✅ *Broadcast Completed!*${targetSheetTab ? ` (Tab: *${targetSheetTab}*)` : ''}\n\n- Sent: ${result.success}\n- Failed: ${result.failed}\n- Total Processed: ${result.total}`
        );
      }
    } catch (err) {
      this.log(`Error handling WhatsApp interactive trigger: ${err.message}`, 'error');
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
