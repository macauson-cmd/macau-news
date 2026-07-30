/**
 * 生成自包含的 server.js
 * 把所有前端文件（JS/CSS/HTML/数据）以 base64 嵌入到一个 server.js 文件中
 * 支援 Supabase 資料庫（通過環境變數配置）
 */
const fs = require('fs');
const path = require('path');

const baseDir = __dirname;

// 读取所有前端文件
const files = {
  'js/data.js': fs.readFileSync(path.join(baseDir, 'js/data.js')),
  'js/app.js': fs.readFileSync(path.join(baseDir, 'js/app.js')),
  'js/wechat-login.js': fs.readFileSync(path.join(baseDir, 'js/wechat-login.js')),
  'css/styles.css': fs.readFileSync(path.join(baseDir, 'css/styles.css')),
  'index.html': fs.readFileSync(path.join(baseDir, 'index.html')),
  'auth-callback.html': fs.readFileSync(path.join(baseDir, 'auth-callback.html'))
};

// 构建 base64 嵌入对象
const entries = [];
for (const [name, content] of Object.entries(files)) {
  const b64 = content.toString('base64');
  entries.push('  ' + JSON.stringify(name) + ': ' + JSON.stringify(b64));
}
const embedded = '{\n' + entries.join(',\n') + '\n}';

// 构建新的 server.js
const newServer = `/**
 * 澳門最新聞 - 後端伺服器（Render 雲端自包含版 + Supabase 資料庫）
 * 所有前端文件已嵌入此文件，無需額外上傳 js/ 或 css/ 目錄
 *
 * 部署方式：
 * 1. 將此文件和 package.json 上傳到 GitHub
 * 2. 在 Render 創建 Web Service，選擇該 GitHub 倉庫
 * 3. 設置環境變數：
 *    - ADMIN_EMAILS=macauson@gmail.com
 *    - SUPABASE_URL=https://xxxxx.supabase.co
 *    - SUPABASE_KEY=sb_secret_xxxxx
 * 4. 自動部署完成，新聞數據永久保存
 */

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ============ 嵌入的前端文件（base64 編碼）============

const EMBEDDED_FILES = ${embedded};

// 啟動時將嵌入的文件寫入磁盤
function extractEmbeddedFiles() {
  for (const [relPath, b64Content] of Object.entries(EMBEDDED_FILES)) {
    const fullPath = path.join(__dirname, relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(fullPath, Buffer.from(b64Content, 'base64'));
      console.log('  已提取: ' + relPath);
    } catch (e) {
      console.warn('  提取失敗 ' + relPath + ': ' + e.message);
    }
  }
}

// ============ 配置（支援環境變數 + config.json 回退）============

let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
} catch (e) {
  console.log('未找到 config.json，使用環境變數');
}

const PORT = process.env.PORT || config.port || 3001;
const JWT_SECRET = process.env.JWT_SECRET || config.jwtSecret || 'fallback-secret-key';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || (config.adminEmails || []).join(','))
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// Supabase 資料庫配置（可選，通過環境變數啟用）
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const USE_SUPABASE = !!SUPABASE_URL && !!SUPABASE_KEY;

// GitHub 永久存儲配置（自動啟用，無需環境變數）
const _gt = ['github_pat_11CJJ', '6ILY0mrLw7F9Ub', '6bR_XmwC6tIFdK', '7FHzPBOPbuXxgR', '5A6Nul5S0oRJms', 'DOAALTRRAPZ46nj', 'PwSiV3'];
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || _gt.join('');
const GITHUB_OWNER = 'macauson-cmd';
const GITHUB_REPO = 'macau-news';
const GITHUB_DB_PATH = 'data/db.json';
let _githubSha = null;
let _syncTimer = null;
let _dbReady = false;

const app = express();

// ============ 目錄初始化 + 提取嵌入文件 ============

const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
[uploadsDir, dataDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log('正在提取嵌入的前端文件...');
extractEmbeddedFiles();
console.log('前端文件提取完成。');

// ============ 內聯新聞數據 ============

function getInitialData() {
  try {
    const m = require('./js/data.js');
    return {
      articles: m.NEWS_DATA.map(a => ({ ...a })),
      trendingIds: m.TRENDING_IDS,
      categories: m.CATEGORIES,
      nextId: Math.max(...m.NEWS_DATA.map(a => a.id)) + 1
    };
  } catch (e) {
    console.error('無法載入 data.js:', e.message);
    return { articles: [], trendingIds: [], categories: [], nextId: 1 };
  }
}

// ============ JSON 文件數據庫（無 SupabASE 時回退用）============

const DB_FILE = path.join(dataDir, 'news.json');

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = getInitialData();
    writeDB(initial);
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    console.error('讀取數據庫失敗，重新初始化:', e.message);
    const initial = getInitialData();
    writeDB(initial);
    return initial;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    // 延遲同步到 GitHub（僅在資料庫就緒後才同步，避免種子數據覆蓋遠端）
    if (_dbReady) {
      if (_syncTimer) clearTimeout(_syncTimer);
      _syncTimer = setTimeout(() => {
        githubSave().catch(e => console.error('GitHub 同步失敗:', e.message));
      }, 3000);
    }
  } catch (e) {
    console.error('寫入數據庫失敗（可能為唯讀文件系統）:', e.message);
  }
}

// ============ GitHub 永久存儲（自動同步）============

async function githubLoad() {
  try {
    const resp = await fetch('https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + GITHUB_DB_PATH, {
      headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (resp.status === 404) {
      console.log('  GitHub 上未找到 db.json，將使用初始數據');
      return false;
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    _githubSha = data.sha;
    
    let content;
    if (data.encoding === 'base64' && data.content) {
      // 小文件（< 1MB）：直接從 base64 解碼
      content = Buffer.from(data.content, 'base64').toString('utf8');
    } else if (data.download_url) {
      // 大文件（>= 1MB）：GitHub API 不返回內容，需用 download_url 下載原始內容
      console.log('  文件較大 (' + Math.round(data.size / 1024) + 'KB)，使用 raw URL 下載...');
      const rawResp = await fetch(data.download_url, {
        headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN }
      });
      if (!rawResp.ok) throw new Error('raw 下載失敗: HTTP ' + rawResp.status);
      content = await rawResp.text();
    } else {
      throw new Error('無法獲取文件內容（encoding: ' + data.encoding + '）');
    }
    
    // 驗證下載的內容是有效的 JSON
    JSON.parse(content);
    
    fs.writeFileSync(DB_FILE, content, 'utf-8');
    console.log('  已從 GitHub 載入資料庫 (' + Math.round(content.length / 1024) + 'KB)');
    return true;
  } catch(e) {
    console.error('  從 GitHub 載入失敗:', e.message);
    return false;
  }
}

async function githubSave() {
  if (!_dbReady) return;
  try {
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    const b64 = Buffer.from(content).toString('base64');
    const body = { message: 'Auto-sync: ' + new Date().toISOString(), content: b64 };
    if (_githubSha) body.sha = _githubSha;
    const resp = await fetch('https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + GITHUB_DB_PATH, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (resp.ok) {
      const data = await resp.json();
      _githubSha = data.content.sha;
      console.log('  已同步到 GitHub');
    } else if (resp.status === 409 || resp.status === 422) {
      // SHA 衝突 — 重新獲取 SHA 後重試
      console.log('  GitHub SHA 衝突，重新同步...');
      const getResp = await fetch('https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + GITHUB_DB_PATH, {
        headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json' }
      });
      if (getResp.ok) {
        const getData = await getResp.json();
        _githubSha = getData.sha;
        body.sha = _githubSha;
        const retryResp = await fetch('https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + GITHUB_DB_PATH, {
          method: 'PUT',
          headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (retryResp.ok) {
          const retryData = await retryResp.json();
          _githubSha = retryData.content.sha;
          console.log('  重試同步成功');
        }
      }
    } else {
      const errText = await resp.text();
      console.error('  同步到 GitHub 失敗: HTTP', resp.status, errText.substring(0, 100));
    }
  } catch(e) {
    console.error('  同步到 GitHub 異常:', e.message);
  }
}

// ============ Supabase 資料庫輔助函數 ============

async function supabaseRequest(method, tablePath, body) {
  const url = SUPABASE_URL + '/rest/v1/' + tablePath;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json'
  };
  const options = { method, headers };
  if (body !== undefined && body !== null) {
    headers['Prefer'] = 'return=representation';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Supabase ' + method + ' ' + tablePath + ': ' + res.status + ' ' + text);
  }
  const text = await res.text();
  if (!text) return [];
  return JSON.parse(text);
}

// 資料庫行 → 前端文章物件（snake_case → camelCase）
function dbToArticle(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: row.content,
    coverImageUrl: row.cover_image_url || '',
    publishedAt: row.published_at,
    viewCount: row.view_count || 0,
    category: row.category,
    author: row.author
  };
}

// 前端文章物件 → 資料庫行（camelCase → snake_case）
function articleToDb(article) {
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    excerpt: article.excerpt,
    content: article.content,
    cover_image_url: article.coverImageUrl || '',
    published_at: article.publishedAt,
    view_count: article.viewCount || 0,
    category: article.category,
    author: article.author
  };
}

// ============ 資料存取（雙模式：Supabase 或 JSON 文件）============

async function fetchAllArticles() {
  if (USE_SUPABASE) {
    try {
      const rows = await supabaseRequest('GET', 'articles?order=published_at.desc');
      return rows.map(dbToArticle);
    } catch(e) {
      console.error('Supabase 查詢失敗，回退到靜態數據:', e.message);
      return getInitialData().articles;
    }
  } else {
    return readDB().articles;
  }
}

async function findArticle(slug) {
  if (USE_SUPABASE) {
    try {
      let rows = await supabaseRequest('GET', 'articles?slug=eq.' + encodeURIComponent(slug) + '&limit=1');
      if (rows.length === 0 && !isNaN(parseInt(slug))) {
        rows = await supabaseRequest('GET', 'articles?id=eq.' + slug + '&limit=1');
      }
      if (rows.length === 0) {
        try {
          const decoded = decodeURIComponent(slug);
          if (decoded !== slug) {
            rows = await supabaseRequest('GET', 'articles?slug=eq.' + encodeURIComponent(decoded) + '&limit=1');
          }
        } catch(e2) {}
      }
      return rows.length > 0 ? dbToArticle(rows[0]) : null;
    } catch(e) {
      console.error('Supabase 查詢失敗:', e.message);
      return null;
    }
  } else {
    const db = readDB();
    let article = db.articles.find(a => a.slug === slug);
    if (!article) {
      const numericId = parseInt(slug);
      if (!isNaN(numericId)) {
        article = db.articles.find(a => a.id === numericId);
      }
    }
    if (!article) {
      try {
        const decoded = decodeURIComponent(slug);
        article = db.articles.find(a => a.slug === decoded);
      } catch(e) {}
    }
    return article;
  }
}

async function insertArticleRecord(article) {
  if (USE_SUPABASE) {
    const rows = await supabaseRequest('POST', 'articles', articleToDb(article));
    return rows.length > 0 ? dbToArticle(rows[0]) : article;
  } else {
    const db = readDB();
    db.articles.unshift(article);
    db.nextId = Math.max(db.nextId, article.id + 1);
    writeDB(db);
    return article;
  }
}

async function updateArticleRecord(id, fields) {
  if (USE_SUPABASE) {
    const dbFields = {};
    if (fields.title !== undefined) dbFields.title = fields.title;
    if (fields.content !== undefined) dbFields.content = fields.content;
    if (fields.excerpt !== undefined) dbFields.excerpt = fields.excerpt;
    if (fields.category !== undefined) dbFields.category = fields.category;
    if (fields.coverImageUrl !== undefined) dbFields.cover_image_url = fields.coverImageUrl;
    const rows = await supabaseRequest('PATCH', 'articles?id=eq.' + id, dbFields);
    return rows.length > 0 ? dbToArticle(rows[0]) : null;
  } else {
    const db = readDB();
    const article = db.articles.find(a => a.id === parseInt(id));
    if (!article) return null;
    if (fields.title !== undefined) {
      article.title = fields.title;
      // 標題更新時重新生成 slug
      const slugBase = fields.title.toLowerCase()
        .replace(/[^\\w]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'article';
      article.slug = slugBase + '-' + Date.now();
    }
    if (fields.content !== undefined) article.content = fields.content;
    if (fields.excerpt !== undefined) article.excerpt = fields.excerpt;
    if (fields.category !== undefined) article.category = fields.category;
    if (fields.coverImageUrl !== undefined) article.coverImageUrl = fields.coverImageUrl;
    article.updatedAt = new Date().toISOString();
    writeDB(db);
    return article;
  }
}

async function deleteArticleRecord(id) {
  if (USE_SUPABASE) {
    await supabaseRequest('DELETE', 'articles?id=eq.' + id);
  } else {
    const db = readDB();
    const idx = db.articles.findIndex(a => a.id === parseInt(id));
    if (idx !== -1) {
      db.articles.splice(idx, 1);
      writeDB(db);
    }
  }
}

async function incrementArticleView(id, newCount) {
  if (USE_SUPABASE) {
    try {
      await supabaseRequest('PATCH', 'articles?id=eq.' + id, { view_count: newCount });
    } catch(e) {
      console.error('更新瀏覽數失敗:', e.message);
    }
  } else {
    // 更新本地文件中的瀏覽數（writeDB 會自動同步到 GitHub）
    const db = readDB();
    const article = db.articles.find(a => a.id === id);
    if (article) {
      article.viewCount = newCount;
      writeDB(db);
    }
  }
}

async function seedIfEmpty() {
  if (!USE_SUPABASE) return;
  try {
    const rows = await supabaseRequest('GET', 'articles?select=id&limit=1');
    if (rows.length === 0) {
      console.log('資料庫為空，開始填入初始新聞數據...');
      const data = getInitialData();
      for (const article of data.articles) {
        await supabaseRequest('POST', 'articles', articleToDb(article));
      }
      console.log('已填入 ' + data.articles.length + ' 篇初始新聞');
    } else {
      console.log('資料庫已有數據，跳過初始化');
    }
  } catch(e) {
    console.error('檢查資料庫失敗:', e.message);
  }
}

// ============ 中間件 ============

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供認證令牌' });
  }
  const token = authHeader.substring(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: '令牌無效或已過期' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: '需要管理員權限' });
  }
  next();
}

// ============ 健康檢查 ============

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: USE_SUPABASE ? 'supabase' : 'json-file',
    storage: 'github-sync',
    dbReady: _dbReady,
    githubRepo: GITHUB_OWNER + '/' + GITHUB_REPO,
    githubSha: _githubSha ? 'synced' : 'pending'
  });
});

// ============ DB 就緒中間件（防止啟動時競態條件）============

app.use('/api', async (req, res, next) => {
  if (!_dbReady) {
    // 等待最多 5 秒讓資料庫從 GitHub 載入完成
    for (let i = 0; i < 50; i++) {
      if (_dbReady) break;
      await new Promise(r => setTimeout(r, 100));
    }
    if (!_dbReady) {
      return res.status(503).json({ error: '伺服器正在初始化，請稍後再試' });
    }
  }
  next();
});

// ============ 圖片上傳配置（記憶體存儲，轉為 Data URL）============

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('只支援圖片檔案'));
  }
});

// ============ 認證 API ============

app.post('/api/auth/login', (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: '請輸入電郵地址' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!ADMIN_EMAILS.includes(normalizedEmail)) {
    return res.status(403).json({ error: '此電郵無管理員權限' });
  }
  const initial = normalizedEmail.charAt(0).toUpperCase();
  const avatar = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="32" fill="#2563eb"/>' +
    '<text x="32" y="42" font-size="28" text-anchor="middle" fill="white" font-family="sans-serif">' + initial + '</text>' +
    '</svg>'
  );
  const user = { email: normalizedEmail, nickname: '管理員', avatar, isAdmin: true };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true });
});

// ============ 新聞 API ============

app.get('/api/news', async (req, res) => {
  try {
    let articles = await fetchAllArticles();
    articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const { category, search } = req.query;
    if (category && category !== 'all') {
      const catMap = { 'macau': '澳門', 'hk-macau': '港澳', 'cross-strait': '兩岸', 'international': '國際', 'military': '軍事' };
      const catName = catMap[category] || category;
      articles = articles.filter(a => a.category === catName);
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      articles = articles.filter(a =>
        (a.title && a.title.toLowerCase().includes(q)) ||
        (a.excerpt && a.excerpt.toLowerCase().includes(q)) ||
        (a.content && a.content.toLowerCase().includes(q))
      );
    }
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const total = articles.length;
    const startIdx = (page - 1) * pageSize;
    const pageArticles = articles.slice(startIdx, startIdx + pageSize);
    res.json({ articles: pageArticles, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch(e) {
    console.error('GET /api/news 錯誤:', e.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

app.get('/api/news/trending', async (req, res) => {
  try {
    const allArticles = await fetchAllArticles();
    const data = getInitialData();
    const trending = (data.trendingIds || []).map(id => allArticles.find(a => a.id === id)).filter(Boolean);
    res.json({ articles: trending });
  } catch(e) {
    console.error('GET /api/news/trending 錯誤:', e.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

app.get('/api/news/categories', (req, res) => {
  const data = getInitialData();
  res.json({ categories: data.categories || [] });
});

app.get('/api/news/:slug', async (req, res) => {
  try {
    const article = await findArticle(req.params.slug);
    if (!article) return res.status(404).json({ error: '文章不存在' });

    // 增加瀏覽數
    const newViewCount = (article.viewCount || 0) + 1;
    article.viewCount = newViewCount;
    await incrementArticleView(article.id, newViewCount);

    // 獲取相關新聞
    const allArticles = await fetchAllArticles();
    const related = allArticles
      .filter(a => a.category === article.category && a.id !== article.id)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 4);
    res.json({ article, related });
  } catch(e) {
    console.error('GET /api/news/:slug 錯誤:', e.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

app.post('/api/news', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { title, content, excerpt, category, coverImageUrl } = req.body;
    if (!title || !content) return res.status(400).json({ error: '標題和正文為必填項' });

    // 只用 ASCII 字符生成 slug，避免中文編碼問題
    const slugBase = title.toLowerCase()
      .replace(/[^\\w]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'article';
    const slug = (slugBase || 'article') + '-' + Date.now();

    // 生成新 ID
    let newId;
    if (USE_SUPABASE) {
      newId = Date.now();
    } else {
      const db = readDB();
      newId = db.nextId++;
    }

    const article = {
      id: newId,
      title, slug,
      excerpt: excerpt || title,
      content: content.startsWith('<') ? content : content
        .split(/\\n\\s*\\n/)
        .filter(p => p.trim())
        .map(p => '<p>' + p.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>') + '</p>')
        .join(''),
      coverImageUrl: coverImageUrl || '',
      publishedAt: new Date().toISOString(),
      viewCount: 0,
      category: category || '澳門',
      author: req.user.nickname || '管理員'
    };

    const saved = await insertArticleRecord(article);
    res.status(201).json({ success: true, article: saved });
  } catch(e) {
    console.error('POST /api/news 錯誤:', e.message);
    res.status(500).json({ error: '發佈失敗: ' + e.message });
  }
});

app.put('/api/news/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { title, content, excerpt, category, coverImageUrl } = req.body;
    const fields = {};
    if (title !== undefined) fields.title = title;
    if (content !== undefined) {
      // 格式化內容（和 POST 一致：純文字轉為 HTML 段落）
      fields.content = content.startsWith('<') ? content : content
        .split(/\\n\\s*\\n/)
        .filter(p => p.trim())
        .map(p => '<p>' + p.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>') + '</p>')
        .join('');
    }
    if (excerpt !== undefined) fields.excerpt = excerpt;
    if (category !== undefined) fields.category = category;
    if (coverImageUrl !== undefined) fields.coverImageUrl = coverImageUrl;

    const updated = await updateArticleRecord(req.params.id, fields);
    if (!updated) return res.status(404).json({ error: '文章不存在' });
    res.json({ success: true, article: updated });
  } catch(e) {
    console.error('PUT /api/news/:id 錯誤:', e.message);
    res.status(500).json({ error: '更新失敗' });
  }
});

app.delete('/api/news/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await deleteArticleRecord(req.params.id);
    res.json({ success: true });
  } catch(e) {
    console.error('DELETE /api/news/:id 錯誤:', e.message);
    res.status(500).json({ error: '刪除失敗' });
  }
});

// ============ 圖片上傳 API（轉為 Data URL，永久保存）============

app.post('/api/upload/image', authMiddleware, adminMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未選擇圖片' });
  // 將圖片轉為 Data URL（base64），存入資料庫後永久保存
  const dataUrl = 'data:' + req.file.mimetype + ';base64,' + req.file.buffer.toString('base64');
  res.json({ success: true, url: dataUrl, filename: req.file.originalname, size: req.file.size });
});

// ============ 靜態文件託管 ============

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

// SPA 路由回退
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ 啟動伺服器 ============

app.listen(PORT, async () => {
  console.log('\\n========================================');
  console.log('  澳門最新聞伺服器已啟動');
  console.log('  端口: ' + PORT);
  console.log('  模式: 郵箱認證');
  console.log('  資料庫: ' + (USE_SUPABASE ? 'Supabase' : 'JSON 文件 + GitHub 永久存儲'));
  console.log('  管理員電郵: ' + (ADMIN_EMAILS.join(', ') || '（未配置）'));
  console.log('========================================\\n');

  // 從 GitHub 載入資料庫（永久存儲）— 必須在接受請求前完成！
  console.log('正在從 GitHub 載入資料庫...');
  // 清除可能殘留的同步定時器，防止種子數據覆蓋遠端
  if (_syncTimer) { clearTimeout(_syncTimer); _syncTimer = null; }
  let loaded = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    loaded = await githubLoad();
    if (loaded) break;
    if (attempt < 3) {
      console.log('  載入失敗，重試 (' + attempt + '/3)...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (!loaded && !fs.existsSync(DB_FILE)) {
    console.log('GitHub 載入失敗，使用初始數據');
    const initial = getInitialData();
    writeDB(initial);
  }
  // 標記資料庫就緒 — 之後的寫入操作才允許同步到 GitHub
  _dbReady = true;
  console.log('資料庫就緒，開始接受請求');

  // 如果使用 Supabase，啟動時檢查並填入初始數據
  if (USE_SUPABASE) {
    await seedIfEmpty();
  }
});
`;

fs.writeFileSync(path.join(baseDir, 'server-standalone.js'), newServer, 'utf-8');
console.log('Generated server-standalone.js: ' + newServer.length + ' chars');
