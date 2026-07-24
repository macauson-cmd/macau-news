/**
 * 澳門最新聞 - 後端伺服器（Render 雲端版）
 * Express + JWT + 郵箱認證 + 圖片上傳
 *
 * 部署到 Render：
 * - 自動讀取 Render 的 PORT 環境變數
 * - JWT_SECRET 和 ADMIN_EMAILS 從環境變數讀取（更安全）
 * - 無 config.json 時也能啟動
 */

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ============ 配置（支援環境變數 + config.json 回退） ============

let config = {};
try {
  config = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8')
  );
} catch (e) {
  console.log('未找到 config.json，使用環境變數');
}

const PORT = process.env.PORT || config.port || 3001;
const JWT_SECRET = process.env.JWT_SECRET || config.jwtSecret || 'fallback-secret-key';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || (config.adminEmails || []).join(','))
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const app = express();

// ============ 目錄初始化 ============

const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
[uploadsDir, dataDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============ JSON 文件數據庫 ============

const DB_FILE = path.join(dataDir, 'news.json');

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    // 首次啟動：從 data.js 導入初始數據
    const { NEWS_DATA, TRENDING_IDS, CATEGORIES } = require('./js/data.js');
    const initial = {
      articles: NEWS_DATA.map(a => ({ ...a })),
      trendingIds: TRENDING_IDS,
      categories: CATEGORIES,
      nextId: Math.max(...NEWS_DATA.map(a => a.id)) + 1
    };
    writeDB(initial);
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ============ 中間件 ============

// CORS — 允許所有來源
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));

// JWT 認證中間件
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

// 管理員權限中間件
function adminMiddleware(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: '需要管理員權限' });
  }
  next();
}

// ============ 健康檢查（Render 需要） ============

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ 圖片上傳配置 ============

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只支援圖片檔案'));
    }
  }
});

// ============ 認證 API ============

/**
 * 郵箱登入
 * POST /api/auth/login
 * body: { email: "macauson@gmail.com" }
 */
app.post('/api/auth/login', (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: '請輸入電郵地址' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // 檢查是否為管理員
  if (!ADMIN_EMAILS.includes(normalizedEmail)) {
    return res.status(403).json({ error: '此電郵無管理員權限' });
  }

  // 生成用戶頭像（SVG，基於郵箱首字母）
  const initial = normalizedEmail.charAt(0).toUpperCase();
  const avatar = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="32" fill="#2563eb"/>' +
    `<text x="32" y="42" font-size="28" text-anchor="middle" fill="white" font-family="sans-serif">${initial}</text>` +
    '</svg>'
  );

  const user = {
    email: normalizedEmail,
    nickname: '管理員',
    avatar,
    isAdmin: true
  };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user });
});

/**
 * 獲取當前登入用戶
 * GET /api/auth/me
 */
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

/**
 * 登出
 * POST /api/auth/logout
 */
app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true });
});

// ============ 新聞 API ============

/**
 * 獲取所有新聞（公開）
 * GET /api/news?category=xxx&search=xxx&page=1&pageSize=10
 */
app.get('/api/news', (req, res) => {
  const db = readDB();
  let articles = [...db.articles];

  // 按發布時間倒序
  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  // 分類篩選
  const { category, search } = req.query;
  if (category && category !== 'all') {
    const catMap = {
      'macau': '澳門',
      'hk-macau': '港澳',
      'cross-strait': '兩岸',
      'international': '國際',
      'military': '軍事'
    };
    const catName = catMap[category] || category;
    articles = articles.filter(a => a.category === catName);
  }

  // 搜尋
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    articles = articles.filter(a =>
      (a.title && a.title.toLowerCase().includes(q)) ||
      (a.excerpt && a.excerpt.toLowerCase().includes(q)) ||
      (a.content && a.content.toLowerCase().includes(q))
    );
  }

  // 分頁
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const total = articles.length;
  const startIdx = (page - 1) * pageSize;
  const pageArticles = articles.slice(startIdx, startIdx + pageSize);

  res.json({
    articles: pageArticles,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  });
});

/**
 * 獲取趨勢新聞（公開）
 * GET /api/news/trending
 */
app.get('/api/news/trending', (req, res) => {
  const db = readDB();
  const trending = (db.trendingIds || [])
    .map(id => db.articles.find(a => a.id === id))
    .filter(Boolean);
  res.json({ articles: trending });
});

/**
 * 獲取分類列表（公開）
 * GET /api/news/categories
 */
app.get('/api/news/categories', (req, res) => {
  const db = readDB();
  res.json({ categories: db.categories || [] });
});

/**
 * 獲取單篇文章（公開，自動增加瀏覽數）
 * GET /api/news/:slug
 */
app.get('/api/news/:slug', (req, res) => {
  const db = readDB();
  const article = db.articles.find(a => a.slug === req.params.slug);
  if (!article) {
    return res.status(404).json({ error: '文章不存在' });
  }
  // 增加瀏覽數
  article.viewCount = (article.viewCount || 0) + 1;
  writeDB(db);

  // 獲取相關新聞
  const related = db.articles
    .filter(a => a.category === article.category && a.id !== article.id)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 4);

  res.json({ article, related });
});

/**
 * 發布新聞（管理員）
 * POST /api/news
 */
app.post('/api/news', authMiddleware, adminMiddleware, (req, res) => {
  const { title, content, excerpt, category, coverImageUrl } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: '標題和正文為必填項' });
  }

  const db = readDB();
  const slugBase = title.toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'article';
  const slug = slugBase + '-' + Date.now();

  const article = {
    id: db.nextId++,
    title,
    slug,
    excerpt: excerpt || title,
    content: content.startsWith('<') ? content : content
      .split(/\n\s*\n/)
      .filter(p => p.trim())
      .map(p => `<p>${p.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`)
      .join(''),
    coverImageUrl: coverImageUrl || '',
    publishedAt: new Date().toISOString(),
    viewCount: 0,
    category: category || '澳門',
    author: req.user.nickname || '管理員'
  };

  db.articles.unshift(article);
  writeDB(db);

  res.status(201).json({ success: true, article });
});

/**
 * 更新新聞（管理員）
 * PUT /api/news/:id
 */
app.put('/api/news/:id', authMiddleware, adminMiddleware, (req, res) => {
  const db = readDB();
  const article = db.articles.find(a => a.id === parseInt(req.params.id));
  if (!article) {
    return res.status(404).json({ error: '文章不存在' });
  }

  const { title, content, excerpt, category, coverImageUrl } = req.body;
  if (title) article.title = title;
  if (content) article.content = content;
  if (excerpt) article.excerpt = excerpt;
  if (category) article.category = category;
  if (coverImageUrl !== undefined) article.coverImageUrl = coverImageUrl;

  writeDB(db);
  res.json({ success: true, article });
});

/**
 * 刪除新聞（管理員）
 * DELETE /api/news/:id
 */
app.delete('/api/news/:id', authMiddleware, adminMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.articles.findIndex(a => a.id === parseInt(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: '文章不存在' });
  }
  db.articles.splice(idx, 1);
  writeDB(db);
  res.json({ success: true });
});

// ============ 圖片上傳 API ============

/**
 * 上傳圖片（管理員）
 * POST /api/upload/image
 * 返回圖片的公開 URL
 */
app.post('/api/upload/image', authMiddleware, adminMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未選擇圖片' });
  }

  // 構建公開 URL
  const protocol = req.protocol;
  const host = req.get('host');
  const imageUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

  res.json({
    success: true,
    url: imageUrl,
    filename: req.file.filename,
    size: req.file.size
  });
});

// ============ 靜態文件託管 ============

// 上傳的圖片
app.use('/uploads', express.static(uploadsDir));

// 前端靜態文件
app.use(express.static(__dirname));

// SPA 路由回退
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ 啟動伺服器 ============

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  澳門最新聞伺服器已啟動`);
  console.log(`  端口: ${PORT}`);
  console.log(`  模式: 郵箱認證`);
  console.log(`  管理員電郵: ${ADMIN_EMAILS.join(', ') || '（未配置）'}`);
  console.log(`========================================\n`);
});
