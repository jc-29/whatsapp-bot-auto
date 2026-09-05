// State & Auth Token Helper
function getAuthToken() {
  return localStorage.getItem('auth_token') || '';
}

function setAuthToken(token) {
  if (token) localStorage.setItem('auth_token', token);
  else localStorage.removeItem('auth_token');
}

// Socket.IO Client Initialization with Render proxy fallback
const socket = io({
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
  autoConnect: false
});

// State
let currentConfig = {};
let logCount = 0;
let serverGoogleClientId = '';
let isDashboardRendered = false;

// DOM Element Variables
let statusBadge, logoutBtn, qrBox, qrSpinner, qrCodeImg, readyStatus, userPushname, userNumber;
let userProfileBadge, userAvatarCircle, userDisplayName, userDisplayEmail, lockScreenBtn;
let googleClientIdInput, allowedEmailsInput, adminPasswordInput, authRequiredCheckbox;
let codewordInput, adminNumbersInput, webhookSecretInput, saveConfigBtn;
let sheetUrlsInput, sheetTabInput, phoneColInput, countryCodeInput, previewSheetBtn;
let sheetPreviewBox, previewTotalRows, previewTable, detectedTagsChips;
let templateInput, whatsappPreviewText, mediaFileInput, delayInput, triggerNowBtn;
let logsBox, logCountBadge, clearLogsBtn;
let progressContainer, progressText, progressPercent, progressBarFill;

// Auth Modal Static Elements
const loginModal = document.getElementById('login-modal');
const googleBtnWrapper = document.getElementById('google-btn-wrapper');
const passcodeLoginForm = document.getElementById('passcode-login-form');
const passcodeInput = document.getElementById('passcode-input');
const loginErrorMsg = document.getElementById('login-error-msg');

// Dynamic Template Rendering
function renderDashboardUI() {
  if (isDashboardRendered) return;
  const tpl = document.getElementById('dashboard-template');
  const root = document.getElementById('dashboard-root');
  if (tpl && root) {
    root.appendChild(tpl.content.cloneNode(true));
    isDashboardRendered = true;
    bindDashboardElements();
  }
}

function unloadDashboardUI() {
  const root = document.getElementById('dashboard-root');
  if (root) root.innerHTML = '';
  isDashboardRendered = false;
}

function bindDashboardElements() {
  statusBadge = document.getElementById('status-badge');
  logoutBtn = document.getElementById('logout-btn');
  qrBox = document.getElementById('qr-box');
  qrSpinner = document.getElementById('qr-spinner');
  qrCodeImg = document.getElementById('qrcode');
  readyStatus = document.getElementById('ready-status');
  userPushname = document.getElementById('user-pushname');
  userNumber = document.getElementById('user-number');

  userProfileBadge = document.getElementById('user-profile-badge');
  userAvatarCircle = document.getElementById('user-avatar-circle');
  userDisplayName = document.getElementById('user-display-name');
  userDisplayEmail = document.getElementById('user-display-email');
  lockScreenBtn = document.getElementById('lock-screen-btn');

  googleClientIdInput = document.getElementById('google-client-id-input');
  allowedEmailsInput = document.getElementById('allowed-emails-input');
  adminPasswordInput = document.getElementById('admin-password-input');
  authRequiredCheckbox = document.getElementById('auth-required-checkbox');

  codewordInput = document.getElementById('codeword-input');
  adminNumbersInput = document.getElementById('admin-numbers-input');
  webhookSecretInput = document.getElementById('webhook-secret-input');
  saveConfigBtn = document.getElementById('save-config-btn');

  sheetUrlsInput = document.getElementById('sheet-urls-input');
  sheetTabInput = document.getElementById('sheet-tab-input');
  phoneColInput = document.getElementById('phone-col-input');
  countryCodeInput = document.getElementById('country-code-input');
  previewSheetBtn = document.getElementById('preview-sheet-btn');

  sheetPreviewBox = document.getElementById('sheet-preview-box');
  previewTotalRows = document.getElementById('preview-total-rows');
  previewTable = document.getElementById('preview-table');
  detectedTagsChips = document.getElementById('detected-tags-chips');

  templateInput = document.getElementById('template-input');
  whatsappPreviewText = document.getElementById('whatsapp-preview-text');
  mediaFileInput = document.getElementById('media-file-input');
  delayInput = document.getElementById('delay-input');
  triggerNowBtn = document.getElementById('trigger-now-btn');

  logsBox = document.getElementById('logs-box');
  logCountBadge = document.getElementById('log-count');
  clearLogsBtn = document.getElementById('clear-logs-btn');

  progressContainer = document.getElementById('progress-container');
  progressText = document.getElementById('progress-text');
  progressPercent = document.getElementById('progress-percent');
  progressBarFill = document.getElementById('progress-bar-fill');

  // Event Listeners
  if (templateInput) templateInput.addEventListener('input', updateLivePreview);
  if (saveConfigBtn) saveConfigBtn.addEventListener('click', handleSaveConfig);
  if (previewSheetBtn) previewSheetBtn.addEventListener('click', handlePreviewSheet);
  if (triggerNowBtn) triggerNowBtn.addEventListener('click', handleTriggerBroadcast);
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  if (clearLogsBtn) clearLogsBtn.addEventListener('click', handleClearLogs);
  if (lockScreenBtn) lockScreenBtn.addEventListener('click', handleLockScreen);

  if (currentConfig && Object.keys(currentConfig).length > 0) {
    populateConfigFields(currentConfig);
  }
}

// Authentication & Session Management
function showLoginModal(errorMsg = '') {
  unloadDashboardUI();
  loginModal.style.display = 'flex';
  if (errorMsg) {
    loginErrorMsg.style.display = 'block';
    loginErrorMsg.textContent = errorMsg;
  } else {
    loginErrorMsg.style.display = 'none';
  }
}

function hideLoginModal() {
  renderDashboardUI();
  loginModal.style.display = 'none';
  loginErrorMsg.style.display = 'none';
}

function updateAuthUserProfile(user) {
  if (!user || !userProfileBadge) return;
  userProfileBadge.style.display = 'flex';
  if (userDisplayName) userDisplayName.textContent = user.name || 'Admin User';
  if (userDisplayEmail) userDisplayEmail.textContent = user.email || 'Authenticated';

  if (userAvatarCircle) {
    if (user.picture) {
      userAvatarCircle.innerHTML = `<img src="${user.picture}" alt="Avatar" />`;
    } else {
      userAvatarCircle.innerHTML = `<i class="fa-solid fa-user"></i>`;
    }
  }
}

function connectSocketWithToken() {
  const token = getAuthToken();
  socket.auth = { token };
  if (!socket.connected) {
    socket.connect();
  }
}

async function checkAuthSession() {
  try {
    const res = await fetch('/api/status');
    const statusData = await res.json();
    
    serverGoogleClientId = statusData.googleClientId || '';
    initGoogleSignInSDK(serverGoogleClientId);

    if (!statusData.authRequired) {
      hideLoginModal();
      updateAuthUserProfile({ name: 'Admin', email: 'Auth Disabled' });
      connectSocketWithToken();
      return;
    }

    const token = getAuthToken();
    if (!token) {
      showLoginModal();
      return;
    }

    const meRes = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const meData = await meRes.json();

    if (meData.success) {
      hideLoginModal();
      updateAuthUserProfile(meData.user);
      connectSocketWithToken();
    } else {
      setAuthToken('');
      showLoginModal();
    }
  } catch (err) {
    console.error('Auth verification failed:', err);
    showLoginModal('Failed to connect to authentication server');
  }
}

function initGoogleSignInSDK(clientId) {
  if (!clientId || typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
    return;
  }

  try {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: window.handleGoogleSignInCallback
    });

    google.accounts.id.renderButton(
      document.getElementById('google-btn-wrapper'),
      { theme: 'filled_blue', size: 'large', width: 280 }
    );
  } catch (err) {
    console.warn('Google Sign-In initialization warning:', err.message);
  }
}

// Global Google Sign-In Callback
window.handleGoogleSignInCallback = async function(response) {
  if (!response || !response.credential) return;

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: response.credential })
    });
    const data = await res.json();

    if (data.success) {
      setAuthToken(data.token);
      hideLoginModal();
      updateAuthUserProfile(data.user);
      connectSocketWithToken();
    } else {
      showLoginModal(data.error || 'Google Sign-In failed');
    }
  } catch (err) {
    showLoginModal(`Google Login Error: ${err.message}`);
  }
};

// Passcode Form Submit Event
passcodeLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = passcodeInput.value;
  if (!password) return;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();

    if (data.success) {
      setAuthToken(data.token);
      hideLoginModal();
      updateAuthUserProfile(data.user);
      connectSocketWithToken();
    } else {
      showLoginModal(data.error || 'Invalid passcode');
    }
  } catch (err) {
    showLoginModal(`Login Error: ${err.message}`);
  }
});

function handleLockScreen() {
  setAuthToken('');
  if (socket.connected) socket.disconnect();
  showLoginModal('Session locked. Please log in again.');
}

// Socket Connect Error
socket.on('connect_error', (err) => {
  if (err.message && err.message.includes('Authentication')) {
    setAuthToken('');
    showLoginModal('Session expired or unauthorized. Please login again.');
  }
});

// Utility Functions
function updateStatusBadge(state, text) {
  if (!statusBadge) return;
  statusBadge.className = `status-badge badge-${state}`;
  const statusText = statusBadge.querySelector('.status-text');
  if (statusText) statusText.textContent = text;
}

function appendLog(timestamp, text, type = 'info') {
  if (!logsBox) return;
  logCount++;
  if (logCountBadge) logCountBadge.textContent = `${logCount} Events`;

  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${timestamp || new Date().toLocaleTimeString()}] [${type.toUpperCase()}] ${text}`;
  
  logsBox.appendChild(entry);
  logsBox.scrollTop = logsBox.scrollHeight;
}

// Global Tag Insertion Helper for onclick
window.insertTag = function(tag) {
  if (!templateInput) return;
  const cursorPos = templateInput.selectionStart;
  const text = templateInput.value;
  templateInput.value = text.substring(0, cursorPos) + tag + text.substring(cursorPos);
  templateInput.focus();
  updateLivePreview();
};

function updateLivePreview() {
  if (!templateInput || !whatsappPreviewText) return;
  const rawText = templateInput.value || '';
  if (!rawText.trim()) {
    whatsappPreviewText.innerHTML = '<em>Type a message template to see preview...</em>';
    return;
  }

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
  if (qrSpinner) qrSpinner.style.display = 'none';
  if (readyStatus) readyStatus.style.display = 'none';
  if (qrCodeImg) {
    qrCodeImg.src = qrDataUrl;
    qrCodeImg.style.display = 'block';
  }
  if (logoutBtn) logoutBtn.style.display = 'none';
  appendLog(null, 'QR Code received. Please scan with your WhatsApp phone app.', 'info');
});

socket.on('authenticated', () => {
  updateStatusBadge('connecting', 'WhatsApp Authenticated');
  if (qrSpinner) qrSpinner.style.display = 'flex';
  if (qrCodeImg) qrCodeImg.style.display = 'none';
  appendLog(null, 'WhatsApp authenticated. Loading session details...', 'success');
});

socket.on('ready', (info) => {
  updateStatusBadge('connected', 'WhatsApp Ready');
  if (qrSpinner) qrSpinner.style.display = 'none';
  if (qrCodeImg) qrCodeImg.style.display = 'none';
  if (readyStatus) readyStatus.style.display = 'flex';
  if (logoutBtn) logoutBtn.style.display = 'inline-flex';

  if (info && info.pushname && userPushname) {
    userPushname.textContent = info.pushname;
    if (userNumber) userNumber.textContent = info.number ? `+${info.number}` : '';
  }
  appendLog(null, `WhatsApp Client is Ready! (${info.pushname || info.number || 'Active Session'})`, 'success');
});

socket.on('disconnected', (reason) => {
  updateStatusBadge('disconnected', 'Logged Out');
  if (qrSpinner) qrSpinner.style.display = 'flex';
  if (qrCodeImg) qrCodeImg.style.display = 'none';
  if (readyStatus) readyStatus.style.display = 'none';
  if (logoutBtn) logoutBtn.style.display = 'none';
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
  if (!isDashboardRendered) return;
  if (cfg.codeword !== undefined && codewordInput) codewordInput.value = cfg.codeword;
  if (cfg.adminNumbers && adminNumbersInput) adminNumbersInput.value = Array.isArray(cfg.adminNumbers) ? cfg.adminNumbers.join(', ') : cfg.adminNumbers;
  if (cfg.webhookSecret !== undefined && webhookSecretInput) webhookSecretInput.value = cfg.webhookSecret;

  if (cfg.googleClientId !== undefined && googleClientIdInput) {
    googleClientIdInput.value = cfg.googleClientId;
    if (cfg.googleClientId && cfg.googleClientId !== serverGoogleClientId) {
      serverGoogleClientId = cfg.googleClientId;
      initGoogleSignInSDK(serverGoogleClientId);
    }
  }
  if (cfg.allowedEmails && allowedEmailsInput) allowedEmailsInput.value = Array.isArray(cfg.allowedEmails) ? cfg.allowedEmails.join(', ') : cfg.allowedEmails;
  if (cfg.adminPassword !== undefined && adminPasswordInput) adminPasswordInput.value = cfg.adminPassword;
  if (cfg.authRequired !== undefined && authRequiredCheckbox) authRequiredCheckbox.checked = !!cfg.authRequired;

  if (cfg.sheets && Array.isArray(cfg.sheets) && sheetUrlsInput) sheetUrlsInput.value = cfg.sheets.join('\n');
  if (cfg.defaultSheetTab !== undefined && sheetTabInput) sheetTabInput.value = cfg.defaultSheetTab;
  if (cfg.phoneColumn !== undefined && phoneColInput) phoneColInput.value = cfg.phoneColumn;
  if (cfg.defaultCountryCode !== undefined && countryCodeInput) countryCodeInput.value = cfg.defaultCountryCode;

  if (cfg.template !== undefined && templateInput) {
    templateInput.value = cfg.template;
    updateLivePreview();
  }
  if (cfg.delayBetweenMessagesMs !== undefined && delayInput) delayInput.value = cfg.delayBetweenMessagesMs;
}

// Progress & Broadcast events
socket.on('broadcast_start', (data) => {
  if (!progressContainer) return;
  progressContainer.style.display = 'block';
  if (progressText) progressText.textContent = `Processing 0 of ${data.total}...`;
  if (progressPercent) progressPercent.textContent = '0%';
  if (progressBarFill) progressBarFill.style.width = '0%';
  if (triggerNowBtn) triggerNowBtn.disabled = true;
});

socket.on('message_status', (data) => {
  if (!progressContainer) return;
  const percent = Math.round((data.index / data.total) * 100);
  if (progressText) progressText.textContent = `Sent ${data.index} of ${data.total} (Current: ${data.number})`;
  if (progressPercent) progressPercent.textContent = `${percent}%`;
  if (progressBarFill) progressBarFill.style.width = `${percent}%`;
});

socket.on('broadcast_complete', (summary) => {
  if (progressText) progressText.textContent = `Completed! Sent: ${summary.success}, Failed: ${summary.failed}, Total: ${summary.total}`;
  if (progressPercent) progressPercent.textContent = '100%';
  if (progressBarFill) progressBarFill.style.width = '100%';
  if (triggerNowBtn) triggerNowBtn.disabled = false;
});

socket.on('broadcast_error', (errMsg) => {
  alert(`Broadcast Error: ${errMsg}`);
  if (triggerNowBtn) triggerNowBtn.disabled = false;
});

function handleSaveConfig() {
  const sheets = sheetUrlsInput ? sheetUrlsInput.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
  const adminNumbers = adminNumbersInput ? adminNumbersInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
  const allowedEmails = allowedEmailsInput ? allowedEmailsInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];

  const updatedConfig = {
    codeword: codewordInput ? codewordInput.value.trim() : '#STARTBROADCAST',
    adminNumbers,
    webhookSecret: webhookSecretInput ? webhookSecretInput.value.trim() : '',
    googleClientId: googleClientIdInput ? googleClientIdInput.value.trim() : '',
    allowedEmails,
    adminPassword: adminPasswordInput ? adminPasswordInput.value.trim() : 'admin',
    authRequired: authRequiredCheckbox ? authRequiredCheckbox.checked : true,
    sheets,
    defaultSheetTab: sheetTabInput ? sheetTabInput.value.trim() : '',
    phoneColumn: phoneColInput ? phoneColInput.value.trim() : 'Phone',
    defaultCountryCode: countryCodeInput ? countryCodeInput.value.trim() : 'US',
    template: templateInput ? templateInput.value : '',
    delayBetweenMessagesMs: delayInput ? (parseInt(delayInput.value, 10) || 3000) : 3000
  };

  socket.emit('update_config', updatedConfig);
}

function handlePreviewSheet() {
  const sheets = sheetUrlsInput ? sheetUrlsInput.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
  if (sheets.length === 0) {
    alert('Please enter at least one Google Spreadsheet URL first.');
    return;
  }
  appendLog(null, `Requesting preview for sheet: ${sheets[0]}`, 'info');
  socket.emit('fetch_sheet_preview', { sheetUrl: sheets[0], sheetName: sheetTabInput ? sheetTabInput.value.trim() : '' });
}

socket.on('sheet_preview_result', (data) => {
  if (!sheetPreviewBox) return;
  sheetPreviewBox.style.display = 'block';
  if (previewTotalRows) previewTotalRows.textContent = `${data.totalRows} rows`;

  const thead = previewTable.querySelector('thead');
  if (thead) thead.innerHTML = `<tr>${data.headers.map(h => `<th>${h}</th>`).join('')}</tr>`;

  const tbody = previewTable.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = data.sampleRows.map(row => {
      return `<tr>${data.headers.map(h => `<td>${row[h] !== undefined ? row[h] : ''}</td>`).join('')}</tr>`;
    }).join('');
  }

  if (detectedTagsChips) {
    detectedTagsChips.innerHTML = data.headers.map(h => {
      return `<span class="tag-chip" onclick="insertTag('{${h}}')">{${h}}</span>`;
    }).join(' ');
  }

  if (data.detectedPhoneCol && phoneColInput) {
    phoneColInput.value = data.detectedPhoneCol;
  }

  appendLog(null, `Sheet preview loaded (${data.totalRows} rows). Column header tags generated.`, 'success');
});

socket.on('sheet_preview_error', (data) => {
  alert(`Failed to preview Google Sheet: ${data.error}`);
  appendLog(null, `Sheet preview error: ${data.error}`, 'error');
});

function handleTriggerBroadcast() {
  const mediaFiles = mediaFileInput ? mediaFileInput.files : [];
  let mediaItems = [];

  const sheets = sheetUrlsInput ? sheetUrlsInput.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
  if (sheets.length === 0) {
    alert('Please enter at least one Google Spreadsheet URL.');
    return;
  }

  const processAndStart = async () => {
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

    if (confirm(`Are you sure you want to trigger the WhatsApp broadcast to contacts extracted from ${sheets.length} spreadsheet(s)?`)) {
      socket.emit('start_broadcast', {
        sheets,
        sheetName: sheetTabInput ? sheetTabInput.value.trim() : '',
        template: templateInput ? templateInput.value : '',
        phoneColumn: phoneColInput ? phoneColInput.value.trim() : 'Phone',
        defaultCountryCode: countryCodeInput ? countryCodeInput.value.trim() : 'US',
        delayBetweenMessagesMs: delayInput ? (parseInt(delayInput.value, 10) || 3000) : 3000,
        mediaItems
      });
    }
  };

  processAndStart();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function handleLogout() {
  if (confirm('Unlink WhatsApp session and rescan QR code?')) {
    socket.emit('logout');
  }
}

function handleClearLogs() {
  if (logsBox) logsBox.innerHTML = '';
  logCount = 0;
  if (logCountBadge) logCountBadge.textContent = '0 Events';
}

// Initialize Auth Verification on page load
checkAuthSession();
