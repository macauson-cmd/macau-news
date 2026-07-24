/**
 * 澳門最新聞 - 主應用邏輯
 * 負責頁面路由、新聞列表渲染、搜尋、分類等功能
 */

// 當前頁面狀態
const AppState = {
  currentPage: 1,
  pageSize: 10,
  searchQuery: '',
  activeCategory: 'all',
  currentArticle: null
};

// ============ 後端 API 對接 ============

// API_BASE 由 wechat-login.js 先載入定義，此處直接使用全局變量
// （避免 const 重複聲明導致 SyntaxError）

// 新聞緩存（從後端載入，離線時回退到靜態數據）
let _newsCache = null;
let _trendingCache = null;

/**
 * 從後端載入新聞到緩存
 */
async function refreshNewsCache() {
  try {
    const res = await fetch(`${API_BASE}/api/news?pageSize=200`);
    const data = await res.json();
    if (data.articles && data.articles.length > 0) {
      _newsCache = data.articles;
    }
  } catch (e) {
    console.warn('後端 API 不可用，使用靜態數據:', e);
  }

  try {
    const res = await fetch(`${API_BASE}/api/news/trending`);
    const data = await res.json();
    if (data.articles) {
      _trendingCache = data.articles;
    }
  } catch (e) {
    // 回退到靜態數據
  }
}

/**
 * 獲取當前用戶的 JWT 令牌
 */
function getToken() {
  return localStorage.getItem('auth_token');
}

/**
 * 上傳圖片到後端伺服器
 */
async function uploadImageToServer(file) {
  const formData = new FormData();
  formData.append('image', file);
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/upload/image`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '上傳失敗');
  return data.url;
}

/**
 * 格式化日期
 */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

/**
 * 渲染頂部導航
 */
function renderHeader(active) {
  return `
    <nav class="navbar sticky top-0 z-50">
      <div class="container nav-container">
        <div class="navbar-brand" onclick="goHome()">澳門最新聞</div>
        <div class="nav-actions">
          <a href="#categories" class="navbar-link ${active === 'categories' ? 'active' : ''}" onclick="showCategories(event)">分類</a>
          <a href="#publish" class="navbar-link ${active === 'publish' ? 'active' : ''}" onclick="requireLoginThenPublish(event)">發布</a>
          <button id="login-btn" class="btn-primary text-sm" onclick="openWechatLogin()">登入</button>
        </div>
      </div>
    </nav>
  `;
}

/**
 * 獲取所有新聞（從後端緩存，離線回退到靜態數據）
 */
function getAllNews() {
  const source = _newsCache || NEWS_DATA;
  const all = [...source];
  all.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return all;
}

/**
 * 獲取趨勢新聞（從後端緩存）
 */
function getTrendingNews() {
  if (_trendingCache && _trendingCache.length > 0) {
    return _trendingCache;
  }
  return TRENDING_IDS.map(id => NEWS_DATA.find(n => n.id === id)).filter(Boolean);
}

/**
 * 按分類篩選新聞
 */
function getNewsByCategory(category) {
  if (category === 'all') return getAllNews();
  const catMap = {
    'macau': '澳門',
    'hk-macau': '港澳',
    'cross-strait': '兩岸',
    'international': '國際',
    'military': '軍事'
  };
  const catName = catMap[category] || category;
  return getAllNews().filter(n => n.category === catName);
}

/**
 * 搜尋新聞
 */
function searchNews(query) {
  if (!query || query.trim() === '') return getAllNews();
  const q = query.trim().toLowerCase();
  return getAllNews().filter(n => 
    n.title.toLowerCase().includes(q) || 
    n.excerpt.toLowerCase().includes(q) ||
    n.content.toLowerCase().includes(q)
  );
}

/**
 * 獲取新聞詳情（從緩存讀取 + 後台通知後端增加瀏覽數）
 */
function getArticleBySlug(slug) {
  const source = _newsCache || NEWS_DATA;
  const article = source.find(n => n.slug === slug);
  // 後台通知後端增加瀏覽數
  if (article && API_BASE !== undefined) {
    fetch(`${API_BASE}/api/news/${encodeURIComponent(slug)}`).catch(() => {});
  }
  return article;
}

/**
 * 渲染新聞卡片
 */
function renderNewsCard(article) {
  const hasCover = article.coverImageUrl && article.coverImageUrl.length > 0;
  return `
    <article class="news-card" onclick="navigateToArticle('${article.slug}')">
      ${hasCover ? `
        <div class="news-card-image">
          <img src="${article.coverImageUrl}" alt="${article.title}" loading="lazy" />
        </div>
      ` : ''}
      <div class="news-card-body">
        <div class="news-card-meta">
          <span class="category-badge">${article.category}</span>
          <span class="news-date">${formatDate(article.publishedAt)}</span>
        </div>
        <h3 class="news-card-title">${article.title}</h3>
        <p class="news-card-excerpt">${article.excerpt}</p>
        <div class="news-card-footer">
          <span class="news-views">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            ${article.viewCount} 次瀏覽
          </span>
          <span class="news-read-more">閱讀全文 →</span>
        </div>
      </div>
    </article>
  `;
}

/**
 * 渲染趨勢新聞項
 */
function renderTrendingItem(article, index) {
  return `
    <div class="trending-item" onclick="navigateToArticle('${article.slug}')">
      <span class="trending-rank rank-${index + 1}">${index + 1}</span>
      <div class="trending-content">
        <h4 class="trending-title">${article.title}</h4>
        <div class="trending-meta">
          <span class="category-badge-small">${article.category}</span>
          <span>${formatDate(article.publishedAt)}</span>
          <span>${article.viewCount} 次瀏覽</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * 渲染首頁
 */
function renderHome() {
  const app = document.getElementById('app');
  
  let filteredNews;
  if (AppState.searchQuery) {
    filteredNews = searchNews(AppState.searchQuery);
  } else {
    filteredNews = getNewsByCategory(AppState.activeCategory);
  }
  
  // 分頁
  const totalPages = Math.ceil(filteredNews.length / AppState.pageSize);
  const startIdx = (AppState.currentPage - 1) * AppState.pageSize;
  const pageNews = filteredNews.slice(startIdx, startIdx + AppState.pageSize);
  
  const trending = getTrendingNews();
  
  app.innerHTML = `
    ${renderHeader('home')}

    <section class="hero-section">
      <div class="hero-content">
        <h1 class="hero-title">最新新聞資訊</h1>
        <p class="hero-subtitle">掌握時事動態，瞭解世界變化</p>
        <form class="search-form" onsubmit="handleSearch(event)">
          <div class="search-bar">
            <input type="text" 
                   id="search-input" 
                   placeholder="搜尋新聞標題或內容..." 
                   value="${AppState.searchQuery}"
                   class="search-input" />
            <button type="submit" class="btn-primary search-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
              </svg>
              搜尋
            </button>
          </div>
        </form>
      </div>
    </section>

    <main class="main-content container">
      ${AppState.searchQuery ? `
        <div class="search-results-info">
          <h2 class="section-title">搜尋結果</h2>
          <p class="search-count">找到 ${filteredNews.length} 篇相關新聞</p>
          <button class="btn-text" onclick="clearSearch()">清除搜尋 ✕</button>
        </div>
      ` : ''}

      <!-- 分類篩選 -->
      <div class="category-tabs">
        ${CATEGORIES.map(cat => `
          <button class="category-tab ${AppState.activeCategory === cat.slug ? 'active' : ''}" 
                  onclick="selectCategory('${cat.slug}')">
            ${cat.name}
          </button>
        `).join('')}
      </div>

      <div class="content-layout">
        <!-- 左側：新聞列表 -->
        <div class="news-main">
          <section class="news-section">
            <h2 class="section-title">${AppState.activeCategory === 'all' ? '最新報導' : CATEGORIES.find(c => c.slug === AppState.activeCategory)?.name + '新聞'}</h2>
            ${pageNews.length > 0 ? `
              <div class="news-grid">
                ${pageNews.map(renderNewsCard).join('')}
              </div>
              ${totalPages > 1 ? renderPagination(totalPages) : ''}
            ` : `
              <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <p>暫無相關新聞</p>
              </div>
            `}
          </section>

          <section class="news-section">
            <div class="view-all-section">
              <h2 class="section-title">查看所有新聞</h2>
              <button class="btn-primary" onclick="selectAllNews()">瀏覽新聞列表</button>
            </div>
          </section>
        </div>

        <!-- 右側：趨勢新聞 -->
        <aside class="news-sidebar">
          <div class="sidebar-card">
            <h3 class="sidebar-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 6l-9.5 9.5-5-5L1 18"/>
                <path d="M17 6h6v6"/>
              </svg>
              熱門新聞
            </h3>
            <div class="trending-list">
              ${trending.map((article, i) => renderTrendingItem(article, i)).join('')}
            </div>
          </div>

          <div class="sidebar-card sidebar-about">
            <h3 class="sidebar-title">關於我們</h3>
            <p>澳門最新聞是一個專注於澳門及周邊地區新聞資訊的平台，提供及時、準確、全面的新聞報導。</p>
            <div class="sidebar-stats">
              <div class="stat-item">
                <span class="stat-num">${NEWS_DATA.length}</span>
                <span class="stat-label">新聞文章</span>
              </div>
              <div class="stat-item">
                <span class="stat-num">${CATEGORIES.length - 1}</span>
                <span class="stat-label">新聞分類</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>

    <footer class="site-footer">
      <div class="container">
        <p>© 2026 澳門最新聞。版權所有。</p>
        <p class="footer-sub">優雅精緻的新聞發布與管理系統</p>
        <p class="footer-deploy">部署於騰訊雲 · 支援電郵登入</p>
      </div>
    </footer>
  `;
  
  // 初始化登入狀態
  initWechatLogin();
  window.scrollTo(0, 0);
}

/**
 * 渲染分頁
 */
function renderPagination(totalPages) {
  let html = '<div class="pagination">';
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="pagination-btn ${i === AppState.currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }
  html += '</div>';
  return html;
}

/**
 * 渲染文章詳情頁
 */
function renderArticle(slug) {
  const article = getArticleBySlug(slug);
  
  if (!article) {
    renderNotFound();
    return;
  }
  
  AppState.currentArticle = article;
  
  // 增加瀏覽數
  article.viewCount++;
  
  // 獲取相關新聞（同分類的其他文章）
  const related = getAllNews()
    .filter(n => n.category === article.category && n.id !== article.id)
    .slice(0, 4);
  
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderHeader('home')}

    <article class="article-page">
      <div class="container article-container">
        <div class="article-breadcrumb">
          <a href="#" onclick="goHome()">首頁</a>
          <span>›</span>
          <span>${article.category}</span>
          <span>›</span>
          <span class="breadcrumb-current">${article.title.substring(0, 20)}...</span>
        </div>

        <div class="article-header">
          <span class="category-badge">${article.category}</span>
          <h1 class="article-title">${article.title}</h1>
          <div class="article-meta">
            <span class="article-date">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              ${formatDate(article.publishedAt)}
            </span>
            <span class="article-views">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              ${article.viewCount} 次瀏覽
            </span>
          </div>
        </div>

        <div class="article-excerpt">${article.excerpt}</div>

        ${article.coverImageUrl ? `
          <div class="article-cover">
            <img src="${article.coverImageUrl}" alt="${article.title}" />
          </div>
        ` : ''}

        <div class="article-content">
          ${article.content}
        </div>

        <div class="article-footer">
          <button class="btn-primary-outline" onclick="goHome()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5"/>
              <path d="M12 19l-7-7 7-7"/>
            </svg>
            返回首頁
          </button>
          <button class="btn-primary" onclick="shareArticle()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="5" r="3"/>
              <circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            分享文章
          </button>
        </div>

        ${related.length > 0 ? `
          <section class="related-section">
            <h2 class="section-title">相關新聞</h2>
            <div class="news-grid">
              ${related.map(renderNewsCard).join('')}
            </div>
          </section>
        ` : ''}
      </div>
    </article>

    <footer class="site-footer">
      <div class="container">
        <p>© 2026 澳門最新聞。版權所有。</p>
        <p class="footer-sub">優雅精緻的新聞發布與管理系統</p>
        <p class="footer-deploy">部署於騰訊雲 · 支援電郵登入</p>
      </div>
    </footer>
  `;
  
  initWechatLogin();
  window.scrollTo(0, 0);
}

/**
 * 渲染分類頁面
 */
function renderCategoriesPage() {
  const app = document.getElementById('app');
  
  app.innerHTML = `
    ${renderHeader('categories')}

    <section class="hero-section hero-small">
      <div class="hero-content">
        <h1 class="hero-title">新聞分類</h1>
        <p class="hero-subtitle">按分類瀏覽新聞</p>
      </div>
    </section>

    <main class="main-content container">
      ${CATEGORIES.filter(c => c.slug !== 'all').map(cat => {
        const catName = { 'macau': '澳門', 'hk-macau': '港澳', 'cross-strait': '兩岸', 'international': '國際', 'military': '軍事' }[cat.slug] || cat.name;
        const articles = getNewsByCategory(cat.slug);
        return `
          <div class="category-block">
            <h2 class="section-title">${catName} <span class="category-count">(${articles.length})</span></h2>
            ${articles.length > 0 ? `
              <div class="news-grid">
                ${articles.slice(0, 4).map(renderNewsCard).join('')}
              </div>
              ${articles.length > 4 ? `
                <button class="btn-primary-outline category-more-btn" onclick="selectCategory('${cat.slug}')">
                  查看更多 ${catName} 新聞 →
                </button>
              ` : ''}
            ` : `
              <p class="empty-text">暫無${catName}新聞</p>
            `}
          </div>
        `;
      }).join('')}
    </main>

    <footer class="site-footer">
      <div class="container">
        <p>© 2026 澳門最新聞。版權所有。</p>
        <p class="footer-sub">優雅精緻的新聞發布與管理系統</p>
        <p class="footer-deploy">部署於騰訊雲 · 支援電郵登入</p>
      </div>
    </footer>
  `;
  
  initWechatLogin();
  window.scrollTo(0, 0);
}

/**
 * HTML 轉義
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 生成 URL slug
 */
function slugify(title) {
  return title.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'article';
}

/**
 * 將純文字正文轉為帶段落的 HTML
 */
function formatContent(text) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  if (paragraphs.length === 0) return `<p>${escapeHtml(text)}</p>`;
  return paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/**
 * 驗證圖片檔案
 */
function validateImageFile(file) {
  if (!file) return false;
  if (file.size > 5 * 1024 * 1024) {
    showToast('圖片過大，請選擇小於 5MB 的圖片');
    return false;
  }
  if (!file.type.startsWith('image/')) {
    showToast('請選擇圖片檔案');
    return false;
  }
  return true;
}

/**
 * 更新上傳預覽與連結
 */
function updateUploadPreview(prefix, imageUrl) {
  const box = document.getElementById(prefix + '-preview-box');
  const img = document.getElementById(prefix + '-preview-img');
  const input = document.getElementById(prefix + '-link-input');
  if (box && img && input) {
    img.src = imageUrl;
    input.value = imageUrl;
    box.style.display = 'block';
  }
}

/**
 * 顯示上傳中狀態
 */
function showUploadingState(prefix) {
  const box = document.getElementById(prefix + '-preview-box');
  if (box) {
    box.style.display = 'block';
    const img = document.getElementById(prefix + '-preview-img');
    if (img) {
      img.src = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">' +
        '<rect width="200" height="150" fill="#f0f0f0"/>' +
        '<text x="100" y="80" font-size="14" text-anchor="middle" fill="#999">上傳中...</text>' +
        '</svg>'
      );
    }
  }
}

/**
 * 圖片上傳工具回調（上傳到後端伺服器）
 */
async function handlePublishImageUpload(file) {
  if (!validateImageFile(file)) return;
  showUploadingState('upload');
  try {
    const url = await uploadImageToServer(file);
    window.publishImageLink = url;
    updateUploadPreview('upload', url);
    showToast('圖片上傳成功，可複製連結使用');
  } catch (err) {
    console.error('Upload error:', err);
    showToast('圖片上傳失敗：' + err.message);
    document.getElementById('upload-preview-box').style.display = 'none';
  }
}

/**
 * 封面圖片上傳回調（上傳到後端伺服器）
 */
async function handlePublishCoverUpload(file) {
  if (!validateImageFile(file)) return;
  showUploadingState('cover');
  try {
    const url = await uploadImageToServer(file);
    window.publishCoverImage = url;
    updateUploadPreview('cover', url);
    showToast('封面圖片上傳成功');
  } catch (err) {
    console.error('Upload error:', err);
    showToast('封面圖片上傳失敗：' + err.message);
    document.getElementById('cover-preview-box').style.display = 'none';
  }
}

/**
 * 複製圖片連結
 */
function copyImageLink(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.select();
  try {
    document.execCommand('copy');
    showToast('圖片連結已複製');
  } catch (err) {
    navigator.clipboard.writeText(input.value).then(() => showToast('圖片連結已複製'));
  }
}

/**
 * 提交新聞發布（發送到後端 API）
 */
async function submitPublishArticle(e) {
  e.preventDefault();
  const title = document.getElementById('pub-title').value.trim();
  const category = document.getElementById('pub-category').value;
  const excerpt = document.getElementById('pub-excerpt').value.trim();
  const contentText = document.getElementById('pub-content').value.trim();

  if (!title || !contentText) {
    showToast('請填寫標題和正文');
    return;
  }

  // 禁用提交按鈕
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '發布中...';
  }

  try {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/news`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        title,
        excerpt: excerpt || title,
        content: contentText,
        category,
        coverImageUrl: window.publishCoverImage || ''
      })
    });
    const data = await res.json();

    if (data.success) {
      // 重新載入緩存
      await refreshNewsCache();
      window.publishCoverImage = '';
      window.publishImageLink = '';
      showToast('新聞發布成功！');
      window.location.hash = 'article/' + data.article.slug;
    } else {
      showToast('發布失敗：' + (data.error || '未知錯誤'));
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '發布新聞';
      }
    }
  } catch (err) {
    console.error('Publish error:', err);
    showToast('發布失敗，請確認伺服器已啟動');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '發布新聞';
    }
  }
}

/**
 * 前往發布頁面（需管理員登入）
 */
function requireLoginThenPublish(e) {
  if (e) e.preventDefault();
  const user = getWechatUser();
  if (user && user.isAdmin) {
    window.location.hash = 'publish';
  } else if (user && !user.isAdmin) {
    showToast('您沒有管理員權限發布新聞');
  } else {
    window.onWechatLoginSuccess = () => {
      window.onWechatLoginSuccess = null;
      const u = getWechatUser();
      if (u && u.isAdmin) {
        window.location.hash = 'publish';
      } else {
        showToast('您沒有管理員權限發布新聞');
      }
    };
    openWechatLogin();
  }
}

/**
 * 渲染發布頁面
 */
function renderPublish() {
  const app = document.getElementById('app');
  const user = getWechatUser();

  const publishForm = `
    <div class="publish-card">
      <h1 class="publish-title">發布新聞</h1>
      <p class="publish-subtitle">直接上傳圖片，系統會自動生成圖片連結。</p>

      <section class="upload-section">
        <h2 class="section-title" style="font-size:1.25rem;margin-bottom:1rem;">圖片上傳工具</h2>
        <div class="form-group">
          <label class="form-label">上傳圖片並取得連結</label>
          <div class="upload-zone" onclick="document.getElementById('pub-image-file').click()">
            <input type="file" id="pub-image-file" class="upload-input" accept="image/*" onchange="handlePublishImageUpload(this.files[0])" />
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-gray-400)" stroke-width="1.5" style="margin-bottom:.5rem;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p>點擊選擇圖片上傳</p>
            <p class="form-hint">支援 JPG、PNG、GIF，建議小於 2MB</p>
          </div>
          <div id="upload-preview-box" style="display:none;">
            <div class="upload-preview"><img id="upload-preview-img" src="" alt="預覽" /></div>
            <div class="upload-link-box">
              <input type="text" id="upload-link-input" class="upload-link-input" readonly />
              <button type="button" class="btn-primary" onclick="copyImageLink('upload-link-input')">複製連結</button>
            </div>
          </div>
        </div>
      </section>

      <hr style="border:none;border-top:1px solid var(--border);margin:2rem 0;">

      <form onsubmit="submitPublishArticle(event)">
        <div class="form-group">
          <label class="form-label" for="pub-title">標題 *</label>
          <input type="text" id="pub-title" class="form-input" placeholder="輸入新聞標題" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="pub-category">分類 *</label>
          <select id="pub-category" class="form-select" required>
            ${CATEGORIES.filter(c => c.slug !== 'all').map(c => `<option value="${c.name}">${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="pub-excerpt">摘要</label>
          <textarea id="pub-excerpt" class="form-textarea" rows="3" placeholder="簡短描述新聞內容（選填）"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">封面圖片（直接上傳）</label>
          <div class="upload-zone" onclick="document.getElementById('pub-cover-file').click()">
            <input type="file" id="pub-cover-file" class="upload-input" accept="image/*" onchange="handlePublishCoverUpload(this.files[0])" />
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-gray-400)" stroke-width="1.5" style="margin-bottom:.5rem;">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <p>點擊選擇封面圖片</p>
            <p class="form-hint">上傳後會生成圖片連結，可直接用於本文封面</p>
          </div>
          <div id="cover-preview-box" style="display:none;">
            <div class="upload-preview"><img id="cover-preview-img" src="" alt="封面預覽" /></div>
            <div class="upload-link-box">
              <input type="text" id="cover-link-input" class="upload-link-input" readonly />
              <button type="button" class="btn-primary" onclick="copyImageLink('cover-link-input')">複製連結</button>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="pub-content">正文 *</label>
          <textarea id="pub-content" class="form-textarea" rows="12" placeholder="輸入新聞正文..." required></textarea>
          <p class="form-hint">可用空行分隔段落</p>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-primary-outline" onclick="goHome()">取消</button>
          <button type="submit" class="btn-primary">發布新聞</button>
        </div>
      </form>
    </div>
  `;

  const loginPrompt = `
    <div class="publish-card" style="text-align:center;padding:4rem 2rem;">
      <h1 class="publish-title">請先登入</h1>
      <p style="margin:1rem 0 2rem;color:var(--color-gray-600);">發布新聞需要管理員登入。</p>
      <button class="btn-primary" onclick="requireLoginThenPublish()">管理員登入</button>
    </div>
  `;

  const noPermission = `
    <div class="publish-card" style="text-align:center;padding:4rem 2rem;">
      <h1 class="publish-title">權限不足</h1>
      <p style="margin:1rem 0 2rem;color:var(--color-gray-600);">您沒有管理員權限發布新聞。</p>
      <button class="btn-primary-outline" onclick="goHome()">返回首頁</button>
    </div>
  `;

  app.innerHTML = `
    ${renderHeader('publish')}
    <div class="publish-page">
      <div class="container publish-container">
        ${(!user) ? loginPrompt : (user.isAdmin ? publishForm : noPermission)}
      </div>
    </div>
    <footer class="site-footer">
      <div class="container">
        <p>© 2026 澳門最新聞。版權所有。</p>
        <p class="footer-sub">優雅精緻的新聞發布與管理系統</p>
        <p class="footer-deploy">部署於騰訊雲 · 支援電郵登入與圖片上傳</p>
      </div>
    </footer>
  `;

  initWechatLogin();
  window.scrollTo(0, 0);
}

/**
 * 渲染404頁面
 */
function renderNotFound() {
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderHeader('')}
    <div class="not-found">
      <h1>404</h1>
      <p>頁面未找到</p>
      <button class="btn-primary" onclick="goHome()">返回首頁</button>
    </div>
    <footer class="site-footer">
      <div class="container">
        <p>© 2026 澳門最新聞。版權所有。</p>
      </div>
    </footer>
  `;
  initWechatLogin();
}

// ============ 路由 ============

function router() {
  const hash = window.location.hash.slice(1) || '/';
  const parts = hash.split('/');
  
  if (parts[0] === '' || parts[0] === '/') {
    renderHome();
  } else if (parts[0] === 'categories') {
    renderCategoriesPage();
  } else if (parts[0] === 'article' && parts[1]) {
    renderArticle(parts[1]);
  } else if (parts[0] === 'publish') {
    renderPublish();
  } else {
    renderNotFound();
  }
}

// ============ 事件處理 ============

function navigateToArticle(slug) {
  window.location.hash = `article/${slug}`;
}

function goHome() {
  if (event) event.preventDefault();
  AppState.currentPage = 1;
  AppState.searchQuery = '';
  AppState.activeCategory = 'all';
  window.location.hash = '';
  router();
}

function showCategories(e) {
  e.preventDefault();
  window.location.hash = 'categories';
}

function handleSearch(e) {
  e.preventDefault();
  const input = document.getElementById('search-input');
  AppState.searchQuery = input.value;
  AppState.currentPage = 1;
  renderHome();
}

function clearSearch() {
  AppState.searchQuery = '';
  AppState.currentPage = 1;
  renderHome();
}

function selectCategory(category) {
  AppState.activeCategory = category;
  AppState.currentPage = 1;
  AppState.searchQuery = '';
  renderHome();
}

function selectAllNews() {
  AppState.activeCategory = 'all';
  AppState.currentPage = 1;
  renderHome();
}

function goToPage(page) {
  AppState.currentPage = page;
  renderHome();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function shareArticle() {
  if (navigator.share) {
    navigator.share({
      title: AppState.currentArticle?.title || '澳門最新聞',
      url: window.location.href
    });
  } else {
    navigator.clipboard.writeText(window.location.href);
    showToast('連結已複製到剪貼簿');
  }
}

// ============ 初始化 ============

window.addEventListener('hashchange', router);

window.addEventListener('DOMContentLoaded', () => {
  // 先用靜態數據渲染頁面（立即顯示內容）
  router();

  // 然後異步從後端載入數據並更新
  (async () => {
    await refreshNewsCache();
    await initWechatLogin();
    // 用後端數據重新渲染當前頁面
    router();
  })();
});
