const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const db = require('./db');

const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PRICE_HISTORY_FILE = path.join(__dirname, 'price_history.json');
const CUSTOMERS_FILE = path.join(__dirname, 'customers.json');
const JWT_SECRET = process.env.JWT_SECRET || 'al-ghaith-gold-jwt-secret-2024';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- In-Memory Caches ---
let cachedConfig = null;
let cachedCustomers = null;
let cachedPriceHistory = null;

// Data source freshness tracking
let lastSuccessfulGoldFetch = null; // timestamp of last successful gold price fetch
let lastSuccessfulExchangeFetch = null; // timestamp of last successful exchange rate fetch
let lastGoldFetchSource = null; // 'primary' or 'backup'
let lastGoldFetchFailed = false;
let lastExchangeFetchFailed = false;
let lastExchangeFetchSource = null;

// Helper to read config from cache
function readConfig() {
  if (!cachedConfig) {
    cachedConfig = readConfigLocal();
  }
  return cachedConfig;
}

// Local filesystem fallback
const DEFAULTS = {
  ouncePrice: 3350,
  exchangeRate: 1480,
  marketMargin: 0,
  ownerPhone: "9647701234567",
  botName: "صياغة ومجوهرات الغيث",
  geminiApiKey: "",
  geminiInstructions: "",
  adminUsername: "",
  adminPassword: "",
  customReplies: [],
  botEnabled: true
};

function readConfigLocal() {
  let config = { ...DEFAULTS };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = { ...config, ...parsed };
    }
  } catch (err) {
    console.error('Error reading config file:', err);
  }

  // Environment variable overrides for secure deployment
  if (process.env.GEMINI_API_KEY) config.geminiApiKey = process.env.GEMINI_API_KEY;
  if (process.env.ADMIN_USERNAME) config.adminUsername = process.env.ADMIN_USERNAME;
  if (process.env.ADMIN_PASSWORD) config.adminPassword = process.env.ADMIN_PASSWORD;
  if (process.env.OWNER_PHONE) config.ownerPhone = process.env.OWNER_PHONE;
  if (process.env.BOT_NAME) config.botName = process.env.BOT_NAME;

  return config;
}

// Helper to write config
async function writeConfig(config) {
  cachedConfig = config;
  try {
    if (db.isDbEnabled()) {
      await db.writeConfigDB(config);
    } else {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    }
    // Notify all WebSocket clients about config change
    broadcast({ type: 'config_update', config });
  } catch (err) {
    console.error('Error writing config:', err);
  }
}

// WebSocket broadcast
function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Global WhatsApp status variables
let whatsappStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED, QR_READY
let qrCodeData = '';
let sock = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 300000; // 5 min max

// Exchange rate fallback chain
// Cached exchange rate to avoid scraping egcurrency.com too often
let cachedExchangeRate = null;
let exchangeRateCacheTime = 0;
const EXCHANGE_RATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Gold price fallback chain
async function fetchGoldPriceWithFallback() {
  // 1. Primary: gold-api.com
  try {
    const res = await fetch('https://api.gold-api.com/price/XAU', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      const price = Number(data.price);
      if (!isNaN(price) && price > 0) {
        lastGoldFetchSource = 'primary';
        lastGoldFetchFailed = false;
        lastSuccessfulGoldFetch = Date.now();
        return Math.round(price * 100) / 100;
      }
    }
  } catch (e) {
    console.warn('[Gold Price] Primary API failed:', e.message);
  }

  // 2. Backup: Google Finance
  try {
    const res = await fetch('https://www.google.com/finance/quote/XAU-USD', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/data-last-price="([\d.]+)"/);
      if (m) {
        const price = Number(m[1]);
        if (!isNaN(price) && price > 0) {
          lastGoldFetchSource = 'backup';
          lastGoldFetchFailed = false;
          lastSuccessfulGoldFetch = Date.now();
          console.log(`[Gold Price] Backup (Google Finance) price: $${price}`);
          return price;
        }
      }
    }
  } catch (e) {
    console.warn('[Gold Price] Backup (Google Finance) failed:', e.message);
  }

  // 3. All failed
  lastGoldFetchFailed = true;
  console.error('[Gold Price] All sources failed.');
  return null;
}

async function fetchExchangeRateWithFallback() {
  // 1. Try egcurrency.com (parallel market rate - المستخدم بالشارع)
  try {
    const res = await fetch('https://egcurrency.com/en/currency/usd/iqd');
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/USD-to-IQD\/blackMarket[\s\S]*?>\s*([\d,.]+)/i);
      if (m) {
        const rate = Number(m[1].replace(/,/g, ''));
        if (!isNaN(rate) && rate > 500 && rate < 3000) {
          lastExchangeFetchSource = 'primary';
          console.log(`[Exchange Rate] egcurrency parallel rate: ${rate} IQD`);
          return rate;
        }
      }
    }
  } catch (e) {
    console.warn('[Exchange Rate] egcurrency failed:', e.message);
  }

  // 2. Try Google Finance as backup
  try {
    const res = await fetch('https://www.google.com/finance/quote/USD-IQD');
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/"ltr"[^>]*?>([\d,.]+)/i);
      if (m) {
        const rate = Number(m[1].replace(/,/g, ''));
        if (!isNaN(rate) && rate > 500 && rate < 3000) {
          lastExchangeFetchSource = 'backup';
          console.log(`[Exchange Rate] Google Finance rate: ${rate} IQD`);
          return rate;
        }
      }
    }
  } catch (e) {
    console.warn('[Exchange Rate] Google Finance failed:', e.message);
  }

  // 3. Fallback: Keep last successful rate (from memory cache)
  if (cachedExchangeRate) {
    lastExchangeFetchSource = 'cache';
    console.log(`[Exchange Rate] All sources failed, falling back to cached parallel rate: ${cachedExchangeRate} IQD`);
    return cachedExchangeRate;
  }

  console.error('[Exchange Rate] All sources failed and no cached rate available.');
  return null;
}

// Dynamic check for Baileys WhatsApp library
let whatsappLibAvailable = false;
try {
  require.resolve('@whiskeysockets/baileys');
  whatsappLibAvailable = true;
  console.log('Baileys WhatsApp library is available.');
} catch (e) {
  console.log('Baileys WhatsApp library is NOT installed. Running in simulation-only mode.');
}

// Price calculation function
function calculatePrices(config) {
  const ouncePrice = Number(config.ouncePrice);
  const exchangeRate = Number(config.exchangeRate);
  const marketMargin = Number(config.marketMargin); // IQD margin on Mithqal 21

  const ouncePriceIQD = ouncePrice * exchangeRate;
  
  // Base Gram 24 (1 Ounce = 31.1035 Grams)
  const baseGram24 = ouncePriceIQD / 31.1035;
  const baseGram21 = baseGram24 * 21 / 24;
  const baseMithqal21 = baseGram21 * 5;

  // Add margin on Mithqal 21
  const finalMithqal21 = baseMithqal21 + marketMargin;
  const finalGram21 = finalMithqal21 / 5;

  // Calculate other karats proportionally based on purity relative to 21
  // finalGram24 = finalGram21 * (24 / 21)
  const finalGram24 = finalGram21 * 24 / 21;
  const finalMithqal24 = finalGram24 * 5;

  // Gram 18 (18/24 of 24 karat gold)
  const finalGram18 = finalGram24 * 18 / 24;
  const finalMithqal18 = finalGram18 * 5;

  return {
    ouncePrice,
    exchangeRate,
    marketMargin,
    mithqal21: Math.round(finalMithqal21),
    gram21: Math.round(finalGram21),
    mithqal24: Math.round(finalMithqal24),
    gram24: Math.round(finalGram24),
    mithqal18: Math.round(finalMithqal18),
    gram18: Math.round(finalGram18),
    updatedAt: new Date().toISOString()
  };
}

// Call Google Gemini API with smart fallbacks
async function queryGemini(promptText, apiKey) {
  // We will try these combinations in order
  const attempts = [
    { version: 'v1beta', model: 'gemini-2.5-flash' },
    { version: 'v1', model: 'gemini-2.5-flash' },
    { version: 'v1beta', model: 'gemini-2.0-flash' },
    { version: 'v1', model: 'gemini-2.0-flash' },
    { version: 'v1beta', model: 'gemini-1.5-flash' }
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const url = `https://generativelanguage.googleapis.com/${attempt.version}/models/${attempt.model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: promptText
            }]
          }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
          console.log(`Gemini API succeeded using ${attempt.version} and model ${attempt.model}`);
          return data.candidates[0].content.parts[0].text.trim();
        }
      } else {
        const errText = await response.text();
        lastError = { status: response.status, body: errText, attempt };
        // Log individual attempt failure in console to debug
        console.warn(`Gemini attempt failed (${attempt.version}/${attempt.model}): ${response.status}`);
      }
    } catch (err) {
      console.error(`Gemini connection error on ${attempt.version}/${attempt.model}:`, err);
    }
  }

  // If all attempts failed, try to list models to help diagnose the issue!
  console.error("All Gemini API attempts failed. Last error:", lastError);
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const listResponse = await fetch(listUrl);
    if (listResponse.ok) {
      const listData = await listResponse.json();
      const modelNames = listData.models ? listData.models.map(m => m.name) : [];
      console.log("=== Available Gemini models for this API key ===");
      console.log(JSON.stringify(modelNames, null, 2));
      console.log("=================================================");
    } else {
      console.error("Failed to query available models:", listResponse.status, await listResponse.text());
    }
  } catch (err) {
    console.error("Error listing Gemini models:", err);
  }

  return null;
}

// Generate Chatbot reply text
// isSimulator = true preserves default responses for testing inside the dashboard mockup
// Conversation memory for context (last 10 messages per user)
const conversationMemory = {};
const MAX_HISTORY = 10;

function getConversationHistory(phone) {
  return conversationMemory[phone] || [];
}

function addToConversation(phone, role, content) {
  if (!conversationMemory[phone]) conversationMemory[phone] = [];
  conversationMemory[phone].push({ role, content });
  if (conversationMemory[phone].length > MAX_HISTORY) {
    conversationMemory[phone] = conversationMemory[phone].slice(-MAX_HISTORY);
  }
}

async function generateReply(messageText, config, isSimulator = false, phone = null) {
  const cleanMsg = messageText.trim();
  const prices = calculatePrices(config);

  // 2. Route to Gemini AI if API Key is configured
  if (config.geminiApiKey && config.geminiApiKey.trim() !== '') {
    const timeStr = new Date(prices.updatedAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
    
    const customRepliesText = config.customReplies && Array.isArray(config.customReplies) && config.customReplies.length > 0
      ? `إليك معلومات إضافية عن المحل وعنوانه ومنتجاته يمكنك استخدامها للإجابة بدقة وسلاسة:\n` + 
        config.customReplies.map(r => `- إذا سأل عن كلمات مثل (${r.keywords})، فالمعلومة هي: "${r.reply}"`).join('\n')
      : '';

    const userInstructionsText = config.geminiInstructions && config.geminiInstructions.trim() !== ''
      ? `\nتعليمات إضافية وتوجيهات خاصة من صاحب المحل يجب عليك اتباعها بدقة بالغة:\n${config.geminiInstructions}\n`
      : '';

    // Build conversation history context
    const history = phone ? getConversationHistory(phone) : [];
    const historyText = history.length > 0
      ? `\n\nهذا هو تاريخ المحادثة السابقة (الأقدم → الأحدث):\n${history.map((h, i) => `${h.role === 'user' ? 'الزبون' : 'البوت'}: "${h.content}"`).join('\n')}\n`
      : '\n';

    const systemPrompt = `أنت المساعد الذكي لمحل "الغيث للذهب والمجوهرات" في العراق. أجب عن أسئلة الزبائن بلهجة عراقية عامية لطيفة ومحترمة وبشكل مختصر ومفيد (لا تتجاوز سطرين أو ثلاثة).
إليك معلومات الذهب الحالية في المحل ليومنا هذا (توقيت بغداد):
- مثقال عيار 21 عراقي (صافي): ${prices.mithqal21.toLocaleString()} دينار عراقي
- غرام عيار 21: ${prices.gram21.toLocaleString()} دينار عراقي
- مثقال عيار 24: ${prices.mithqal24.toLocaleString()} دينار عراقي
- غرام عيار 24: ${prices.gram24.toLocaleString()} دينار عراقي
- مثقال عيار 18: ${prices.mithqal18.toLocaleString()} دينار عراقي
- غرام عيار 18: ${prices.gram18.toLocaleString()} دينار عراقي
- سعر الأونصة العالمي: ${prices.ouncePrice.toLocaleString()} دولار
- سعر صرف الدولار المعتمد: ${prices.exchangeRate.toLocaleString()} دينار عراقي لكل دولار
- وقت التحديث الحالي: ${timeStr}

هامش السوق الإضافي مضاف بالفعل في الأسعار أعلاه.
إذا سألك الزبون عن سعر الذهب أو أي استفسار آخر، أجب بذكاء واذكر له الأسعار ذات الصلة أو قائمة الأسعار كاملة إذا كان السؤال عاماً عن الأسعار اليوم.
${customRepliesText}
${userInstructionsText}
ملاحظات هامة جداً:
1. لا تقترح على الزبون خيارات مرقمة (مثل 1، 2، 3، 4) ولا ترسل له قوائم خيارات مسبقة الصنع.
2. أجب عليه مباشرة كأنك شخص ذكي حقيقي (ذكاء اصطناعي) يدردش معه بلطف.
3. تذكر دائماً استخدام اللهجة العراقية الشعبية الودودة والمهذبة (مثلاً استخدام كلمات مثل: عيني، عراسي، تدلل، هلا بيك، غالي، د.ع).
4. استخدم تاريخ المحادثة السابقة لفهم سياق سؤال الزبون الحالي — مثلاً إذا سأل "زين والعيار 21؟" فأنت تعرف أنه يكمل على كلامه السابق عن الأسعار.${historyText}
سؤال الزبون الحالي هو: "${cleanMsg}"`;

    const aiReply = await queryGemini(systemPrompt, config.geminiApiKey);
    if (aiReply) {
      return aiReply;
    }
  }

  // 3. Fallback logic in case Gemini is not configured or failed
  const msgLower = cleanMsg.toLowerCase();
  
  // Custom replies fallback
  if (config.customReplies && Array.isArray(config.customReplies)) {
    for (const rule of config.customReplies) {
      if (!rule.keywords || !rule.reply) continue;
      const keywordsList = rule.keywords.split(',').map(k => k.trim().toLowerCase());
      const matches = keywordsList.some(k => k && msgLower.includes(k));
      if (matches) {
        return rule.reply;
      }
    }
  }

  const timeStr = new Date(prices.updatedAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
  const priceKeywords = ['سعر', 'بيش', 'مثقال', 'ذهب', 'غرام', 'المثقال', 'الغرام', 'اسعار', 'الاسعار'];
  const hasPriceKeyword = priceKeywords.some(keyword => msgLower.includes(keyword));

  if (hasPriceKeyword || msgLower.includes('18') || msgLower.includes('21') || msgLower.includes('24') || cleanMsg === '1' || cleanMsg === '2') {
    if (msgLower.includes('18') || cleanMsg === '2') {
      return `سعر الذهب عيار 18 اليوم بمحل الغيث: ⚖️
• غرام 18 عراقي: ${prices.gram18.toLocaleString()} د.ع
• مثقال 18 عراقي: ${prices.mithqal18.toLocaleString()} د.ع

الأسعار الحالية لبقية العيارات:
• مثقال 21 عراقي: ${prices.mithqal21.toLocaleString()} د.ع
• غرام 21 عراقي: ${prices.gram21.toLocaleString()} د.ع`;
    }
    
    return `أسعار الذهب الحالية بمحل الغيث للذهب والمجوهرات: 🌹
• مثقال 21 عراقي (صافي): ${prices.mithqal21.toLocaleString()} د.ع
• غرام 21 عراقي: ${prices.gram21.toLocaleString()} د.ع
• مثقال 24: ${prices.mithqal24.toLocaleString()} د.ع
• غرام 24: ${prices.gram24.toLocaleString()} د.ع
• مثقال 18: ${prices.mithqal18.toLocaleString()} د.ع
• غرام 18: ${prices.gram18.toLocaleString()} د.ع
(محدثة في ${timeStr})`;
  }

  // Greeting fallback without menu options
  const greetingKeywords = ['سلام', 'مرحبا', 'هلا', 'صباح', 'مساء', 'هلو', 'السلام عليكم', 'مرحب', 'سلامات'];
  const isGreeting = greetingKeywords.some(keyword => msgLower.includes(keyword));
  if (isGreeting) {
    return `هلا وغلا بيك عيني 🌹 حياك الله بمحل الغيث للذهب والمجوهرات.
أنا المساعد الذكي للمحل. أسعار الذهب لليوم هي:
• مثقال 21 عراقي: ${prices.mithqal21.toLocaleString()} د.ع
• غرام 21 عراقي: ${prices.gram21.toLocaleString()} د.ع
تفضل بأي استفسار وسأجيبك فوراً! ✨`;
  }

  // Default fallback response
  return `حياك الله بمحل الغيث للذهب والمجوهرات. 🌹
أسعار الذهب اليوم عيار 21 هي: ${prices.mithqal21.toLocaleString()} د.ع للمثقال.
إذا عندك أي استفسار تفضل وسنجيبك فوراً! ✨`;
}

// JWT Auth Middleware
function authMiddleware(req, res, next) {
  const config = readConfig();
  // Auth is required if either username or password is set
  if (!config.adminPassword && !config.adminUsername) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  try {
    jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Token expired أو غير صالح' });
  }
}

// 0. Auth Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const config = readConfig();
  // Auth is disabled if neither username nor password is configured
  if (!config.adminPassword && !config.adminUsername) {
    return res.json({ success: true, token: null, message: 'auth_disabled' });
  }
  // Check username if configured
  const usernameOk = !config.adminUsername || (username && username === config.adminUsername);
  // Check password if configured
  const passwordOk = !config.adminPassword || (password && password === config.adminPassword);
  
  if (usernameOk && passwordOk) {
    const token = jwt.sign({ role: 'admin', username: username || 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
});

// Protect all /api routes except login + WebSocket (no API routes skipped below)
app.use('/api', (req, res, next) => {
  if (req.path === '/login') return next();
  return authMiddleware(req, res, next);
});

// REST API Endpoints

// 1. Get Current Config & Calculated Prices
app.get('/api/config', (req, res) => {
  const config = readConfig();
  const prices = calculatePrices(config);
  res.json({
    config,
    prices,
    whatsapp: {
      status: whatsappStatus,
      libAvailable: whatsappLibAvailable
    },
    freshness: {
      goldSource: lastGoldFetchSource || null,
      goldUpdated: lastSuccessfulGoldFetch,
      goldStale: !lastSuccessfulGoldFetch ? false : (Date.now() - lastSuccessfulGoldFetch > 5 * 60 * 1000),
      exchangeSource: lastExchangeFetchSource || null,
      exchangeUpdated: lastSuccessfulExchangeFetch,
      exchangeStale: !lastSuccessfulExchangeFetch ? false : (Date.now() - lastSuccessfulExchangeFetch > 30 * 60 * 1000)
    }
  });
});

// 2. Update Config Manually
app.post('/api/config', (req, res) => {
  const currentConfig = readConfig();
  const { ouncePrice, exchangeRate, marketMargin, ownerPhone, botName, customReplies, geminiApiKey, geminiInstructions, adminUsername, adminPassword } = req.body;
  
  const updatedConfig = {
    ouncePrice: ouncePrice !== undefined ? Number(ouncePrice) : currentConfig.ouncePrice,
    exchangeRate: exchangeRate !== undefined ? Number(exchangeRate) : currentConfig.exchangeRate,
    marketMargin: marketMargin !== undefined ? Number(marketMargin) : currentConfig.marketMargin,
    ownerPhone: ownerPhone !== undefined ? String(ownerPhone).trim() : currentConfig.ownerPhone,
    botName: botName !== undefined ? String(botName).trim() : currentConfig.botName,
    customReplies: customReplies !== undefined ? customReplies : (currentConfig.customReplies || []),
    geminiApiKey: geminiApiKey !== undefined ? String(geminiApiKey).trim() : (currentConfig.geminiApiKey || ''),
    geminiInstructions: geminiInstructions !== undefined ? String(geminiInstructions).trim() : (currentConfig.geminiInstructions || ''),
    adminUsername: adminUsername !== undefined ? String(adminUsername).trim() : (currentConfig.adminUsername || ''),
    adminPassword: adminPassword !== undefined ? String(adminPassword).trim() : (currentConfig.adminPassword || ''),
    botEnabled: req.body.botEnabled !== undefined ? Boolean(req.body.botEnabled) : (currentConfig.botEnabled !== undefined ? currentConfig.botEnabled : true)
  };
  
  writeConfig(updatedConfig);
  const prices = calculatePrices(updatedConfig);
  
  res.json({
    success: true,
    config: updatedConfig,
    prices
  });
});

// 3. Fetch Live Gold Price + Exchange Rate (manual refresh)
app.get('/api/gold-price', async (req, res) => {
  try {
    const goldPrice = await fetchGoldPriceWithFallback();
    if (goldPrice === null) {
      throw new Error('All gold price sources failed');
    }
    
    const config = readConfig();
    config.ouncePrice = goldPrice;
    
    // Also refresh exchange rate on manual update
    const exchangeRate = await fetchExchangeRateWithFallback();
    if (exchangeRate !== null) {
      cachedExchangeRate = exchangeRate;
      exchangeRateCacheTime = Date.now();
      lastSuccessfulExchangeFetch = Date.now();
      lastExchangeFetchFailed = false;
      config.exchangeRate = exchangeRate;
      console.log(`[Manual Update] Exchange rate refreshed: ${exchangeRate} IQD`);
    } else {
      lastExchangeFetchFailed = true;
    }
    
    writeConfig(config);
    
    const prices = calculatePrices(config);
    
    res.json({
      success: true,
      livePrice: config.ouncePrice,
      config,
      prices,
      freshness: {
        goldSource: lastGoldFetchSource || null,
        goldUpdated: lastSuccessfulGoldFetch,
        goldStale: lastSuccessfulGoldFetch ? (Date.now() - lastSuccessfulGoldFetch > 5 * 60 * 1000) : true,
        exchangeSource: lastExchangeFetchSource || null,
        exchangeUpdated: lastSuccessfulExchangeFetch,
        exchangeStale: lastSuccessfulExchangeFetch ? (Date.now() - lastSuccessfulExchangeFetch > 30 * 60 * 1000) : true
      }
    });
  } catch (error) {
    console.error('Error fetching live gold price:', error);
    res.status(500).json({
      success: false,
      message: 'تعذر جلب سعر الذهب الحي من الخادم العالمي. يرجى المحاولة لاحقاً.',
      error: error.message
    });
  }
});

// 4. Simulate WhatsApp Message
app.post('/api/simulate-message', async (req, res) => {
  const { message, sender } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message content is required' });
  }
  
  const config = readConfig();
  const simPhone = '964789999999';
  
  cleanExpiredMutes();
  const isMuted = mutedChats[simPhone] && new Date() < new Date(mutedChats[simPhone]);
  
  if (isMuted) {
    addToConversation(simPhone, 'user', message);
    trackCustomer(simPhone, 'زبون (محاكي - صامت)');
    const logEntry = {
      timestamp: new Date().toISOString(),
      direction: 'INCOMING',
      sender: 'زبون (محاكي - صامت)',
      senderPhone: simPhone,
      message: message
    };
    broadcast({ type: 'log', logs: [logEntry] });
    return res.json({ success: true, reply: null, muted: true });
  }

  // Auto-mute triggers
  const takeoverKeywords = [
    'تواصل مع المسؤول', 'تواصل وية المسؤول', 'احجي وية المسؤول', 
    'تواصل مع المالك', 'اريد المسؤول', 'شخص حقيقي', 'رقم المالك', 
    'رقم غيث', 'تواصل مع مسؤول', 'احجي ويا المسؤول'
  ];
  const needsTakeover = takeoverKeywords.some(keyword => message.includes(keyword));
  
  if (needsTakeover) {
    const expiry = new Date(Date.now() + 12 * 60 * 60 * 1000);
    mutedChats[simPhone] = expiry.toISOString();
    broadcast({
      type: 'chat_mute_change',
      phone: simPhone,
      muted: true,
      expiry: expiry.toISOString()
    });
    
    const takeoverReply = "تم إيقاف الرد التلقائي للمحادثة مؤقتاً وسيقوم المسؤول بالتواصل معك بأقرب فرصة. 🌹";
    addToConversation(simPhone, 'user', message);
    trackCustomer(simPhone, 'زبون (محاكي)');
    addToConversation(simPhone, 'bot', takeoverReply);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      direction: 'INCOMING',
      sender: 'زبون',
      senderPhone: simPhone,
      message: message
    };
    const replyEntry = {
      timestamp: new Date().toISOString(),
      direction: 'OUTGOING',
      sender: config.botName,
      message: takeoverReply
    };
    broadcast({ type: 'log', logs: [logEntry, replyEntry] });
    return res.json({ success: true, reply: takeoverReply, muted: true });
  }

  addToConversation(simPhone, 'user', message);
  const replyText = await generateReply(message, config, true, simPhone);
  
  trackCustomer(simPhone, 'زبون (محاكي)');
  if (replyText) addToConversation(simPhone, 'bot', replyText);

  const logEntry = {
    timestamp: new Date().toISOString(),
    direction: 'INCOMING',
    sender: 'زبون',
    senderPhone: '964789999999',
    message: message
  };
  
  if (replyText) {
    const replyEntry = {
      timestamp: new Date().toISOString(),
      direction: 'OUTGOING',
      sender: config.botName,
      message: replyText
    };
    broadcast({ type: 'log', logs: [logEntry, replyEntry] });
  } else {
    broadcast({ type: 'log', logs: [logEntry] });
  }
  
  res.json({
    success: true,
    reply: replyText
  });
});

// --- Real WhatsApp Connection Handler (baileys) ---

let qrImage = '';

async function connectToWhatsApp() {
  if (!whatsappLibAvailable) return;
  
  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
    const QRCode = require('qrcode');
    
    whatsappStatus = 'CONNECTING';
    broadcast({ type: 'whatsapp_status', status: whatsappStatus });
    
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA Web version v${version.join('.')}, isLatest: ${isLatest}`);
    
    let authObj;
    if (db.isDbEnabled()) {
      authObj = await db.usePostgresAuthState(db.SESSION_ID);
    } else {
      authObj = await useMultiFileAuthState('auth_info_baileys');
    }
    const { state, saveCreds } = authObj;
    
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ['Al-Ghaith Gold Bot', 'Chrome', '1.0.0']
    });
    
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        whatsappStatus = 'QR_READY';
        qrCodeData = qr;
        
        // Generate QR code data URL for dashboard
        qrImage = await QRCode.toDataURL(qr);
        broadcast({ type: 'whatsapp_status', status: whatsappStatus, qr: qrImage });
        console.log('WhatsApp QR Code generated, scan in dashboard.');
      }
      
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.data?.reason;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || reason == '401';
        console.log('Connection closed due to ', lastDisconnect?.error, ', loggedOut:', isLoggedOut);
        
        whatsappStatus = 'DISCONNECTED';
        qrCodeData = '';
        qrImage = '';
        broadcast({ type: 'whatsapp_status', status: whatsappStatus });
        
        if (isLoggedOut) {
          reconnectAttempt = 0;
          // Delete stale auth so next connect generates fresh QR
          console.log('Session expired. Deleting stale auth folder and reconnecting...');
          try {
            if (fs.existsSync('auth_info_baileys')) {
              fs.rmSync('auth_info_baileys', { recursive: true, force: true });
            }
          } catch (e) {
            console.error('Failed to delete auth folder:', e.message);
          }
          setTimeout(connectToWhatsApp, 2000);
        } else {
          reconnectAttempt++;
          const delay = Math.min(5000 * Math.pow(2, reconnectAttempt - 1), MAX_RECONNECT_DELAY);
          console.log(`[Reconnect] Attempt #${reconnectAttempt}, waiting ${(delay/1000).toFixed(0)}s...`);
          setTimeout(connectToWhatsApp, delay);
        }
      } else if (connection === 'open') {
        console.log('WhatsApp connection opened successfully!');
        reconnectAttempt = 0;
        whatsappStatus = 'CONNECTED';
        qrCodeData = '';
        qrImage = '';
        
        // Auto-detect connected phone number and save to config
        if (sock.user && sock.user.id) {
          const phone = (sock.user.id.split('@')[0] || '').split(/[:.\-]/)[0].replace(/\D/g, '');
          if (phone) {
            const cfg = readConfig();
            if (cfg.ownerPhone !== phone) {
              cfg.ownerPhone = phone;
              writeConfig(cfg);
              // Recalculate prices with new config
              broadcast({ type: 'config_update', config: cfg, prices: calculatePrices(cfg) });
              console.log(`[WhatsApp] Auto-detected phone: ${phone}`);
            }
          }
        }
        
        broadcast({ type: 'whatsapp_status', status: whatsappStatus });
      }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // Track contacts for phone number lookup (LID support)
    const contactMap = {};
    sock.ev.on('contacts.upsert', (contacts) => {
      contacts.forEach(c => {
        const jid = c.jid?.split('@')[0];
        if (jid) contactMap[jid] = c;
      });
    });
    sock.ev.on('contacts.update', (contacts) => {
      contacts.forEach(c => {
        const jid = c.jid?.split('@')[0];
        if (jid) contactMap[jid] = { ...(contactMap[jid] || {}), ...c };
      });
    });
    
    function getRealPhone(jidStr) {
      const clean = jidStr?.split('@')[0];
      if (!clean) return jidStr || 'غير معروف';
      // If it looks like a regular phone number (starts with country code, 10-15 digits)
      if (/^\d{10,15}$/.test(clean) && !clean.startsWith('1') && clean.length <= 13) return clean;
      // Try contact map
      const contact = contactMap[clean];
      if (contact) {
        // Some contacts have a `verifiedName` or separate name fields
        if (contact.jid) {
          const contactClean = contact.jid.split('@')[0];
          if (/^\d{10,15}$/.test(contactClean) && !contactClean.startsWith('1')) return contactClean;
        }
      }
      return 'غير معروف';
    }
    
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      
      const config = readConfig();
      const botActive = botManualOverride !== null ? botManualOverride : (config.botEnabled !== false);
      
      for (const msg of m.messages) {
        try {
          if (!msg.message) continue;
          if (msg.key.fromMe) continue; // Ignore messages sent by the bot itself
          
          const from = msg.key.remoteJid;
          
          // CRITICAL SAFETY: Ignore all group chats completely!
          if (from.endsWith('@g.us')) continue;
          
          const text = msg.message.conversation || 
                       (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || 
                       '';
          
          if (!text) continue;
          
          const cleanFrom = from.split('@')[0];
          const realPhone = getRealPhone(from);
          
          // Check bot is active before processing
          if (!botActive) {
            console.log(`[Bot Disabled] Ignoring message from ${from}`);
            continue;
          }
          
          // Takeover check: if muted, ignore user message (do not reply)
          cleanExpiredMutes();
          const isMuted = mutedChats[realPhone] && new Date() < new Date(mutedChats[realPhone]);
          
          if (isMuted) {
            console.log(`[Takeover] Chat ${realPhone} is muted. Skipping automatic reply.`);
            // Track customer
            trackCustomer(realPhone, 'زبون (واتساب - صامت)');
            
            // Sync incoming message to web dashboard logs so owner can read it
            const logEntry = {
              timestamp: new Date().toISOString(),
              direction: 'INCOMING',
              sender: 'زبون (واتساب - صامت)',
              senderPhone: realPhone,
              message: text
            };
            broadcast({ type: 'log', logs: [logEntry] });
            continue;
          }

          // Auto-mute triggers
          const takeoverKeywords = [
            'تواصل مع المسؤول', 'تواصل وية المسؤول', 'احجي وية المسؤول', 
            'تواصل مع المالك', 'اريد المسؤول', 'شخص حقيقي', 'رقم المالك', 
            'رقم غيث', 'تواصل مع مسؤول', 'احجي ويا المسؤول'
          ];
          const needsTakeover = takeoverKeywords.some(keyword => text.includes(keyword));
          
          if (needsTakeover) {
            const expiry = new Date(Date.now() + 12 * 60 * 60 * 1000);
            mutedChats[realPhone] = expiry.toISOString();
            console.log(`[Takeover] Chat ${realPhone} automatically muted due to keyword match.`);
            
            broadcast({
              type: 'chat_mute_change',
              phone: realPhone,
              muted: true,
              expiry: expiry.toISOString()
            });
            
            const takeoverReply = "تم إيقاف الرد التلقائي للمحادثة مؤقتاً وسيقوم المسؤول بالتواصل معك بأقرب فرصة. 🌹";
            
            addToConversation(cleanFrom, 'user', text);
            trackCustomer(realPhone, 'زبون (واتساب)');
            addToConversation(cleanFrom, 'bot', takeoverReply);
            
            await sock.sendMessage(from, { text: takeoverReply });
            
            const logEntry = {
              timestamp: new Date().toISOString(),
              direction: 'INCOMING',
              sender: 'زبون (واتساب)',
              senderPhone: realPhone,
              message: text
            };
            const replyEntry = {
              timestamp: new Date().toISOString(),
              direction: 'OUTGOING',
              sender: config.botName,
              senderPhone: cleanFrom,
              message: takeoverReply
            };
            broadcast({ type: 'log', logs: [logEntry, replyEntry] });
            continue;
          }

          console.log(`Received message from ${from} (Phone: ${realPhone}): ${text}`);
          
        // Track customer (uses real phone for CRM display)
        trackCustomer(realPhone, 'زبون (واتساب)');
        
          // Save to conversation memory & generate reply
        addToConversation(cleanFrom, 'user', text);
        const replyText = await generateReply(text, config, false, cleanFrom);
        
        // Log incoming message to dashboard
        const logEntry = {
          timestamp: new Date().toISOString(),
          direction: 'INCOMING',
          sender: 'زبون (واتساب)',
          senderPhone: realPhone,
          message: text
        };
        
        if (!replyText) {
          console.log(`Ignoring message from ${from} (owner or no keywords matched)`);
          broadcast({ type: 'log', logs: [logEntry] });
          continue; 
        }
        if (replyText) addToConversation(cleanFrom, 'bot', replyText);
          
          // Send reply via WhatsApp
          await sock.sendMessage(from, { text: replyText });
          console.log(`Sent reply to ${from}: ${replyText}`);
          
          const replyEntry = {
            timestamp: new Date().toISOString(),
            direction: 'OUTGOING',
            sender: config.botName,
            senderPhone: cleanFrom,
            message: replyText
          };
          
          broadcast({ type: 'log', logs: [logEntry, replyEntry] });
        } catch (err) {
          console.error('[Messages handler error] Failed to process message:', err.message || err);
        }
      }
    });
    
  } catch (err) {
    console.error('Error in connectToWhatsApp:', err);
    whatsappStatus = 'DISCONNECTED';
    broadcast({ type: 'whatsapp_status', status: whatsappStatus });
  }
}

// REST Endpoints for WhatsApp Connection Management
app.post('/api/whatsapp/connect', (req, res) => {
  if (!whatsappLibAvailable) {
    return res.status(400).json({ 
      success: false, 
      message: 'مكتبة واتساب غير مثبتة في هذا الخادم. يرجى تشغيل npm install لتثبيتها أولاً.' 
    });
  }
  
  if (whatsappStatus === 'CONNECTED') {
    return res.json({ success: true, message: 'البوت متصل بالفعل بالواتساب!' });
  }
  
  connectToWhatsApp();
  res.json({ success: true, message: 'جاري تشغيل محرك الواتساب وتوليد رمز الاستجابة السريعة QR...' });
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
  if (sock) {
    try {
      await sock.logout();
    } catch (e) {
      console.log('Error logging out of WhatsApp socket:', e);
    }
    sock = null;
  }
  whatsappStatus = 'DISCONNECTED';
  qrCodeData = '';
  qrImage = '';
  broadcast({ type: 'whatsapp_status', status: whatsappStatus });
  res.json({ success: true, message: 'تم قطع اتصال واتساب بنجاح.' });
});

app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: whatsappStatus,
    qr: qrImage,
    libAvailable: whatsappLibAvailable
  });
});

// Bot Panic Toggle
let botManualOverride = null; // null=follow config, true=forced on, false=forced off

app.get('/api/bot/status', (req, res) => {
  const config = readConfig();
  const enabled = botManualOverride !== null ? botManualOverride : config.botEnabled;
  res.json({ enabled, manualOverride: botManualOverride });
});

app.post('/api/bot/toggle', (req, res) => {
  const config = readConfig();
  if (botManualOverride === null) {
    botManualOverride = !config.botEnabled;
  } else {
    botManualOverride = !botManualOverride;
  }
  const enabled = botManualOverride;
  broadcast({ type: 'bot_status', enabled, manualOverride: botManualOverride });
  console.log(`[Bot] Panic toggle: bot is now ${enabled ? 'ENABLED' : 'DISABLED'}`);
  res.json({ success: true, enabled, manualOverride: botManualOverride, message: enabled ? 'تم تشغيل البوت بنجاح' : 'تم إيقاف البوت' });
});

// Muted Chats State (In-Memory)
// Keys: phone numbers (e.g., '9647701234567'), Values: ISO Date strings of expiration
let mutedChats = {};

// Clean up expired mutes helper
function cleanExpiredMutes() {
  const now = new Date();
  for (const phone in mutedChats) {
    if (new Date(mutedChats[phone]) <= now) {
      delete mutedChats[phone];
    }
  }
}

app.get('/api/chats/muted', (req, res) => {
  cleanExpiredMutes();
  res.json({ success: true, mutedChats });
});

app.post('/api/chats/mute', (req, res) => {
  const { phone, muted, durationHours } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, message: 'رقم الهاتف مطلوب' });
  }

  const cleanPhone = String(phone).replace(/\D/g, '');
  
  if (muted) {
    const hours = Number(durationHours) || 12;
    const expiry = new Date(Date.now() + hours * 60 * 60 * 1000);
    mutedChats[cleanPhone] = expiry.toISOString();
    console.log(`[Takeover] Chat ${cleanPhone} manually muted for ${hours} hours.`);
  } else {
    delete mutedChats[cleanPhone];
    console.log(`[Takeover] Chat ${cleanPhone} manually unmuted.`);
  }

  broadcast({
    type: 'chat_mute_change',
    phone: cleanPhone,
    muted: !!muted,
    expiry: muted ? mutedChats[cleanPhone] : null
  });

  res.json({
    success: true,
    muted: !!muted,
    phone: cleanPhone,
    expiry: muted ? mutedChats[cleanPhone] : null
  });
});

// Analytics
app.get('/api/analytics', (req, res) => {
  const customers = loadCustomers();
  const list = Object.values(customers);
  const today = new Date().toDateString();
  let todayMessages = 0;
  const karatCounts = { '21': 0, '24': 0, '18': 0 };
  list.forEach(c => {
    if (c.lastContact && new Date(c.lastContact).toDateString() === today) {
      todayMessages += c.messageCount || 0;
    }
  });
  const topCustomers = [...list].sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0)).slice(0, 5);
  res.json({
    success: true,
    totalCustomers: list.length,
    todayMessages,
    topCustomers: topCustomers.map(c => ({ phone: c.phone, name: c.name, count: c.messageCount || 0 })),
  });
});

// WebSocket connection handshake
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  console.log('WebSocket connection established with dashboard client.');
  
  // Send initial config and status
  const config = readConfig();
  cleanExpiredMutes();
  ws.send(JSON.stringify({
    type: 'init',
    config,
    prices: calculatePrices(config),
    whatsapp: {
      status: whatsappStatus,
      qr: qrImage,
      libAvailable: whatsappLibAvailable
    },
    mutedChats
  }));
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected.');
  });
});

// Local price history helper
function loadPriceHistoryLocal() {
  try {
    if (fs.existsSync(PRICE_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(PRICE_HISTORY_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[Price History] Error reading history file:', err.message);
  }
  return [];
}

// Price History helpers
async function savePriceSnapshot(config, prices) {
  try {
    let history = cachedPriceHistory || [];
    history.push({
      timestamp: new Date().toISOString(),
      ouncePrice: prices.ouncePrice,
      exchangeRate: prices.exchangeRate,
      marketMargin: prices.marketMargin,
      mithqal21: prices.mithqal21,
      gram21: prices.gram21,
      mithqal24: prices.mithqal24,
      gram24: prices.gram24,
      mithqal18: prices.mithqal18,
      gram18: prices.gram18
    });
    if (history.length > 1440) history = history.slice(history.length - 1440); // 24 hours
    cachedPriceHistory = history;
    
    if (db.isDbEnabled()) {
      await db.writePriceHistoryDB(history);
    } else {
      fs.writeFileSync(PRICE_HISTORY_FILE, JSON.stringify(history), 'utf8');
    }
  } catch (err) {
    console.error('[Price History] Error saving snapshot:', err.message);
  }
}

// CRM: Customer tracking
function loadCustomers() {
  if (!cachedCustomers) {
    cachedCustomers = loadCustomersLocal();
  }
  return cachedCustomers;
}

function loadCustomersLocal() {
  try {
    if (fs.existsSync(CUSTOMERS_FILE)) return JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8'));
  } catch (e) { console.error('[CRM] Error loading customers locally:', e.message); }
  return {};
}

async function saveCustomers(data) {
  cachedCustomers = data;
  try {
    if (db.isDbEnabled()) {
      await db.writeCustomersDB(data);
    } else {
      fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(data, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('[CRM] Error saving customers:', e.message);
  }
}

function trackCustomer(phone, name) {
  if (!phone) return;
  const customers = loadCustomers();
  const now = new Date().toISOString();
  if (customers[phone]) {
    customers[phone].lastContact = now;
    customers[phone].messageCount = (customers[phone].messageCount || 0) + 1;
    if (name && !customers[phone].name) customers[phone].name = name;
  } else {
    customers[phone] = { phone, name: name || 'زبون', firstContact: now, lastContact: now, messageCount: 1 };
  }
  saveCustomers(customers);
}

// 5. Get Price History
app.get('/api/price-history', (req, res) => {
  try {
    const history = cachedPriceHistory || [];
    return res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Get Customers (CRM)
app.get('/api/customers', (req, res) => {
  const customers = loadCustomers();
  const list = Object.values(customers).sort((a, b) => new Date(b.lastContact) - new Date(a.lastContact));
  res.json({ success: true, customers: list, total: list.length });
});

// Background job to automatically update global gold price and USD/IQD parallel exchange rate every 1 minute
async function runAutoUpdates() {
  let configChanged = false;
  const config = readConfig();
  
  // 1. Fetch live gold price (with fallback chain)
  try {
    const goldPrice = await fetchGoldPriceWithFallback();
    if (goldPrice !== null) {
      if (config.ouncePrice !== goldPrice) {
        config.ouncePrice = goldPrice;
        configChanged = true;
        console.log(`[Auto Updates] Live Ounce Price updated automatically: $${goldPrice} (source: ${lastGoldFetchSource})`);
      }
    } else {
      console.error('[Auto Updates] All gold price sources failed');
    }
  } catch (err) {
    console.error('[Auto Updates Error] Failed to fetch live gold price:', err.message);
  }
  
  // 2. Fetch exchange rate (only every 30 min to avoid IP block)
  const now = Date.now();
  if (now - exchangeRateCacheTime > EXCHANGE_RATE_CACHE_TTL) {
    const exchangeRate = await fetchExchangeRateWithFallback();
    if (exchangeRate !== null) {
      cachedExchangeRate = exchangeRate;
      exchangeRateCacheTime = now;
      lastSuccessfulExchangeFetch = now;
      lastExchangeFetchFailed = false;
      if (config.exchangeRate !== exchangeRate) {
        config.exchangeRate = exchangeRate;
        configChanged = true;
        console.log(`[Auto Updates] USD/IQD rate updated: ${exchangeRate} IQD`);
      }
    } else {
      lastExchangeFetchFailed = true;
    }
  } else if (cachedExchangeRate !== null && config.exchangeRate !== cachedExchangeRate) {
    // Use cached rate even if config has a stale value
    config.exchangeRate = cachedExchangeRate;
    configChanged = true;
    console.log(`[Auto Updates] USD/IQD rate restored from cache: ${cachedExchangeRate} IQD`);
  }
  
  // 3. Save and broadcast if changed
  if (configChanged) {
    writeConfig(config);
    const prices = calculatePrices(config);
    broadcast({
      type: 'config_update',
      config,
      prices,
      freshness: {
        goldSource: lastGoldFetchSource || null,
        goldUpdated: lastSuccessfulGoldFetch,
        goldStale: lastSuccessfulGoldFetch ? (Date.now() - lastSuccessfulGoldFetch > 5 * 60 * 1000) : true,
        exchangeSource: lastExchangeFetchSource || null,
        exchangeUpdated: lastSuccessfulExchangeFetch,
        exchangeStale: lastSuccessfulExchangeFetch ? (Date.now() - lastSuccessfulExchangeFetch > 30 * 60 * 1000) : true
      }
    });
  }

  // 4. Save price history snapshot
  try { savePriceSnapshot(config, calculatePrices(config)); } catch (e) {}
}

// Database startup wrapper
async function startup() {
  const localConfig = readConfigLocal();
  const localCustomers = loadCustomersLocal();
  const localPriceHistory = loadPriceHistoryLocal();

  if (db.isDbEnabled()) {
    await db.initDB({
      config: localConfig,
      customers: localCustomers,
      priceHistory: localPriceHistory
    });
    cachedConfig = await db.readConfigDB() || localConfig;
    cachedCustomers = await db.readCustomersDB() || localCustomers;
    cachedPriceHistory = await db.readPriceHistoryDB() || localPriceHistory;
  } else {
    cachedConfig = localConfig;
    cachedCustomers = localCustomers;
    cachedPriceHistory = localPriceHistory;
  }

  // Start the server
  server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 Al-Ghaith Gold Bot Server is running on port ${PORT}`);
    console.log(`📂 Web Dashboard available at http://localhost:${PORT}`);
    console.log(`==================================================`);
  });

  // Optional tunnel (set TUNNEL=true or pass --tunnel flag)
  if (process.env.TUNNEL === 'true' || process.argv.includes('--tunnel')) {
    const localtunnel = require('localtunnel');
    const subdomain = process.env.TUNNEL_SUBDOMAIN || 'algaith-gold-dashboard';
    try {
      const tunnel = await localtunnel({ port: PORT, subdomain });
      console.log(`🌐 Tunnel active at: ${tunnel.url}`);
      tunnel.on('close', () => {
        console.log('[Tunnel] Connection closed.');
      });
      tunnel.on('error', (err) => console.error('[Tunnel] Error:', err.message));
    } catch (err) {
      console.error('[Tunnel] Failed to start:', err.message);
    }
  }

  // Start auto-updates loop every 1 minute (60000 ms)
  setInterval(runAutoUpdates, 60000);

  // Run immediately after 5 seconds on startup
  setTimeout(runAutoUpdates, 5000);

  // Automatically connect to WhatsApp on startup if library is available
  if (whatsappLibAvailable) {
    console.log('Automatically starting WhatsApp connection handler...');
    connectToWhatsApp();
  }
}

startup().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
