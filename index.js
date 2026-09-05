const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const crypto = require('crypto');
const https = require('https');
const dotenv = require('dotenv');

dotenv.config();

// Global process exception handlers to prevent Puppeteer / WWebJS navigation warnings from killing the process
process.on('uncaughtException', (err) => {
  console.error('⚠️ [UNCAUGHT EXCEPTION WORKAROUND]:', err ? (err.stack || err.message || err) : 'Unknown error');
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [UNHANDLED REJECTION WORKAROUND]:', reason ? (reason.stack || reason.message || reason) : 'Unknown rejection');
});

const { fetchSheetData, findPhoneColumn, substituteTemplate } = require('./lib/sheets');
const TriggerManager = require('./lib/triggers');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Session storage: token -> { user, email, picture, authType, createdAt }
const validSessions = new Map();

function createSession(userInfo) {
  const token = crypto.randomBytes(32).toString('hex');
  validSessions.set(token, {
    ...userInfo,
    createdAt: Date.now()
  });
  return token;
}

function verifyGoogleToken(idToken) {
  return new Promise((resolve, reject) => {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.error || data.error_description) {
            return reject(new Error(data.error_description || data.error));
          }
          resolve(data);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => reject(err));
  });
}

// Default config structure
const defaultConfig = {
  sheets: ["https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0"],
  phoneColumn: "Phone",
  template: "Hello {Name},\n\nThis is an automated notification regarding your account ({Account ID}). Your current status is: {Status}.\n\nThank you!",
  codeword: "#STARTBROADCAST",
  defaultCountryCode: "US",
  delayBetweenMessagesMs: 3000,
  adminNumbers: [],
  webhookSecret: "secret-codeword-123",
  authRequired: true,
  adminPassword: "admin",
  googleClientId: "",
  allowedEmails: []
};

// Load or create config.json
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      return { ...defaultConfig, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Error reading config.json:', err.message);
  }
  return { ...defaultConfig };
}

function saveConfig(newConfig) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving config.json:', err.message);
    return false;
  }
}

let config = loadConfig();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e7, // 50MB
  pingInterval: 10000,   // Ping every 10 seconds to keep Render proxy alive
  pingTimeout: 5000,     // Timeout after 5 seconds
  transports: ['polling', 'websocket'],
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Express Error Handling Middleware for JSON parsing errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Invalid JSON payload in request' });
  }
  next(err);
});

// Express Middleware for API protection
function verifyAuthMiddleware(req, res, next) {
  if (!config.authRequired) return next();

  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers['x-auth-token']) {
    token = req.headers['x-auth-token'];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (token && validSessions.has(token)) {
    req.user = validSessions.get(token);
    return next();
  }

  return res.status(401).json({ success: false, error: 'Unauthorized access. Please login.' });
}

// Socket.IO authentication middleware
io.use((socket, next) => {
  if (!config.authRequired) return next();
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (token && validSessions.has(token)) {
    socket.user = validSessions.get(token);
    return next();
  }
  return next(new Error('Authentication failed: Invalid or missing token'));
});

const PORT = process.env.PORT || 3000;

// WhatsApp Client State
let isClientReady = false;
let clientInfo = null;

// Detect system Chromium path dynamically for Linux / Docker / Render containers
let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
if (!executablePath) {
  if (fs.existsSync('/usr/bin/chromium')) executablePath = '/usr/bin/chromium';
  else if (fs.existsSync('/usr/bin/chromium-browser')) executablePath = '/usr/bin/chromium-browser';
}

console.log('Puppeteer Executable Path:', executablePath || 'Default Puppeteer bundled Chromium');

const client = new Client({
  authStrategy: new LocalAuth(),
  webVersionCache: {
    type: 'local'
  },
  puppeteer: {
    headless: true,
    executablePath: executablePath || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-component-update'
    ]
  }
});

// Periodic garbage collection helper
setInterval(() => {
  if (global.gc) {
    try {
      global.gc();
    } catch (e) {}
  }
}, 30000);

// Logging & Socket Emission helper
function logMessage(text, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${text}`);
  io.emit('log', { timestamp, text, type });
}

// Trigger Manager Setup
const triggerManager = new TriggerManager({
  onTrigger: async (metadata) => {
    return await executeSpreadsheetBroadcast(metadata);
  },
  getConfig: () => config,
  log: logMessage
});

// WhatsApp Client Events
client.on('qr', async (qr) => {
  logMessage('QR Code generated. Scan with WhatsApp app.', 'info');
  try {
    const qrDataUrl = await qrcode.toDataURL(qr);
    io.emit('qr', qrDataUrl);
  } catch (err) {
    console.error('Failed to generate QR Data URL:', err);
  }
});

client.on('authenticated', () => {
  logMessage('WhatsApp authenticated successfully.', 'success');
  io.emit('authenticated');
});

client.on('ready', () => {
  isClientReady = true;
  clientInfo = client.info;
  logMessage(`WhatsApp client is ready! Logged in as ${clientInfo.pushname || clientInfo.wid.user}`, 'success');
  io.emit('ready', { pushname: clientInfo.pushname, number: clientInfo.wid.user });
});

client.on('auth_failure', (msg) => {
  logMessage(`WhatsApp authentication failure: ${msg}`, 'error');
  io.emit('auth_failure', msg);
});

client.on('disconnected', (reason) => {
  isClientReady = false;
  clientInfo = null;
  logMessage(`WhatsApp client disconnected: ${reason}`, 'warning');
  io.emit('disconnected', reason);
});

// Incoming & self-created message handler for Codeword trigger
client.on('message_create', async (msg) => {
  // Avoid responding to system messages
  if (msg.isStatus || msg.type === 'protocol' || msg.type === 'e2e_notification') return;
  await triggerManager.handleWhatsAppMessage(msg, client);
});

/**
 * Executes Google Spreadsheet WhatsApp Broadcast pipeline.
 * @param {Object} [overrideParams]
 * @returns {Promise<{ success: number, failed: number, total: number }>}
 */
async function executeSpreadsheetBroadcast(overrideParams = {}) {
  if (!isClientReady) {
    const errMsg = 'WhatsApp client is not ready. Please scan the QR code first.';
    logMessage(errMsg, 'error');
    io.emit('broadcast_error', errMsg);
    throw new Error(errMsg);
  }

  const sheetsToProcess = overrideParams.sheets || config.sheets || [];
  const messageTemplate = overrideParams.template || config.template || '';
  const specifiedPhoneCol = overrideParams.phoneColumn || config.phoneColumn || 'Phone';
  const delayMs = overrideParams.delayBetweenMessagesMs || config.delayBetweenMessagesMs || 3000;
  const countryCode = overrideParams.defaultCountryCode || config.defaultCountryCode || 'US';
  const mediaItems = overrideParams.mediaItems || [];

  if (sheetsToProcess.length === 0) {
    const errMsg = 'No Google Spreadsheets specified in configuration.';
    logMessage(errMsg, 'error');
    io.emit('broadcast_error', errMsg);
    throw new Error(errMsg);
  }

  logMessage(`Starting Google Spreadsheet processing (${sheetsToProcess.length} sheet(s))...`, 'info');

  const targetTabName = overrideParams.targetSheetTab || overrideParams.sheetName || config.defaultSheetTab || '';
  let allContacts = [];

  // 1. Fetch & extract contacts from all sheets
  for (const sheetUrl of sheetsToProcess) {
    if (!sheetUrl || !sheetUrl.trim()) continue;
    try {
      logMessage(`Fetching sheet: ${sheetUrl}${targetTabName ? ` (Tab: ${targetTabName})` : ''}`, 'info');
      const { headers, rows, totalRows } = await fetchSheetData(sheetUrl, { sheetName: targetTabName });
      logMessage(`Fetched ${totalRows} rows from spreadsheet tab. Headers: ${headers.join(', ')}`, 'success');

      const phoneCol = findPhoneColumn(headers, specifiedPhoneCol);
      if (!phoneCol) {
        logMessage(`Could not identify phone column in sheet ${sheetUrl}. Headers available: ${headers.join(', ')}`, 'warning');
        continue;
      }

      logMessage(`Using column '${phoneCol}' for phone numbers.`, 'info');

      for (const row of rows) {
        const rawPhone = row[phoneCol];
        if (rawPhone && String(rawPhone).trim()) {
          allContacts.push({
            rawPhone: String(rawPhone).trim(),
            rowData: row,
            sheetUrl
          });
        }
      }
    } catch (err) {
      logMessage(`Error loading sheet ${sheetUrl}: ${err.message}`, 'error');
    }
  }

  if (allContacts.length === 0) {
    const errMsg = 'No valid contact phone numbers extracted from the spreadsheets.';
    logMessage(errMsg, 'error');
    io.emit('broadcast_error', errMsg);
    return { success: 0, failed: 0, total: 0 };
  }

  logMessage(`Extracted total ${allContacts.length} recipient candidates. Starting messaging pipeline...`, 'info');
  io.emit('broadcast_start', { total: allContacts.length });

  // Prepare optional media attachments
  let msgMedias = [];
  for (const item of mediaItems) {
    if (item && item.dataUrl) {
      try {
        const match = item.dataUrl.match(/^data:(.*?);base64,(.*)$/);
        if (match && match.length === 3) {
          msgMedias.push(new MessageMedia(match[1], match[2], item.name));
        }
      } catch (err) {
        logMessage(`Failed to parse media attachment ${item.name}: ${err.message}`, 'error');
      }
    }
  }

  let successCount = 0;
  let failCount = 0;
  const processedJids = new Set();

  for (let i = 0; i < allContacts.length; i++) {
    const contact = allContacts[i];
    const { rawPhone, rowData } = contact;

    // Parse phone number using libphonenumber-js
    let phoneNumberObj = parsePhoneNumberFromString(rawPhone, countryCode);
    if (!phoneNumberObj) {
      phoneNumberObj = parsePhoneNumberFromString('+' + rawPhone.replace(/\D/g, ''));
    }

    let formattedJid = null;
    if (phoneNumberObj && phoneNumberObj.isValid()) {
      formattedJid = phoneNumberObj.number.replace('+', '') + '@c.us';
    } else {
      const digits = rawPhone.replace(/\D/g, '');
      if (digits.length >= 7) {
        formattedJid = digits + '@c.us';
      }
    }

    if (!formattedJid) {
      failCount++;
      const reason = 'Invalid phone number format';
      logMessage(`[${i + 1}/${allContacts.length}] ❌ ${rawPhone}: ${reason}`, 'error');
      io.emit('message_status', { index: i + 1, total: allContacts.length, number: rawPhone, status: 'error', reason });
      continue;
    }

    // Deduplicate
    if (processedJids.has(formattedJid)) {
      logMessage(`[${i + 1}/${allContacts.length}] ⏭️ ${rawPhone} (${formattedJid}): Duplicate number skipped`, 'warning');
      io.emit('message_status', { index: i + 1, total: allContacts.length, number: rawPhone, status: 'skipped', reason: 'Duplicate number' });
      continue;
    }

    // Replace template variables
    const finalMessageText = substituteTemplate(messageTemplate, rowData);

    try {
      // Check if number is registered on WhatsApp
      const isRegistered = await client.isRegisteredUser(formattedJid);
      if (!isRegistered) {
        failCount++;
        const reason = 'Not registered on WhatsApp';
        logMessage(`[${i + 1}/${allContacts.length}] ⚠️ ${rawPhone}: ${reason}`, 'warning');
        io.emit('message_status', { index: i + 1, total: allContacts.length, number: rawPhone, status: 'skipped', reason });
        continue;
      }

      processedJids.add(formattedJid);

      // Send Media or Text Message
      if (msgMedias.length > 0) {
        for (let j = 0; j < msgMedias.length; j++) {
          const opts = (j === 0 && finalMessageText) ? { caption: finalMessageText } : {};
          await client.sendMessage(formattedJid, msgMedias[j], opts);
          if (j < msgMedias.length - 1) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      } else if (finalMessageText) {
        await client.sendMessage(formattedJid, finalMessageText);
      }

      successCount++;
      logMessage(`[${i + 1}/${allContacts.length}] ✅ Sent successfully to ${rawPhone} (${formattedJid})`, 'success');
      io.emit('message_status', { index: i + 1, total: allContacts.length, number: rawPhone, status: 'success' });

      // Anti-spam delay between messages
      if (i < allContacts.length - 1 && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    } catch (err) {
      failCount++;
      const reason = err.message || 'Unknown error';
      logMessage(`[${i + 1}/${allContacts.length}] ❌ Failed to send to ${rawPhone}: ${reason}`, 'error');
      io.emit('message_status', { index: i + 1, total: allContacts.length, number: rawPhone, status: 'error', reason });
    }
  }

  const summary = { success: successCount, failed: failCount, total: allContacts.length };
  logMessage(`🎉 Broadcast finished! Sent: ${successCount}, Failed/Skipped: ${failCount}, Total: ${allContacts.length}`, 'success');
  io.emit('broadcast_complete', summary);

  return summary;
}

// REST API Endpoints

// Public Auth Endpoints
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ success: false, error: 'idToken is required' });
  }

  try {
    const payload = await verifyGoogleToken(idToken);

    // Check Client ID if configured
    if (config.googleClientId && payload.aud !== config.googleClientId) {
      return res.status(401).json({ success: false, error: 'Google Client ID mismatch' });
    }

    const email = payload.email ? payload.email.toLowerCase() : '';
    // Check allowed emails if configured
    if (config.allowedEmails && config.allowedEmails.length > 0) {
      const allowed = config.allowedEmails.map(e => e.trim().toLowerCase()).filter(Boolean);
      if (!allowed.includes(email)) {
        return res.status(403).json({ success: false, error: `Access denied. Email (${email}) is not authorized.` });
      }
    }

    const userInfo = {
      name: payload.name || payload.email,
      email: payload.email,
      picture: payload.picture || '',
      authType: 'google'
    };

    const token = createSession(userInfo);
    logMessage(`Google Sign-In successful for ${userInfo.email}`, 'success');
    res.json({ success: true, token, user: userInfo });
  } catch (err) {
    logMessage(`Google authentication failed: ${err.message}`, 'error');
    res.status(401).json({ success: false, error: `Google Auth Error: ${err.message}` });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  const adminPass = config.adminPassword || 'admin';

  if (password === adminPass) {
    const userInfo = {
      name: 'Admin User',
      email: 'Passcode Auth',
      picture: '',
      authType: 'passcode'
    };
    const token = createSession(userInfo);
    logMessage('Admin passcode login successful', 'success');
    return res.json({ success: true, token, user: userInfo });
  }

  logMessage('Failed admin passcode login attempt', 'warning');
  res.status(401).json({ success: false, error: 'Invalid admin passcode' });
});

app.get('/api/auth/me', (req, res) => {
  if (!config.authRequired) {
    return res.json({ success: true, authRequired: false, user: { name: 'Admin', email: 'Auth Disabled' } });
  }

  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.substring(7);
  else if (req.headers['x-auth-token']) token = req.headers['x-auth-token'];

  if (token && validSessions.has(token)) {
    return res.json({ success: true, authRequired: true, user: validSessions.get(token) });
  }

  res.status(401).json({ success: false, authRequired: true, error: 'Not authenticated' });
});

// Protected API Endpoints
app.get('/api/config', verifyAuthMiddleware, (req, res) => {
  res.json({ success: true, config });
});

app.post('/api/config', verifyAuthMiddleware, (req, res) => {
  const newConfig = req.body;
  if (!newConfig || typeof newConfig !== 'object') {
    return res.status(400).json({ success: false, error: 'Invalid configuration payload' });
  }

  config = { ...config, ...newConfig };
  saveConfig(config);
  logMessage('Configuration updated via API/Dashboard', 'info');
  io.emit('config_updated', config);
  res.json({ success: true, config });
});

app.post('/api/sheets/preview', verifyAuthMiddleware, async (req, res) => {
  const { sheetUrl, sheetName } = req.body;
  if (!sheetUrl) {
    return res.status(400).json({ success: false, error: 'sheetUrl is required' });
  }

  try {
    const { headers, rows, totalRows } = await fetchSheetData(sheetUrl, { sheetName });
    const detectedPhoneCol = findPhoneColumn(headers, config.phoneColumn);
    res.json({
      success: true,
      headers,
      sampleRows: rows.slice(0, 5),
      totalRows,
      detectedPhoneCol
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Webhook endpoint to trigger codeword broadcast externally (e.g. from Messenger, Zapier, cURL)
app.all('/api/trigger', async (req, res) => {
  const codewordParam = req.query.codeword || req.body.codeword;
  const secretParam = req.query.secret || req.body.secret;

  if (config.webhookSecret && secretParam !== config.webhookSecret) {
    return res.status(401).json({ success: false, error: 'Invalid webhook secret key' });
  }

  if (codewordParam && !triggerManager.matchesCodeword(codewordParam)) {
    return res.status(400).json({ success: false, error: `Codeword '${codewordParam}' does not match configured codeword '${config.codeword}'` });
  }

  try {
    logMessage(`External HTTP Webhook triggered codeword broadcast!`, 'info');
    res.json({ success: true, message: 'Broadcast triggered successfully' });

    // Execute in background
    triggerManager.executeTrigger({ source: 'HTTP Webhook', sender: req.ip }).catch(err => {
      console.error('Error executing trigger:', err);
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    isClientReady,
    clientInfo: clientInfo ? { pushname: clientInfo.pushname, number: clientInfo.wid.user } : null,
    authRequired: config.authRequired !== false,
    googleClientId: config.googleClientId || ''
  });
});

// Socket.IO Connections
io.on('connection', (socket) => {
  logMessage('Web dashboard connected.', 'info');

  socket.emit('config', config);

  if (isClientReady) {
    socket.emit('ready', clientInfo ? { pushname: clientInfo.pushname, number: clientInfo.wid.user } : {});
  }

  socket.on('update_config', (newConfig) => {
    config = { ...config, ...newConfig };
    saveConfig(config);
    logMessage('Configuration updated via dashboard.', 'success');
    io.emit('config_updated', config);
  });

  socket.on('fetch_sheet_preview', async (data) => {
    const { sheetUrl, sheetName } = data || {};
    if (!sheetUrl) return;
    try {
      const { headers, rows, totalRows } = await fetchSheetData(sheetUrl, { sheetName });
      const detectedPhoneCol = findPhoneColumn(headers, config.phoneColumn);
      socket.emit('sheet_preview_result', {
        sheetUrl,
        headers,
        sampleRows: rows.slice(0, 5),
        totalRows,
        detectedPhoneCol
      });
    } catch (err) {
      socket.emit('sheet_preview_error', { sheetUrl, error: err.message });
    }
  });

  socket.on('start_broadcast', async (overrideData) => {
    try {
      await triggerManager.executeTrigger({ source: 'Web Dashboard', sender: 'Admin', ...overrideData });
    } catch (err) {
      socket.emit('broadcast_error', err.message);
    }
  });

  socket.on('logout', async () => {
    logMessage('Logout requested from web dashboard.', 'warning');
    try {
      await client.logout();
      isClientReady = false;
      clientInfo = null;
      io.emit('disconnected', 'Logged out by user');
      logMessage('Logged out successfully. Re-initializing client for new QR code...', 'info');
      client.initialize();
    } catch (err) {
      logMessage(`Logout failed: ${err.message}`, 'error');
    }
  });
});

// Start WhatsApp Client
logMessage('Initializing WhatsApp Web client...', 'info');
client.initialize().catch(err => {
  logMessage(`WhatsApp Client initialization error: ${err.message}`, 'error');
});

server.listen(PORT, () => {
  logMessage(`🚀 Server is running on http://localhost:${PORT}`, 'success');
});
