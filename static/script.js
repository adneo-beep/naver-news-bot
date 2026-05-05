const STORAGE = {
  keywords: 'nnb_keywords',
  history: 'nnb_history',
  api: 'nnb_api',
  count: 'nnb_count',
  sort: 'nnb_sort',
};

let settings = {
  count: 5,
  sort: 'date',
  naver_client_id: '',
  naver_client_secret: '',
  telegram_token: '',
  telegram_chat_id: '',
};

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  renderKeywordTags();
  renderHistory();
  updateStats();
  checkTelegramStatus();
});

function loadSettings() {
  const saved = JSON.parse(localStorage.getItem(STORAGE.api) || '{}');
  Object.assign(settings, saved);

  const count = parseInt(localStorage.getItem(STORAGE.count) || '5');
  const sort = localStorage.getItem(STORAGE.sort) || 'date';
  settings.count = count;
  settings.sort = sort;

  document.querySelectorAll('.btn-opt[data-count]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.count) === count);
  });
  document.querySelectorAll('.btn-opt[data-sort]').forEach(b => {
    b.classList.toggle('active', b.dataset.sort === sort);
  });

  if (settings.naver_client_id) document.getElementById('naver_client_id').value = settings.naver_client_id;
  if (settings.naver_client_secret) document.getElementById('naver_client_secret').value = settings.naver_client_secret;
  if (settings.telegram_token) document.getElementById('telegram_token').value = settings.telegram_token;
  if (settings.telegram_chat_id) document.getElementById('telegram_chat_id').value = settings.telegram_chat_id;
}

// ── Tabs ──────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
}

// ── Keywords ─────────────────────────────────────────────
function getKeywords() {
  return JSON.parse(localStorage.getItem(STORAGE.keywords) || '[]');
}
function saveKeywords(list) {
  localStorage.setItem(STORAGE.keywords, JSON.stringify(list));
  updateStats();
}
function addKeyword() {
  const input = document.getElementById('keyword-input');
  const kw = input.value.trim();
  if (!kw) return;
  const list = getKeywords();
  if (list.includes(kw)) { showToast('이미 추가된 키워드입니다.', true); return; }
  list.push(kw);
  saveKeywords(list);
  renderKeywordTags();
  input.value = '';
  input.focus();
}
function removeKeyword(kw) {
  const list = getKeywords().filter(k => k !== kw);
  saveKeywords(list);
  renderKeywordTags();
}
function renderKeywordTags() {
  const list = getKeywords();
  const container = document.getElementById('keyword-tags');
  const empty = document.getElementById('empty-tags');
  empty.style.display = list.length ? 'none' : 'block';
  container.querySelectorAll('.keyword-tag').forEach(el => el.remove());
  list.forEach(kw => {
    const tag = document.createElement('span');
    tag.className = 'keyword-tag';
    tag.innerHTML = `${kw}<button onclick="removeKeyword('${kw.replace(/'/g, "\\'")}')">×</button>`;
    container.appendChild(tag);
  });
}

// ── Options ─────────────────────────────────────────────
function setCount(btn) {
  document.querySelectorAll('.btn-opt[data-count]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  settings.count = parseInt(btn.dataset.count);
  localStorage.setItem(STORAGE.count, settings.count);
}
function setSort(btn) {
  document.querySelectorAll('.btn-opt[data-sort]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  settings.sort = btn.dataset.sort;
  localStorage.setItem(STORAGE.sort, settings.sort);
}

// ── API Settings ─────────────────────────────────────────
function saveApiSettings() {
  settings.naver_client_id = document.getElementById('naver_client_id').value.trim();
  settings.naver_client_secret = document.getElementById('naver_client_secret').value.trim();
  settings.telegram_token = document.getElementById('telegram_token').value.trim();
  settings.telegram_chat_id = document.getElementById('telegram_chat_id').value.trim();
  localStorage.setItem(STORAGE.api, JSON.stringify({
    naver_client_id: settings.naver_client_id,
    naver_client_secret: settings.naver_client_secret,
    telegram_token: settings.telegram_token,
    telegram_chat_id: settings.telegram_chat_id,
  }));
  checkTelegramStatus();
  showToast('설정이 저장되었습니다.');
}

async function checkTelegramStatus() {
  const el = document.getElementById('stat-telegram');
  try {
    const res = await fetch('/api/env-status');
    const data = await res.json();
    const hasTelegram = data.telegram || (settings.telegram_token && settings.telegram_chat_id);
    el.textContent = hasTelegram ? '연결됨' : '미설정';
    el.className = 'stat-value telegram-status ' + (hasTelegram ? 'connected' : 'disconnected');
  } catch {
    el.textContent = '확인 불가';
  }
}

// ── Collect ──────────────────────────────────────────────
async function collectAll() {
  const keywords = getKeywords();
  if (!keywords.length) {
    switchTab('keywords');
    showToast('먼저 키워드를 추가해주세요.', true);
    return;
  }

  const btn = document.getElementById('btn-collect');
  const icon = document.getElementById('collect-icon');
  btn.disabled = true;
  icon.classList.add('spin');
  switchTab('news');

  document.getElementById('news-empty').style.display = 'none';
  document.getElementById('news-list').innerHTML = '';

  let totalSent = 0;
  const errors = [];

  for (const kw of keywords) {
    const result = await sendKeyword(kw);
    if (result.success) {
      totalSent += result.count;
      renderArticles(kw, result.articles);
      logHistory(kw, result.count, true);
    } else {
      errors.push(`${kw}: ${result.error}`);
      logHistory(kw, 0, false, result.error);
    }
  }

  btn.disabled = false;
  icon.classList.remove('spin');

  if (totalSent > 0) {
    recordStats(totalSent);
    showToast(`${totalSent}건을 텔레그램으로 전송했습니다.`);
  }
  if (errors.length) {
    showToast(errors[0], true);
  }
  if (!document.getElementById('news-list').children.length) {
    document.getElementById('news-empty').style.display = 'flex';
  }
  renderHistory();
  updateStats();
}

async function sendKeyword(keyword) {
  const payload = {
    keyword,
    count: settings.count,
    sort: settings.sort,
    naver_client_id: settings.naver_client_id,
    naver_client_secret: settings.naver_client_secret,
    telegram_token: settings.telegram_token,
    telegram_chat_id: settings.telegram_chat_id,
  };
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Render Articles ──────────────────────────────────────
function renderArticles(keyword, articles) {
  const list = document.getElementById('news-list');
  articles.forEach((a, i) => {
    const card = document.createElement('div');
    card.className = 'article-card';
    card.innerHTML = `
      <div><span class="article-kw">${keyword}</span></div>
      <a class="article-title" href="${a.link}" target="_blank" rel="noopener">
        <span class="article-num">${i + 1}.</span>${a.title}
      </a>
      ${a.description ? `<p class="article-desc">${a.description.slice(0, 140)}${a.description.length > 140 ? '...' : ''}</p>` : ''}
      <div class="article-meta">
        ${a.pubDate ? `<span>${a.pubDate}</span>` : ''}
        <a class="article-link" href="${a.link}" target="_blank" rel="noopener">원문 보기 →</a>
      </div>`;
    list.appendChild(card);
  });
}

// ── Stats ────────────────────────────────────────────────
function recordStats(count) {
  const history = getHistoryData();
  const now = Date.now();
  history.unshift({ time: now, count, ok: true });
  localStorage.setItem(STORAGE.history, JSON.stringify(history.slice(0, 100)));
}
function updateStats() {
  const history = getHistoryData();
  const total = history.filter(h => h.ok).reduce((s, h) => s + (h.count || 0), 0);
  const now = Date.now();
  const h24 = history.filter(h => h.ok && h.time > now - 86400000).reduce((s, h) => s + (h.count || 0), 0);
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-24h').textContent = h24;
  document.getElementById('stat-keywords').textContent = getKeywords().length;
}

// ── History ──────────────────────────────────────────────
function getHistoryData() {
  return JSON.parse(localStorage.getItem(STORAGE.history) || '[]');
}
function logHistory(keyword, count, ok, error) {
  const history = getHistoryData();
  history.unshift({ keyword, count, ok, error, time: Date.now() });
  localStorage.setItem(STORAGE.history, JSON.stringify(history.slice(0, 100)));
}
function clearHistory() {
  localStorage.removeItem(STORAGE.history);
  updateStats();
  renderHistory();
}
function renderHistory() {
  const history = getHistoryData();
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const items = list.querySelectorAll('.history-item');
  items.forEach(el => el.remove());

  if (!history.length) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';

  history.forEach(h => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const time = new Date(h.time).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const detail = h.ok ? `"${h.keyword}" · ${h.count}건 전송 완료` : `"${h.keyword}" · 실패: ${h.error || '알 수 없는 오류'}`;
    item.innerHTML = `
      <div class="history-status ${h.ok ? 'ok' : 'fail'}"></div>
      <div class="history-body">
        <p class="history-title">${h.ok ? '수집 완료' : '수집 실패'}</p>
        <p class="history-detail">${detail}</p>
      </div>
      <span class="history-time">${time}</span>`;
    list.appendChild(item);
  });
}

// ── Toast ────────────────────────────────────────────────
let toastTimer;
function showToast(msg, isError = false) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = isError ? 'error show' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
