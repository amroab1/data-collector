/**
 * Telegram "Case Collector" Bot — Google Sheets (Arabic)
 * - يقيّد الاستخدام على مُعرفات محددة
 * - يسأل أسئلة خطوة بخطوة (بالعربية)
 * - يحفظ كل حالة كسطر في Google Sheet
 *
 * الأوامر:
 *   /start   -> ابدأ حالة جديدة
 *   /new     -> ابدأ حالة جديدة
 *   /cancel  -> إلغاء الحالة الحالية
 *   /whoami  -> اظهار معرّفك على تليجرام
 *   /export  -> رابط جدول Google Sheets
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

// الأسئلة (المفتاح داخلي بالإنجليزية – العناوين بالعربية ستظهر في الشيت)
const QUESTIONS = [
  { key: 'head_of_household', prompt: 'اسم رب الاسرة:' },
  { key: 'births', prompt: 'المواليد:' },
  { key: 'phone', prompt: 'رقم الموبايل:' },
  { key: 'health_status', prompt: 'الحالة الصحية:' },
  { key: 'wife_name', prompt: 'اسم الزوجة:' },
  { key: 'wife_phone', prompt: 'رقم الموبايل للزوجة:' },
  { key: 'wife_birthdate', prompt: 'تاريخ ميلاد الزوجة:' },
  { key: 'wife_health_status', prompt: 'الحالة الصحية للزوجة:' },
  { key: 'children_count', prompt: 'عدد الابناء:' },
  { key: 'children_names_ages', prompt: 'اسماء الابناء + الاعمار (جميع الاسماء و الاعمار بخانة واحدة):' },
  { key: 'current_location', prompt: 'مكان التواجد الحالي:' },
  { key: 'birthplace', prompt: 'مسقط الرأس:' },
  { key: 'house_damaged', prompt: 'هل المنزل متضرر (جاوب ب نعم او لا):', type: 'yesno' },
  { key: 'martyrs_in_family', prompt: 'هل يوجد شهداء بالعائلة (ب نعم او لا):', type: 'yesno' },
  { key: 'martyrs_names', prompt: 'اسماء الشهداء (الاسماء جميعا بخانة واحدة):' },
  { key: 'missing_names', prompt: 'اسماء المفقودين (الاسماء جميعا بخانة واحدة):' },
  { key: 'injured_names_status', prompt: 'اسماء المصابين + حالة المصاب (الاسماء جميعا بخانة واحدة):' },
  { key: 'extra_notes', prompt: 'ملاحظات اضافية:' },
];

// حالة المستخدمين: userId -> { index, answers }
const states = new Map();

function isAllowed(ctx) {
  if (allowedIds.length === 0) return true; // لو ما في لائحة، يسمح للجميع
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
    `سنبدأ بإضافة حالة جديدة.\nيمكنك الإلغاء في أي وقت عبر /cancel.\n\n${QUESTIONS[0].prompt}`
  );
}

bot.start(async (ctx) => {
  if (!isAllowed(ctx)) return ctx.reply('🚫 لست مخوّلاً لإضافة حالات.');
  return startFlow(ctx);
});

bot.command('new', async (ctx) => {
  if (!isAllowed(ctx)) return ctx.reply('🚫 لست مخوّلاً لإضافة حالات.');
  return startFlow(ctx);
});

bot.command('cancel', async (ctx) => {
  if (states.has(ctx.from.id)) {
    states.delete(ctx.from.id);
    return ctx.reply('❌ تم إلغاء إدخال الحالة.');
  }
  return ctx.reply('لا توجد حالة قيد الإدخال لإلغائها.');
});

bot.command('whoami', async (ctx) => {
  return ctx.reply(`معرّفك على تليجرام: ${ctx.from.id}`);
});

bot.command('export', async (ctx) => {
  if (!isAllowed(ctx)) return ctx.reply('🚫 غير مخوّل.');
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_ID}/edit`;
  await ctx.reply(`📄 جدول Google Sheets:\n${url}`);
});

bot.on('text', async (ctx) => {
  const state = states.get(ctx.from.id);
  if (!state) return; // تجاهل الرسائل العشوائية خارج التدفق

  const question = QUESTIONS[state.index];
  let text = (ctx.message.text || '').trim();

  // تحقق من أسئلة نعم/لا
  if (question?.type === 'yesno') {
    const yn = normalizeYesNo(text);
    if (yn === null) {
      return ctx.reply('الرجاء الإجابة بـ "نعم" أو "لا" فقط:', { reply_to_message_id: ctx.message.message_id });
    }
    text = yn ? 'نعم' : 'لا';
  }

  // حفظ الإجابة
  state.answers[question.key] = text;
  state.index += 1;

  if (state.index < QUESTIONS.length) {
    const nextQ = QUESTIONS[state.index];
    await ctx.reply(nextQ.prompt);
  } else {
    try {
      await appendToGoogleSheet(state.answers);
      await ctx.reply('✅ تم الحفظ بنجاح في Google Sheets.');
    } catch (err) {
      console.error('Error saving to Google Sheets:', err);
      await ctx.reply('⚠️ حدث خطأ أثناء الحفظ في Google Sheets. حاول مرة أخرى.');
    }
    states.delete(ctx.from.id);
  }
});

// دالة مساعدة: تحويل نعم/لا
function normalizeYesNo(input) {
  const s = (input || '').trim().toLowerCase();
  const yes = new Set(['نعم', 'اي', 'أيوه', 'ايوه', 'na3am', 'naam', 'yes', 'y']);
  const no  = new Set(['لا', 'لاء', 'la', 'no', 'n']);
  if (yes.has(s)) return true;
  if (no.has(s)) return false;
  return null;
}

/** Google Sheets helpers **/

function getSheetsClient() {
  const privateKey = (GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'); // تحويل \n لأسطر جديدة
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
  // تأكد من وجود التبويب، وإنشاء صف العناوين إذا لزم
  const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEETS_ID });
  const existing = meta.data.sheets?.find(s => s.properties?.title === SHEET_TAB);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEETS_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] }
    });
  }

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: `${SHEET_TAB}!1:1`,
  });
  const hasHeader = headerRes.data.values && headerRes.data.values.length > 0 && headerRes.data.values[0].length > 0;
  if (!hasHeader) {
    const headers = [
      'التاريخ والوقت (UTC)',
      'معرّف تليجرام',
      'اسم المستخدم',
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
  .then(() => console.log('✅ Bot is running (Arabic)'))
  .catch((err) => console.error('Failed to launch bot:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
