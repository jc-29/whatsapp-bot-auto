# WhatsApp Spreadsheet & Codeword Automation Bot

A 100% free, self-hosted automated WhatsApp Bot built with `whatsapp-web.js`, Express, and Socket.IO. It extracts contact data and custom template parameters from Google Spreadsheets and sends dynamic personalized WhatsApp messages when triggered by custom codewords via **WhatsApp**, **Telegram**, **Discord**, **HTTP Webhooks**, or the **Web Dashboard Control Panel**.

---

## 🌟 Features

- 🆓 **100% Free**: No WhatsApp Business API fees or paid database tools required. Uses `whatsapp-web.js` browser automation via Puppeteer.
- 📊 **Google Spreadsheet Automation**: Automatically reads public shared Google Sheets (`Anyone with the link can view`), extracts headers, and supports dynamic placeholders (`{Name}`, `{Date}`, `{Phone}`, `{Status}`, etc.).
- 💬 **Dynamic Template Substitution**: Placeholders in your message template (e.g. `Hello {Name}, your account {Account ID} is {Status}`) are replaced automatically with row values from your spreadsheet.
- ⚡ **Multi-Platform Codeword Activation**:
  - **WhatsApp**: Trigger broadcast by sending your codeword (e.g. `#STARTBROADCAST` or `RUN_BOT`) directly to the linked WhatsApp account.
  - **Telegram Bot**: Trigger via a free Telegram Bot (`node-telegram-bot-api`).
  - **Discord Webhook**: Send notifications or trigger via Discord.
  - **HTTP Webhook**: Trigger via `/api/trigger?codeword=#STARTBROADCAST&secret=secret-123` from external platforms, Zapier free tier, IFTTT, or cURL.
- 🖥️ **Modern Web Control Dashboard**: Sleek dark-mode glassmorphism interface featuring:
  - Real-time WhatsApp Web QR Code scanner modal.
  - Google Spreadsheet URL manager and live row preview table.
  - Interactive placeholder tag chips for quick insertion.
  - WhatsApp live message preview box.
  - Media attachment uploader (images, videos, PDFs).
  - Anti-spam delay adjustment to prevent WhatsApp throttling.
  - Terminal activity log console with live progress bar.

---

## 🚀 Quick Start

### 1. Installation

Ensure Node.js (v18 or higher) is installed on your machine.

```bash
# Navigate to project folder
cd c:\Users\Jonathan\Freelance\whatsapp-bot-auto

# Install dependencies
npm install
```

### 2. Running the Bot

```bash
npm start
```

Open your browser and navigate to:
```
http://localhost:3000
```

---

## 📱 Linking WhatsApp

1. Launch the server and open `http://localhost:3000`.
2. A QR Code will render in the **WhatsApp Web Scanner** card.
3. Open WhatsApp on your mobile phone:
   - **Android**: Tap `⋮` (three dots) > **Linked devices** > **Link a device**.
   - **iPhone**: Go to **Settings** > **Linked devices** > **Link a device**.
4. Scan the QR code displayed on your screen.
5. Once scanned, the session is saved locally in `.wwebjs_auth`. You will stay logged in automatically across server restarts!

---

## 📊 Setting Up Google Spreadsheets

1. Create or open your Google Spreadsheet (e.g. containing columns like `Name`, `Phone`, `Status`, `Account ID`).
2. Click **Share** at the top right of your Google Sheet.
3. Change General Access to **"Anyone with the link can view"**.
4. Copy the URL from your browser address bar and paste it into the **Google Spreadsheets Manager** in the dashboard.
5. Enter your phone number column header (e.g., `Phone`, `Mobile`, `WhatsApp`). If left empty, the bot automatically detects it!

---

## 🔑 Codeword Activation Examples

### 1. WhatsApp Codeword Activation
Send a WhatsApp message containing your configured codeword (e.g., `#STARTBROADCAST`) to your WhatsApp number. The bot will parse the spreadsheet and send status updates back to you!

### 2. HTTP Webhook Activation
Send a GET or POST request to your local server:
```bash
curl -X POST "http://localhost:3000/api/trigger?codeword=#STARTBROADCAST&secret=secret-codeword-123"
```

---

## 📁 File Structure

```
whatsapp-bot-auto/
├── index.js             # Express + Socket.IO server & WhatsApp Web client
├── config.json          # Persistent bot configuration
├── package.json         # Node.js dependencies
├── lib/
│   ├── sheets.js        # Google Spreadsheet fetcher & template engine
│   └── triggers.js      # WhatsApp, Telegram, Discord, and Webhook trigger engine
└── public/
    ├── index.html       # Web Control Panel UI layout
    ├── styles.css       # Glassmorphism dark mode styles
    └── app.js           # Client-side Socket.IO & dynamic UI logic
```

---

## 🛡️ License

ISC License. Completely free and open-source.
