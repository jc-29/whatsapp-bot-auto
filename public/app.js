// Socket.IO Client Initialization with Render proxy fallback
const socket = io({
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity
});

// State
let currentConfig = {};
let logCount = 0;

// DOM Elements
const statusBadge = document.getElementById('status-badge');
const logoutBtn = document.getElementById('logout-btn');
const qrBox = document.getElementById('qr-box');
const qrSpinner = document.getElementById('qr-spinner');
const qrCodeImg = document.getElementById('qrcode');
const readyStatus = document.getElementById('ready-status');
const userPushname = document.getElementById('user-pushname');
const userNumber = document.getElementById('user-number');

// Form Elements
const codewordInput = document.getElementById('codeword-input');
const adminNumbersInput = document.getElementById('admin-numbers-input');
const telegramTokenInput = document.getElementById('telegram-token-input');
const telegramChatidInput = document.getElementById('telegram-chatid-input');
const discordWebhookInput = document.getElementById('discord-webhook-input');
const webhookSecretInput = document.getElementById('webhook-secret-input');
const saveConfigBtn = document.getElementById('save-config-btn');

const sheetUrlsInput = document.getElementById('sheet-urls-input');
const sheetTabInput = document.getElementById('sheet-tab-input');
const phoneColInput = document.getElementById('phone-col-input');
const countryCodeInput = document.getElementById('country-code-input');
const previewSheetBtn = document.getElementById('preview-sheet-btn');

const sheetPreviewBox = document.getElementById('sheet-preview-box');
const previewTotalRows = document.getElementById('preview-total-rows');
const previewTable = document.getElementById('preview-table');
const detectedTagsChips = document.getElementById('detected-tags-chips');

const templateInput = document.getElementById('template-input');
const whatsappPreviewText = document.getElementById('whatsapp-preview-text');
const mediaFileInput = document.getElementById('media-file-input');
const delayInput = document.getElementById('delay-input');
const triggerNowBtn = document.getElementById('trigger-now-btn');

const logsBox = document.getElementById('logs-box');
const logCountBadge = document.getElementById('log-count');
const clearLogsBtn = document.getElementById('clear-logs-btn');

const progressContainer = document.getElementById('progress-container');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');
const progressBarFill = document.getElementById('progress-bar-fill');

// Utility Functions
function updateStatusBadge(state, text) {
  statusBadge.className = `status-badge badge-${state}`;
  statusBadge.querySelector('.status-text').textContent = text;
}

function appendLog(timestamp, text, type = 'info') {
  logCount++;
  logCountBadge.textContent = `${logCount} Events`;

  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${timestamp || new Date().toLocaleTimeString()}] [${type.toUpperCase()}] ${text}`;
  
  logsBox.appendChild(entry);
  logsBox.scrollTop = logsBox.scrollHeight;
}

// Global Tag Insertion Helper for onclick
window.insertTag = function(tag) {
  const cursorPos = templateInput.selectionStart;
  const text = templateInput.value;
  templateInput.value = text.substring(0, cursorPos) + tag + text.substring(cursorPos);
  templateInput.focus();
  updateLivePreview();
};

function updateLivePreview() {
  const rawText = templateInput.value || '';
  if (!rawText.trim()) {
    whatsappPreviewText.innerHTML = '<em>Type a message template to see preview...</em>';
    return;
  }

  // Sample data substitution for preview
  const sampleData = {
    'name': 'John Doe',
    'phone': '+1234567890',
    'status': 'Active',
    'account id': 'ACC-9876',
    'date': new Date().toLocaleDateString()
  };

  let formatted = rawText.replace(/\{([^}]+)\}/g, (match, key) => {
    const k = key.trim().toLowerCase();
    return sampleData[k] !== undefined ? `<strong>${sampleData[k]}</strong>` : `<strong>[${key}]</strong>`;
  });

  whatsappPreviewText.innerHTML = formatted;
}

// Socket Event Handlers
socket.on('connect', () => {
  updateStatusBadge('connecting', 'WhatsApp Connecting...');
  appendLog(null, 'Connected to backend server.', 'info');
});

socket.on('disconnect', () => {
  updateStatusBadge('disconnected', 'Server Disconnected');
  appendLog(null, 'Disconnected from backend server.', 'error');
});

socket.on('qr', (qrDataUrl) => {
  updateStatusBadge('connecting', 'Scan QR Code');
  qrSpinner.style.display = 'none';
  readyStatus.style.display = 'none';
  qrCodeImg.src = qrDataUrl;
  qrCodeImg.style.display = 'block';
  logoutBtn.style.display = 'none';
  appendLog(null, 'QR Code received. Please scan with your WhatsApp phone app.', 'info');
});

socket.on('authenticated', () => {
  updateStatusBadge('connecting', 'WhatsApp Authenticated');
  qrSpinner.style.display = 'flex';
  qrCodeImg.style.display = 'none';
  appendLog(null, 'WhatsApp authenticated. Loading session details...', 'success');
});

socket.on('ready', (info) => {
  updateStatusBadge('connected', 'WhatsApp Ready');
  qrSpinner.style.display = 'none';
  qrCodeImg.style.display = 'none';
  readyStatus.style.display = 'flex';
  logoutBtn.style.display = 'inline-flex';

  if (info && info.pushname) {
    userPushname.textContent = info.pushname;
    userNumber.textContent = info.number ? `+${info.number}` : '';
  }
  appendLog(null, `WhatsApp Client is Ready! (${info.pushname || info.number || 'Active Session'})`, 'success');
});

socket.on('disconnected', (reason) => {
  updateStatusBadge('disconnected', 'Logged Out');
  qrSpinner.style.display = 'flex';
  qrCodeImg.style.display = 'none';
  readyStatus.style.display = 'none';
  logoutBtn.style.display = 'none';
  appendLog(null, `WhatsApp session disconnected: ${reason}`, 'warning');
});

socket.on('log', (data) => {
  appendLog(data.timestamp, data.text, data.type);
});

socket.on('config', (cfg) => {
  currentConfig = cfg;
  populateConfigFields(cfg);
});

socket.on('config_updated', (cfg) => {
  currentConfig = cfg;
  populateConfigFields(cfg);
  appendLog(null, 'Bot configuration saved successfully.', 'success');
});

function populateConfigFields(cfg) {
  if (cfg.codeword !== undefined) codewordInput.value = cfg.codeword;
  if (cfg.adminNumbers) adminNumbersInput.value = Array.isArray(cfg.adminNumbers) ? cfg.adminNumbers.join(', ') : cfg.adminNumbers;
  if (cfg.telegramToken !== undefined) telegramTokenInput.value = cfg.telegramToken;
  if (cfg.telegramChatId !== undefined) telegramChatidInput.value = cfg.telegramChatId;
  if (cfg.discordWebhookUrl !== undefined) discordWebhookInput.value = cfg.discordWebhookUrl;
  if (cfg.webhookSecret !== undefined) webhookSecretInput.value = cfg.webhookSecret;

  if (cfg.sheets && Array.isArray(cfg.sheets)) sheetUrlsInput.value = cfg.sheets.join('\n');
  if (cfg.defaultSheetTab !== undefined) sheetTabInput.value = cfg.defaultSheetTab;
  if (cfg.phoneColumn !== undefined) phoneColInput.value = cfg.phoneColumn;
  if (cfg.defaultCountryCode !== undefined) countryCodeInput.value = cfg.defaultCountryCode;

  if (cfg.template !== undefined) {
    templateInput.value = cfg.template;
    updateLivePreview();
  }
  if (cfg.delayBetweenMessagesMs !== undefined) delayInput.value = cfg.delayBetweenMessagesMs;
}

// Progress & Broadcast events
socket.on('broadcast_start', (data) => {
  progressContainer.style.display = 'block';
  progressText.textContent = `Processing 0 of ${data.total}...`;
  progressPercent.textContent = '0%';
  progressBarFill.style.width = '0%';
  triggerNowBtn.disabled = true;
});

socket.on('message_status', (data) => {
  const percent = Math.round((data.index / data.total) * 100);
  progressText.textContent = `Sent ${data.index} of ${data.total} (Current: ${data.number})`;
  progressPercent.textContent = `${percent}%`;
  progressBarFill.style.width = `${percent}%`;
});

socket.on('broadcast_complete', (summary) => {
  progressText.textContent = `Completed! Sent: ${summary.success}, Failed: ${summary.failed}, Total: ${summary.total}`;
  progressPercent.textContent = '100%';
  progressBarFill.style.width = '100%';
  triggerNowBtn.disabled = false;
});

socket.on('broadcast_error', (errMsg) => {
  alert(`Broadcast Error: ${errMsg}`);
  triggerNowBtn.disabled = false;
});

// UI Interactions
templateInput.addEventListener('input', updateLivePreview);

saveConfigBtn.addEventListener('click', () => {
  const sheets = sheetUrlsInput.value.split('\n').map(s => s.trim()).filter(Boolean);
  const adminNumbers = adminNumbersInput.value.split(',').map(s => s.trim()).filter(Boolean);

  const updatedConfig = {
    codeword: codewordInput.value.trim(),
    adminNumbers,
    telegramToken: telegramTokenInput.value.trim(),
    telegramChatId: telegramChatidInput.value.trim(),
    discordWebhookUrl: discordWebhookInput.value.trim(),
    webhookSecret: webhookSecretInput.value.trim(),
    sheets,
    defaultSheetTab: sheetTabInput.value.trim(),
    phoneColumn: phoneColInput.value.trim(),
    defaultCountryCode: countryCodeInput.value.trim() || 'US',
    template: templateInput.value,
    delayBetweenMessagesMs: parseInt(delayInput.value, 10) || 3000
  };

  socket.emit('update_config', updatedConfig);
});

previewSheetBtn.addEventListener('click', () => {
  const sheets = sheetUrlsInput.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (sheets.length === 0) {
    alert('Please enter at least one Google Spreadsheet URL first.');
    return;
  }
  appendLog(null, `Requesting preview for sheet: ${sheets[0]}`, 'info');
  socket.emit('fetch_sheet_preview', { sheetUrl: sheets[0], sheetName: sheetTabInput.value.trim() });
});

socket.on('sheet_preview_result', (data) => {
  sheetPreviewBox.style.display = 'block';
  previewTotalRows.textContent = `${data.totalRows} rows`;

  // Render Table Head
  const thead = previewTable.querySelector('thead');
  thead.innerHTML = `<tr>${data.headers.map(h => `<th>${h}</th>`).join('')}</tr>`;

  // Render Table Body
  const tbody = previewTable.querySelector('tbody');
  tbody.innerHTML = data.sampleRows.map(row => {
    return `<tr>${data.headers.map(h => `<td>${row[h] !== undefined ? row[h] : ''}</td>`).join('')}</tr>`;
  }).join('');

  // Render Detected Tag Chips
  detectedTagsChips.innerHTML = data.headers.map(h => {
    return `<span class="tag-chip" onclick="insertTag('{${h}}')">{${h}}</span>`;
  }).join(' ');

  if (data.detectedPhoneCol) {
    phoneColInput.value = data.detectedPhoneCol;
  }

  appendLog(null, `Sheet preview loaded (${data.totalRows} rows). Column header tags generated.`, 'success');
});

socket.on('sheet_preview_error', (data) => {
  alert(`Failed to preview Google Sheet: ${data.error}`);
  appendLog(null, `Sheet preview error: ${data.error}`, 'error');
});

// Broadcast Trigger
triggerNowBtn.addEventListener('click', async () => {
  const mediaFiles = mediaFileInput.files;
  let mediaItems = [];

  if (mediaFiles && mediaFiles.length > 0) {
    appendLog(null, `Processing ${mediaFiles.length} attached file(s)...`, 'info');
    for (const file of mediaFiles) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        mediaItems.push({ name: file.name, dataUrl });
      } catch (err) {
        alert(`Failed to read file ${file.name}: ${err.message}`);
        return;
      }
    }
  }

  const sheets = sheetUrlsInput.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (sheets.length === 0) {
    alert('Please enter at least one Google Spreadsheet URL.');
    return;
  }

  if (confirm(`Are you sure you want to trigger the WhatsApp broadcast to contacts extracted from ${sheets.length} spreadsheet(s)?`)) {
    socket.emit('start_broadcast', {
      sheets,
      sheetName: sheetTabInput.value.trim(),
      template: templateInput.value,
      phoneColumn: phoneColInput.value.trim(),
      defaultCountryCode: countryCodeInput.value.trim() || 'US',
      delayBetweenMessagesMs: parseInt(delayInput.value, 10) || 3000,
      mediaItems
    });
  }
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

logoutBtn.addEventListener('click', () => {
  if (confirm('Unlink WhatsApp session and rescan QR code?')) {
    socket.emit('logout');
  }
});

clearLogsBtn.addEventListener('click', () => {
  logsBox.innerHTML = '';
  logCount = 0;
  logCountBadge.textContent = '0 Events';
});
