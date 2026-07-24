/**
 * 登入模組 v3 — 郵箱認證版
 *
 * 流程：用戶輸入管理員電郵 → POST /api/auth/login → 後端驗證並返回 JWT → 存入 localStorage
 *
 * 所有需認證的 API 請求在 Header 中帶上 Authorization: Bearer <token>
 */

const API_BASE = (window.API_CONFIG && window.API_CONFIG.baseUrl) || '';

// ============ JWT 令牌管理 ============

function getToken() {
  return localStorage.getItem('auth_token');
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('auth_user') || 'null');
  } catch (e) {
    return null;
  }
}

function setAuth(token, user) {
  localStorage.setItem('auth_token', token);
  localStorage.setItem('auth_user', JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
  localStorage.removeItem('wechat_user');
}

function isLoggedIn() {
  return !!getToken();
}

function isAdmin() {
  const user = getStoredUser();
  return !!(user && user.isAdmin);
}

// ============ 初始化（保持函數名兼容 app.js） ============

async function initWechatLogin() {
  // 檢查 URL 中是否有 JWT token（兼容舊的回調流程）
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  if (token) {
    await handleTokenFromCallback(token);
    return;
  }

  // 檢查登入狀態
  await checkLoginStatus();
}

// ============ 處理 URL 帶回的 token ============

async function handleTokenFromCallback(token) {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setAuth(token, data.user);
      updateLoginUI(data.user);
      showToast('登入成功！');
      notifyLoginSuccess(data.user);
    } else {
      showToast('登入驗證失敗，請重試');
    }
  } catch (e) {
    showToast('網絡錯誤，請重試');
  }
  // 清除 URL 中的 token 參數
  const url = new URL(window.location.href);
  url.searchParams.delete('token');
  window.history.replaceState({}, document.title, url.toString());
}

// ============ 打開登入彈窗（保持函數名兼容 app.js） ============

function openWechatLogin() {
  showLoginModal();
}

// ============ 郵箱登入彈窗 ============

function showLoginModal() {
  // 如果已有登入彈窗，先移除
  closeWechatLogin();

  const overlay = document.createElement('div');
  overlay.id = 'wechat-login-overlay';
  overlay.className = 'wechat-overlay';

  overlay.innerHTML = `
    <div class="wechat-modal" style="max-width:380px;">
      <div class="wechat-modal-header">
        <div class="wechat-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
        </div>
        <h3>管理員登入</h3>
        <button class="wechat-close-btn" onclick="closeWechatLogin()">&times;</button>
      </div>
      <div class="wechat-modal-body" style="padding:2rem 1.5rem 1.5rem;">
        <div style="text-align:left;">
          <label style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:8px;">電郵地址</label>
          <input
            type="email"
            id="login-email-input"
            placeholder="輸入管理員電郵"
            value="macauson@gmail.com"
            style="width:100%;padding:12px 14px;font-size:16px;border:2px solid #d1d5db;border-radius:8px;outline:none;transition:border-color .2s;box-sizing:border-box;"
            onfocus="this.style.borderColor='#2563eb'"
            onblur="this.style.borderColor='#d1d5db'"
            onkeydown="if(event.key==='Enter')doEmailLogin()"
          />
          <button
            onclick="doEmailLogin()"
            style="width:100%;margin-top:16px;padding:12px;font-size:16px;font-weight:600;color:white;background:#2563eb;border:none;border-radius:8px;cursor:pointer;transition:background .2s;"
            onmouseover="this.style.background='#1d4ed8'"
            onmouseout="this.style.background='#2563eb'"
          >
            登入
          </button>
          <div id="login-error-msg" style="display:none;margin-top:12px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:14px;color:#dc2626;text-align:center;"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // 點擊遮罩關閉
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeWechatLogin();
  });

  // 自動選中輸入框（方便修改）
  const input = document.getElementById('login-email-input');
  if (input) {
    input.focus();
    input.select();
  }
}

// ============ 執行郵箱登入 ============

async function doEmailLogin() {
  const input = document.getElementById('login-email-input');
  const errorDiv = document.getElementById('login-error-msg');
  if (!input) return;

  const email = input.value.trim();
  if (!email) {
    if (errorDiv) {
      errorDiv.textContent = '請輸入電郵地址';
      errorDiv.style.display = 'block';
    }
    return;
  }

  // 禁用輸入和按鈕，顯示載入中
  input.disabled = true;
  const btn = input.parentElement.querySelector('button');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '登入中...';
    btn.style.opacity = '0.7';
  }
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (res.ok && data.token && data.user) {
      setAuth(data.token, data.user);
      closeWechatLogin();
      updateLoginUI(data.user);
      notifyLoginSuccess(data.user);
      showToast('登入成功！');
    } else {
      // 顯示錯誤消息
      const errorMsg = data.error || '登入失敗，請重試';
      if (errorDiv) {
        errorDiv.textContent = errorMsg;
        errorDiv.style.display = 'block';
      }
      // 恢復輸入和按鈕
      input.disabled = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '登入';
        btn.style.opacity = '1';
      }
      input.focus();
    }
  } catch (err) {
    // 後端不可用
    const errorMsg = '無法連接伺服器，請確認網絡連接';
    if (errorDiv) {
      errorDiv.textContent = errorMsg;
      errorDiv.style.display = 'block';
    }
    input.disabled = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '登入';
      btn.style.opacity = '1';
    }
  }
}

// ============ 關閉彈窗 ============

function closeWechatLogin() {
  const overlay = document.getElementById('wechat-login-overlay');
  if (overlay) overlay.remove();
}

// ============ 登入成功回調 ============

function notifyLoginSuccess(user) {
  if (typeof window.onWechatLoginSuccess === 'function') {
    try {
      window.onWechatLoginSuccess(user);
    } catch (e) {
      console.error('登入回調錯誤：', e);
    }
  }
}

// ============ 獲取已登入用戶（保持函數名兼容 app.js） ============

function getWechatUser() {
  return getStoredUser();
}

// ============ 檢查登入狀態（向後端驗證 JWT） ============

async function checkLoginStatus() {
  const token = getToken();
  const user = getStoredUser();

  if (!token || !user) {
    updateLoginUI(null);
    return;
  }

  // 向後端驗證令牌是否仍然有效
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('auth_user', JSON.stringify(data.user));
      updateLoginUI(data.user);
    } else {
      clearAuth();
      updateLoginUI(null);
    }
  } catch (e) {
    // 後端不可用，使用本地存儲的用戶信息
    updateLoginUI(user);
  }
}

// ============ 更新登入 UI ============

function updateLoginUI(user) {
  const loginBtn = document.getElementById('login-btn');
  if (!loginBtn) return;

  if (user) {
    const adminBadge = user.isAdmin ? '<span class="admin-badge">管理員</span>' : '';
    const displayName = user.nickname || user.email || '已登入';
    const avatar = user.avatar || '';
    loginBtn.innerHTML = `
      <div class="user-info">
        <img src="${avatar}" alt="${displayName}" class="user-avatar" />
        <span class="user-name">${displayName}</span>
        ${adminBadge}
        <button class="logout-btn" onclick="logoutWechat()" title="登出">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    `;
    loginBtn.onclick = null;
    loginBtn.classList.add('logged-in');
  } else {
    loginBtn.innerHTML = '登入';
    loginBtn.onclick = openWechatLogin;
    loginBtn.classList.remove('logged-in');
  }
}

// ============ 登出（保持函數名兼容 app.js） ============

function logoutWechat() {
  clearAuth();
  updateLoginUI(null);
  showToast('已登出');
  if (window.location.hash === '#publish') {
    window.location.hash = '';
  }
}

// ============ 提示消息 ============

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
