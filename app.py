from flask import Flask, render_template, request, jsonify
import requests
import os
import re
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

NAVER_CLIENT_ID = os.getenv('NAVER_CLIENT_ID', '')
NAVER_CLIENT_SECRET = os.getenv('NAVER_CLIENT_SECRET', '')
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID', '')


def clean_html(text):
    text = re.sub(r'<[^>]+>', '', text)
    text = text.replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&#39;', "'")
    return text.strip()


def search_naver_news(keyword, display=5, sort='date', client_id=None, client_secret=None):
    cid = client_id or NAVER_CLIENT_ID
    csec = client_secret or NAVER_CLIENT_SECRET
    url = 'https://openapi.naver.com/v1/search/news.json'
    headers = {
        'X-Naver-Client-Id': cid,
        'X-Naver-Client-Secret': csec,
    }
    params = {'query': keyword, 'display': min(display, 100), 'sort': sort}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        if resp.status_code == 200:
            return resp.json(), None
        try:
            msg = resp.json().get('errorMessage', '알 수 없는 오류')
        except Exception:
            msg = '알 수 없는 오류'
        return None, f'네이버 API 오류 ({resp.status_code}): {msg}'
    except Exception as e:
        return None, str(e)


def send_telegram(message, token=None, chat_id=None):
    tok = token or TELEGRAM_BOT_TOKEN
    cid = chat_id or TELEGRAM_CHAT_ID
    url = f'https://api.telegram.org/bot{tok}/sendMessage'
    payload = {'chat_id': cid, 'text': message, 'parse_mode': 'HTML', 'disable_web_page_preview': True}
    try:
        resp = requests.post(url, json=payload, timeout=10)
        result = resp.json()
        if result.get('ok'):
            return True, None
        return False, result.get('description', '알 수 없는 오류')
    except Exception as e:
        return False, str(e)


def format_message(keyword, items):
    now = datetime.now().strftime('%Y-%m-%d %H:%M')
    lines = [
        f'📰 <b>네이버 뉴스 | {keyword}</b>',
        f'🕐 {now} 기준  |  총 {len(items)}건',
        '',
    ]
    for i, item in enumerate(items, 1):
        title = clean_html(item['title'])
        desc = clean_html(item['description'])
        pub_date = item.get('pubDate', '')
        link = item.get('originallink') or item.get('link', '')
        lines.append(f'{i}. <b>{title}</b>')
        if pub_date:
            lines.append(f'   📅 {pub_date}')
        if desc:
            lines.append(f'   {desc[:120]}{"..." if len(desc) > 120 else ""}')
        lines.append(f'   🔗 {link}')
        lines.append('')
    return '\n'.join(lines)


@app.route('/')
def index():
    env_configured = bool(NAVER_CLIENT_ID and NAVER_CLIENT_SECRET and TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)
    return render_template('index.html', env_configured=env_configured)


@app.route('/api/search', methods=['POST'])
def search():
    data = request.get_json(silent=True) or {}
    keyword = data.get('keyword', '').strip()
    count = max(1, min(int(data.get('count', 5)), 20))
    sort = data.get('sort', 'date')
    client_id = data.get('naver_client_id', '').strip() or NAVER_CLIENT_ID
    client_secret = data.get('naver_client_secret', '').strip() or NAVER_CLIENT_SECRET
    token = data.get('telegram_token', '').strip() or TELEGRAM_BOT_TOKEN
    chat_id = data.get('telegram_chat_id', '').strip() or TELEGRAM_CHAT_ID

    if not keyword:
        return jsonify({'success': False, 'error': '키워드를 입력해주세요.'})
    if not client_id or not client_secret:
        return jsonify({'success': False, 'error': '네이버 API 키를 설정해주세요.'})
    if not token or not chat_id:
        return jsonify({'success': False, 'error': '텔레그램 봇 설정을 입력해주세요.'})

    news_data, err = search_naver_news(keyword, display=count, sort=sort, client_id=client_id, client_secret=client_secret)
    if err:
        return jsonify({'success': False, 'error': err})

    items = news_data.get('items', [])
    if not items:
        return jsonify({'success': False, 'error': f'"{keyword}"에 대한 뉴스가 없습니다.'})

    message = format_message(keyword, items)
    ok, err = send_telegram(message, token=token, chat_id=chat_id)
    if not ok:
        return jsonify({'success': False, 'error': f'텔레그램 전송 실패: {err}'})

    articles = [
        {
            'title': clean_html(it['title']),
            'description': clean_html(it['description']),
            'link': it.get('originallink') or it.get('link', ''),
            'pubDate': it.get('pubDate', ''),
        }
        for it in items
    ]
    return jsonify({'success': True, 'count': len(items), 'articles': articles})


@app.route('/api/env-status')
def env_status():
    return jsonify({
        'naver': bool(NAVER_CLIENT_ID and NAVER_CLIENT_SECRET),
        'telegram': bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID),
    })


if __name__ == '__main__':
    app.run(debug=True, port=5000)
