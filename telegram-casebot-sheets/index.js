/**
 * Telegram "Case Collector" Bot — Google Sheets version
 * - Whitelist specific users
 * - Asks a series of questions step-by-step
 * - Appends each submission as a row in a Google Sheet
 *
 * Commands:
 *   /start   -> begin a new case
 *   /new     -> begin a new case
 *   /cancel  -> cancel current case
 *   /whoami  -> show your Telegram user id
 *   /export  -> get the Google Sheet link
 */

'use strict';
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');

const {
  BOT_TOKEN,
  ALLOWED_USER_IDS,
  GOOGLE_SHEETS_ID,
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  SHEET_TAB = 'Cases',
} = process.env;

if (!BOT_TOKEN) {
  console.error('❌ Missing BOT_TOKEN in .env');
  process.exit(1);
}
if (!GOOGLE_SHEETS_ID) {
  console.error('❌ Missing GOOGLE_SHEETS_ID in .env');
  process.exit(1);
}
if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  console.error('❌ Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY in .env');
  process.exit(1);
}

const allowedIds = (ALLOWED_USER_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number);

const bot = new Telegraf(BOT_TOKEN);

// Define your question flow here
const QUESTIONS = [
  { key: 'full_name', prompt: 'Enter the full name:' },
  { key: 'country', prompt: 'Which country?' },
  { key: 'phone', prompt: 'Phone number (with country code):' },
  { key: 'email', prompt: 'Email address:' },
  { key: 'notes', prompt: 'Any notes about this case?' },
];

// In-memory state: userId -> { index, answers }
const states = new Map();

function isAllowed(ctx) {
  if (allowedIds.length === 0) return true; // allow all if none specified
  return allowedIds.includes(ctx.from.id);
}

function startFlow(ctx) {
  states.set(ctx.from.id, {
    index: 0,
    answers: {
      telegram_id: ctx.from.id,
      username: ctx.from.username || '',
    },
  });
  return ctx.reply(
    `Let's add a new case.\nYou can /cancel anytime.\n\n${QUESTIONS[0].prompt}`
  );
}

bot.start(async (ctx) => {
  if (!isAllowed(ctx)) return ctx.reply('🚫 You are not authorized to add cases.');
  return startFlow(ctx);
});

bot.command('new', async (ctx) => {
  if (!isAllowed(ctx)) return ctx.reply('🚫 You are not authorized to add cases.');
  return startFlow(ctx);
});

bot.command('cancel', async (ctx) => {
  if (states.has(ctx.from.id)) {
    states.delete(ctx.from.id);
    return ctx.reply('❌ Case entry canceled.');
  }
  return ctx.reply('No active case to cancel.');
});

bot.command('whoami', async (ctx) => {
  return ctx.reply(`Your Telegram ID: ${ctx.from.id}`);
});

bot.command('export', async (ctx) => {
  if (!isAllowed(ctx)) return ctx.reply('🚫 You are not authorized.');
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_ID}/edit`;
  await ctx.reply(`📄 Google Sheet:\n${url}`);
});

bot.on('text', async (ctx) => {
  // Ignore random messages if user isn't in an active flow
  const state = states.get(ctx.from.id);
  if (!state) return;

  const question = QUESTIONS[state.index];
  const text = (ctx.message.text || '').trim();

  // Save answer
  state.answers[question.key] = text;
  state.index += 1;

  if (state.index < QUESTIONS.length) {
    const nextQ = QUESTIONS[state.index];
    await ctx.reply(nextQ.prompt);
  } else {
    try {
      await appendToGoogleSheet(state.answers);
      await ctx.reply('✅ Saved to Google Sheets.');
    } catch (err) {
      console.error('Error saving to Google Sheets:', err);
      await ctx.reply('⚠️ Error saving to Google Sheets. Please try again.');
    }
    states.delete(ctx.from.id);
  }
});

/** Google Sheets helpers **/

function getSheetsClient() {
  // Handle escaped newlines in Railway/Env vars
  const privateKey = (GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, auth };
}

async function ensureSheetAndHeader(sheets) {
  // Ensure target sheet (tab) exists; if not, create it
  const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEETS_ID });
  const existing = meta.data.sheets?.find(s => s.properties?.title === SHEET_TAB);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEETS_ID,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: SHEET_TAB } } }
        ]
      }
    });
  }

  // Ensure header row exists
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: `${SHEET_TAB}!1:1`,
  });
  const hasHeader = headerRes.data.values && headerRes.data.values.length > 0 && headerRes.data.values[0].length > 0;
  if (!hasHeader) {
    const headers = [
      'Timestamp',
      'Telegram ID',
      'Username',
      ...QUESTIONS.map(q => q.prompt.replace(/:$/, '')),
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: `${SHEET_TAB}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
}

async function appendToGoogleSheet(data) {
  const { sheets } = getSheetsClient();
  await ensureSheetAndHeader(sheets);

  const row = [
    new Date().toISOString(),
    data.telegram_id,
    data.username,
    ...QUESTIONS.map(q => data[q.key] || ''),
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: `${SHEET_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

bot.launch()
  .then(() => console.log('✅ Bot is running'))
  .catch((err) => console.error('Failed to launch bot:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
