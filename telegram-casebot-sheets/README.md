# Telegram Case Collector Bot (Google Sheets)

A small Telegram bot that:
- Only allows specific users to add new cases
- Asks a series of questions (step-by-step)
- Appends each completed case to **Google Sheets**

## Google Cloud setup (one-time)

1. Create a Google Cloud Project (console.cloud.google.com).
2. Enable **Google Sheets API** for the project.
3. Create a **Service Account** (IAM & Admin → Service Accounts).
4. Create a **JSON key** for the service account and copy:
   - `client_email`
   - `private_key`
5. Create a Google Spreadsheet and copy its ID from the URL:
   - `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
6. **Share the spreadsheet** with the Service Account's `client_email` (Editor access).

## Env vars (.env)

```
BOT_TOKEN=123456789:ABC_DEF-your-token-here
ALLOWED_USER_IDS=7072102659,123456
GOOGLE_SHEETS_ID=your_spreadsheet_id_here
GOOGLE_CLIENT_EMAIL=bot-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nABC...\n-----END PRIVATE KEY-----\n
SHEET_TAB=Cases
```

> If deploying on **Railway**, keep the `\n` escapes in `GOOGLE_PRIVATE_KEY`. The code converts them to real newlines.

## Run locally

```bash
npm install
node index.js
```

Commands:
- `/start` or `/new` – begin a new case
- `/cancel` – cancel the current flow
- `/whoami` – show your Telegram ID
- `/export` – replies with the spreadsheet link

## Customize the questions
Edit the `QUESTIONS` array in `index.js`. The header row is created automatically on first write.

## Railway deploy notes
- Add the env vars above in **Variables**.
- No HTTP server is required (bot uses long polling).
- Nothing is written to local disk (all data goes to Google Sheets).

