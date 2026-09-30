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

    this.isTriggering = false;
    this.stopRequested = false;

    // Interactive campaign setup sessions per user number
    this.userSessions = new Map();
  }

  /**
   * Request stopping an ongoing broadcast sending process.
   * @returns {boolean} Whether a broadcast was active and stop was requested.
   */
  requestStop() {
    if (this.isTriggering) {
      this.stopRequested = true;
      this.log('🛑 Stop signal issued for active message broadcast.', 'warning');
      return true;
    }
    return false;
  }

  /**
   * Check if text matches compose command strictly on its own.
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
      cleaned === 'compose'
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
   * Helper to detect if a message is an automated response sent by the bot itself.
   * @param {string} text 
   * @returns {boolean}
   */
  isBotResponse(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    const botPrefixes = [
      '📝 *',
      '📊 *',
      '📱 *',
      '📋 *',
      '🤖 *',
      '✅ *',
      '⚠️ ',
      '❌ *'
    ];
    return botPrefixes.some(prefix => trimmed.startsWith(prefix));
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

      // Ignore messages generated programmatically by the bot itself to prevent feedback loops
      if (msg.fromMe && this.isBotResponse(body)) {
        return;
      }

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

      // Handle Stop / Cancel Command during active broadcast or campaign setup
      const upperBody = body.toUpperCase();
      if (upperBody === 'STOP' || upperBody === '#STOP' || upperBody === 'CANCEL' || upperBody === '#CANCEL' || upperBody === 'STOPBROADCAST' || upperBody === '#STOPBROADCAST') {
        if (this.isTriggering) {
          this.requestStop();
          await client.sendMessage(targetChatJid, '🛑 *Stop request received!* Halting active message broadcast...');
          return;
        }

        if (this.userSessions.has(senderNumber)) {
          this.userSessions.delete(senderNumber);
          await client.sendMessage(targetChatJid, '❌ *Campaign setup canceled.* Send #COMPOSEMESSAGE whenever you want to start a new campaign.');
        }
        return;
      }

      // 1. Step 0: User sends #COMPOSEMESSAGE on its own -> Bot asks for Step 1 Message Content
      if (this.matchesComposeCodeword(body)) {
        this.userSessions.set(senderNumber, {
          step: 'AWAITING_MESSAGE',
          template: '',
          mediaItem: null,
          sheetUrl: '',
          directPhoneList: '',
          phoneColumn: '',
          skipPhoneList: '',
          timestamp: new Date()
        });

        this.log(`Interactive campaign setup initiated by ${senderNumber}`, 'info');

        await client.sendMessage(
          targetChatJid,
          `📝 *Step 1 of 4: Message Content*\n\nPlease reply with the message you would like to send.\n*(You can include text, or attach an image/video with a caption!)*`
        );
        return;
      }

      // Check if user is in an active session state
      const session = this.userSessions.get(senderNumber);

      // 2. Step 1: User sends message text/media -> Bot asks for Target Recipients
      if (session && session.step === 'AWAITING_MESSAGE') {
        let mediaItem = null;

        if (hasMedia) {
          try {
            this.log(`Processing attached media from ${senderNumber}...`, 'info');
            let media = null;

            // Attempt 1: Try direct downloadMedia()
            try {
              media = await msg.downloadMedia();
            } catch (e) {
              this.log(`Initial downloadMedia call error: ${e.message}`, 'warning');
            }

            // Attempt 2: Retry with short pause if null
            if (!media || !media.data) {
              for (let attempt = 1; attempt <= 3; attempt++) {
                await new Promise(r => setTimeout(r, 1000));
                try {
                  media = await msg.downloadMedia();
                  if (media && media.data) break;
                } catch (err) {}
              }
            }

            // Fallback: Extract base64 payload directly from msg._data (crucial for self-sent media from mobile phone!)
            if ((!media || !media.data) && msg._data && msg._data.body) {
              const rawBody = msg._data.body;
              if (typeof rawBody === 'string' && rawBody.length > 30) {
                const cleanB64 = rawBody.replace(/^data:.*?;base64,/, '');
                const mime = msg._data.mimetype || 'image/jpeg';
                const ext = mime.split('/')[1] || 'jpeg';
                media = {
                  mimetype: mime,
                  data: cleanB64,
                  filename: msg._data.filename || `photo_${Date.now()}.${ext}`
                };
                this.log('Extracted media payload directly from message data!', 'success');
              }
            }

            if (media && media.data) {
              const rawMime = media.mimetype || 'image/jpeg';
              const ext = rawMime.split('/')[1] || 'jpeg';
              mediaItem = {
                name: media.filename || `attachment_${Date.now()}.${ext}`,
                dataUrl: `data:${rawMime};base64,${media.data}`
              };
              this.log(`Attached media ${mediaItem.name} (${rawMime}) processed successfully.`, 'success');
            } else {
              throw new Error('Could not retrieve image data payload from WhatsApp message');
            }
          } catch (mediaErr) {
            this.log(`Failed to process attached media: ${mediaErr.message}`, 'error');
            await client.sendMessage(targetChatJid, `⚠️ Could not process media attachment (${mediaErr.message}). Please try sending the image again or send text only.`);
            return;
          }
        }

        const templateText = body || (mediaItem ? mediaItem.name : 'Image/Video Message');
        session.template = templateText;
        session.mediaItem = mediaItem;
        session.step = 'AWAITING_RECIPIENTS';

        this.log(`Message template recorded for ${senderNumber}: "${templateText}"`, 'info');

        await client.sendMessage(
          targetChatJid,
          `📊 *Step 2 of 4: Target Recipients*\n\nPlease reply with a **Google Spreadsheet link** (e.g., \`https://docs.google.com/spreadsheets/d/...\`) OR paste a list of **WhatsApp phone numbers** (separated by lines or commas).`
        );
        return;
      }

      // 3. Step 2: User sends Spreadsheet link OR Direct Phone List -> Bot asks for column or skip numbers
      if (session && session.step === 'AWAITING_RECIPIENTS') {
        const isSheet = body.includes('docs.google.com/spreadsheets') || body.includes('/d/');
        if (isSheet) {
          session.sheetUrl = body.trim();
          session.step = 'AWAITING_COLUMN';
          this.log(`Google Spreadsheet URL recorded for ${senderNumber}: ${session.sheetUrl}`, 'info');

          await client.sendMessage(
            targetChatJid,
            `📱 *Step 3 of 4: Phone Number Column Name*\n\nPlease reply with the column name containing phone numbers (e.g. \`Phone\`, \`Mobile\`, or reply \`AUTO\` to auto-detect).`
          );
        } else {
          session.directPhoneList = body.trim();
          session.step = 'AWAITING_SKIP_NUMBERS';
          this.log(`Direct phone list recorded for ${senderNumber}: ${session.directPhoneList.split(/[\n,;]+/).filter(Boolean).length} number(s)`, 'info');

          await client.sendMessage(
            targetChatJid,
            `🚫 *Step 4 of 4: Numbers to Avoid / Skip*\n\nPlease reply with any WhatsApp numbers to avoid sending the message to (comma or line-separated), or reply *NONE* (or *SKIP*) if no numbers to avoid.`
          );
        }
        return;
      }

      // 4. Step 3: User sends Phone Number Column Name -> Bot asks for Numbers to Avoid / Skip
      if (session && session.step === 'AWAITING_COLUMN') {
        const colInput = body.trim();
        session.phoneColumn = colInput.toUpperCase() === 'AUTO' ? '' : colInput;
        session.step = 'AWAITING_SKIP_NUMBERS';

        this.log(`Phone column recorded for ${senderNumber}: ${session.phoneColumn || 'AUTO'}`, 'info');

        await client.sendMessage(
          targetChatJid,
          `🚫 *Step 4 of 4: Numbers to Avoid / Skip*\n\nPlease reply with any WhatsApp numbers to avoid sending the message to (comma or line-separated), or reply *NONE* (or *SKIP*) if no numbers to avoid.`
        );
        return;
      }

      // 5. Step 4: User sends Skip Numbers -> Bot presents Campaign Summary & confirmation request
      if (session && session.step === 'AWAITING_SKIP_NUMBERS') {
        const cleanBody = body.trim();
        if (cleanBody.toUpperCase() === 'NONE' || cleanBody.toUpperCase() === 'SKIP' || cleanBody.toUpperCase() === 'NO') {
          session.skipPhoneList = '';
        } else {
          session.skipPhoneList = cleanBody;
        }
        session.step = 'AWAITING_CONFIRMATION';

        const skipCount = session.skipPhoneList ? session.skipPhoneList.split(/[\n,;]+/).filter(Boolean).length : 0;
        this.log(`Skip list recorded for ${senderNumber}: ${skipCount} number(s)`, 'info');

        const sheetInfo = session.sheetUrl ? `• **Spreadsheet**: ${session.sheetUrl}\n• **Phone Column**: ${session.phoneColumn || 'Auto-Detect'}\n` : '';
        const directCount = session.directPhoneList ? session.directPhoneList.split(/[\n,;]+/).filter(Boolean).length : 0;
        const directInfo = directCount > 0 ? `• **Direct Target Numbers**: ${directCount} number(s)\n` : '';
        const avoidInfo = skipCount > 0 ? `• **Numbers to Avoid/Skip**: ${skipCount} number(s)\n` : `• **Numbers to Avoid/Skip**: None\n`;

        await client.sendMessage(
          targetChatJid,
          `📋 *Campaign Summary*\n\n• **Message**: "${session.template}"\n• **Media**: ${session.mediaItem ? 'Attached' : 'None'}\n${sheetInfo}${directInfo}${avoidInfo}\nReply with *#STARTBROADCAST* to confirm and start sending!\n*(Or reply CANCEL to discard)*`
        );
        return;
      }

      // 6. Step 5: User confirms by sending #STARTBROADCAST
      if (this.matchesCodeword(body)) {
        if (session && session.step === 'AWAITING_CONFIRMATION') {
          this.log(`🚀 #STARTBROADCAST confirmed by ${senderNumber} for interactive campaign!`, 'success');
          await client.sendMessage(targetChatJid, `🤖 *Confirmation Received!* Starting data processing & WhatsApp broadcast pipeline...`);

          const overrideParams = {
            source: 'WhatsApp Interactive',
            sender: senderNumber,
            sheets: session.sheetUrl ? [session.sheetUrl] : [],
            directPhoneList: session.directPhoneList || '',
            skipPhoneList: session.skipPhoneList || '',
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
    this.stopRequested = false;
    try {
      this.log(`📢 Broadcast Triggered via ${metadata.source || 'Codeword'} (User: ${metadata.sender || 'System'})`, 'info');
      const result = await this.onTrigger(metadata);
      return result;
    } finally {
      this.isTriggering = false;
    }
  }
}

module.exports = TriggerManager;
