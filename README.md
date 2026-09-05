# WhatsApp Spreadsheet & Codeword Automation Bot

A 100% free, self-hosted automated WhatsApp Bot built with `whatsapp-web.js`, Express, and Socket.IO. It extracts contact data and custom template parameters from Google Spreadsheets and sends dynamic personalized WhatsApp messages triggered by interactive codewords on **WhatsApp**, **Telegram**, **Discord**, **HTTP Webhooks**, or the **Web Dashboard Control Panel**.

---

## 🌟 Interactive WhatsApp Campaign Setup Flow

You can compose and launch custom campaigns entirely inside WhatsApp via chat:

1. **Send `#COMPOSEMESSAGE` (or `#COMPOSE`)**:
   - The bot replies on WhatsApp asking for your message template.
2. **Reply with your Message Template & Media Attachment**:
   - Send your message text (supports `{Name}`, `{Status}`, `{Date}`, etc.).
   - Attach an **Image** or **Video** with a caption if desired!
3. **Reply with your Google Spreadsheet URL**:
   - Send your Google Sheet URL (e.g. `https://docs.google.com/spreadsheets/d/...`).
4. **Reply with the Phone Number Column Name**:
   - Type column name (e.g. `Phone`, `Mobile`, `WhatsApp`) or reply `AUTO`.
5. **Confirm and Broadcast**:
   - The bot previews the full campaign summary. Reply **`#STARTBROADCAST`** to confirm and launch!

*(Reply `CANCEL` anytime to abort setup)*

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

## 🛡️ License

ISC License. Completely free and open-source.

### If the bot takes too long to load the QR code, or gives an error message regarding launching browser

cd ~/whatsapp-bot-auto
# 1. Pull updated code
git reset --hard origin/main
git pull
# 2. Stop PM2 and clear any stale Chromium locks
pm2 stop whatsapp-bot
rm -rf .wwebjs_auth/session/Singleton*
# 3. Start PM2 cleanly
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
pm2 start index.js --name "whatsapp-bot"