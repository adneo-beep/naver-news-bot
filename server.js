require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, 'telegram-config.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Config helpers ---
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { botToken: '', chatId: '', keywords: [], enabled: false };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// --- Naver news fetch ---
async function fetchNews(query, count = 5) {
  const res = await axios.get('https://openapi.naver.com/v1/search/news.json', {
    params: { query, sort: 'date', start: 1, display: count },
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
    },
  });
  return res.data.items || [];
}

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#0*39;/g, "'");
}

function formatNewsMessage(keyword, items) {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  let msg = `📰 *[${keyword}] 최신 뉴스*\n_${now} 기준_\n\n`;
  items.forEach((item, i) => {
    const title = stripHtml(item.title);
    const link = item.originallink || item.link;
    msg += `${i + 1}\\. [${title}](${link})\n\n`;
  });
  return msg;
}

// --- Telegram send ---
async function sendToTelegram(cfg, message) {
  const bot = new TelegramBot(cfg.botToken);
  await bot.sendMessage(cfg.chatId, message, {
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
  });
}

async function runNewsJob() {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.botToken || !cfg.chatId || cfg.keywords.length === 0) return;

  console.log(`[Telegram] 뉴스 전송 시작 (키워드: ${cfg.keywords.join(', ')})`);
  for (const keyword of cfg.keywords) {
    try {
      const items = await fetchNews(keyword, 5);
      if (items.length === 0) continue;
      const msg = formatNewsMessage(keyword, items);
      await sendToTelegram(cfg, msg);
      console.log(`[Telegram] "${keyword}" 전송 완료`);
    } catch (e) {
      console.error(`[Telegram] "${keyword}" 전송 실패:`, e.message);
    }
  }
}

// Cron: 2시간마다 (0, 2, 4, 6 ... 시 정각)
cron.schedule('0 */2 * * *', runNewsJob, { timezone: 'Asia/Seoul' });
console.log('⏰ 텔레그램 스케줄러 등록 완료 (2시간마다 자동 전송)');

// --- API: 뉴스 검색 ---
app.get('/api/news', async (req, res) => {
  const { query, sort = 'date', start = 1, display = 10 } = req.query;

  if (!query || !query.trim()) {
    return res.status(400).json({ error: '검색어를 입력해주세요.' });
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId.includes('입력') || clientSecret.includes('입력')) {
    return res.status(500).json({ error: '.env 파일에 NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET을 설정해주세요.' });
  }

  try {
    const response = await axios.get('https://openapi.naver.com/v1/search/news.json', {
      params: { query, sort, start, display },
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.errorMessage || '네이버 API 호출 중 오류가 발생했습니다.';
    res.status(status).json({ error: message });
  }
});

// --- API: 텔레그램 설정 조회 ---
app.get('/api/telegram/config', (req, res) => {
  const cfg = loadConfig();
  // 토큰은 마스킹해서 전달
  res.json({
    botToken: cfg.botToken ? cfg.botToken.replace(/(?<=.{6}).(?=.{4})/g, '*') : '',
    botTokenSet: !!cfg.botToken,
    chatId: cfg.chatId,
    keywords: cfg.keywords,
    enabled: cfg.enabled,
  });
});

// --- API: 텔레그램 설정 저장 ---
app.post('/api/telegram/config', (req, res) => {
  const { botToken, chatId, keywords, enabled } = req.body;
  const prev = loadConfig();
  const cfg = {
    botToken: botToken !== undefined ? botToken.trim() : prev.botToken,
    chatId: chatId !== undefined ? chatId.trim() : prev.chatId,
    keywords: Array.isArray(keywords) ? keywords.map(k => k.trim()).filter(Boolean) : prev.keywords,
    enabled: enabled !== undefined ? Boolean(enabled) : prev.enabled,
  };
  saveConfig(cfg);
  res.json({ ok: true, message: '설정이 저장되었습니다.' });
});

// --- API: 즉시 전송 테스트 ---
app.post('/api/telegram/test', async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.botToken || !cfg.chatId) {
    return res.status(400).json({ error: 'Bot Token과 Chat ID를 먼저 저장해주세요.' });
  }
  if (cfg.keywords.length === 0) {
    return res.status(400).json({ error: '키워드를 한 개 이상 설정해주세요.' });
  }
  try {
    await runNewsJob();
    res.json({ ok: true, message: '텔레그램으로 뉴스를 전송했습니다.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- API: 다음 전송 시간 ---
app.get('/api/telegram/next-run', (req, res) => {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const hour = kst.getHours();
  const nextHour = Math.ceil((hour + 1) / 2) * 2;
  const next = new Date(kst);
  next.setHours(nextHour, 0, 0, 0);
  if (nextHour >= 24) {
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  }
  res.json({ nextRun: next.toLocaleString('ko-KR') });
});

app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
