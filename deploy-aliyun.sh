#!/bin/bash
# ============================================================
# 澳門最新聞 - 阿里雲輕量應用服務器一鍵部署腳本
# 適用系統: Ubuntu 22.04 / 20.04
# ============================================================

set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "============================================"
echo "  澳門最新聞 - 阿里雲部署腳本"
echo "============================================"
echo -e "${NC}"

# 確認 root 權限
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}請使用 root 用戶運行此腳本${NC}"
  echo "請輸入: sudo -s 然後重新運行"
  exit 1
fi

APP_DIR="/opt/macau-news"
RAW_URL="https://raw.githubusercontent.com/macauson-cmd/macau-news/main/server.js"

# ===========================================
# 第 1 步：安裝 Node.js 22 LTS
# ===========================================
echo -e "${YELLOW}[1/8] 安裝 Node.js 22 LTS...${NC}"

if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}  Node.js 已安裝: ${NODE_VERSION}${NC}"

# ===========================================
# 第 2 步：安裝 PM2 進程管理器
# ===========================================
echo -e "${YELLOW}[2/8] 安裝 PM2 進程管理器...${NC}"
npm install -g pm2
echo -e "${GREEN}  PM2 已安裝${NC}"

# ===========================================
# 第 3 步：安裝 Nginx 反向代理
# ===========================================
echo -e "${YELLOW}[3/8] 安裝 Nginx...${NC}"
apt-get update -qq
apt-get install -y nginx
echo -e "${GREEN}  Nginx 已安裝${NC}"

# ===========================================
# 第 4 步：下載 server.js
# ===========================================
echo -e "${YELLOW}[4/8] 下載 server.js...${NC}"
mkdir -p ${APP_DIR}

# 嘗試從 GitHub 下載
if curl -fsSL -o ${APP_DIR}/server.js ${RAW_URL}; then
  FILE_SIZE=$(wc -c < ${APP_DIR}/server.js)
  echo -e "${GREEN}  server.js 已下載 (${FILE_SIZE} bytes)${NC}"
else
  echo -e "${RED}  從 GitHub 下載失敗，請檢查網絡連接${NC}"
  exit 1
fi

# 驗證文件內容
if ! grep -q "app.listen" ${APP_DIR}/server.js; then
  echo -e "${RED}  server.js 文件不完整，下載失敗${NC}"
  exit 1
fi
echo -e "${GREEN}  文件完整性驗證通過${NC}"

# ===========================================
# 第 4.5 步：安裝 npm 依賴
# ===========================================
echo -e "${YELLOW}[4.5/8] 安裝 npm 依賴...${NC}"

# 創建 package.json
cat > ${APP_DIR}/package.json << 'PKGJSON'
{
  "name": "macau-news",
  "version": "1.0.0",
  "type": "commonjs",
  "dependencies": {
    "express": "^4.21.0",
    "multer": "^1.4.5-lts.1",
    "jsonwebtoken": "^9.0.2",
    "cors": "^2.8.5"
  }
}
PKGJSON

cd ${APP_DIR}
npm install --production 2>&1 | tail -5
echo -e "${GREEN}  npm 依賴已安裝${NC}"

# 驗證 Express 版本為 4.x（Express 5 不支援 '*' 路由）
EXPR_VER=$(node -e "console.log(require('express/package.json').version)" 2>/dev/null)
if [[ "${EXPR_VER}" == 5* ]]; then
  echo -e "${YELLOW}  偵測到 Express 5，降級到 Express 4...${NC}"
  npm install express@4 --save 2>&1 | tail -3
fi
echo -e "${GREEN}  Express 版本: ${EXPR_VER}${NC}"

# ===========================================
# 第 5 步：配置 PM2 啟動應用
# ===========================================
echo -e "${YELLOW}[5/8] 配置 PM2...${NC}"

# 創建 PM2 生態配置文件
cat > ${APP_DIR}/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'macau-news',
    script: 'server.js',
    cwd: '/opt/macau-news',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: '/var/log/macau-news-error.log',
    out_file: '/var/log/macau-news-out.log',
    merge_logs: true
  }]
};
EOF

# 啟動應用
cd ${APP_DIR}
pm2 delete macau-news 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
echo -e "${GREEN}  應用已啟動 (端口 3001)${NC}"

# ===========================================
# 第 6 步：配置 Nginx 反向代理
# ===========================================
echo -e "${YELLOW}[6/8] 配置 Nginx 反向代理...${NC}"

# 移除默認配置
rm -f /etc/nginx/sites-enabled/default

# 創建反向代理配置
cat > /etc/nginx/sites-available/macau-news << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # 反向代理到 Node.js 應用
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # 靜態文件緩存
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://127.0.0.1:3001;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # 上傳文件大小限制
    client_max_body_size 20M;

    # Gzip 壓縮
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
    gzip_min_length 1000;
}
EOF

# 啟用配置
ln -sf /etc/nginx/sites-available/macau-news /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
systemctl enable nginx
echo -e "${GREEN}  Nginx 反向代理已配置 (端口 80 -> 3001)${NC}"

# ===========================================
# 第 7 步：設置開機自啟
# ===========================================
echo -e "${YELLOW}[7/8] 設置開機自啟...${NC}"

# PM2 開機自啟
pm2 startup systemd -u root --hp /root 2>/dev/null || true
pm2 save

# Nginx 開機自啟
systemctl enable nginx

echo -e "${GREEN}  開機自啟已配置${NC}"

# ===========================================
# 第 8 步：配置防火牆
# ===========================================
echo -e "${YELLOW}[8/8] 配置防火牆...${NC}"

if command -v ufw &> /dev/null; then
  ufw allow 80/tcp 2>/dev/null || true
  ufw allow 443/tcp 2>/dev/null || true
  ufw allow 22/tcp 2>/dev/null || true
  echo -e "${GREEN}  UFW 防火牆已配置${NC}"
else
  echo -e "${YELLOW}  UFW 未安裝，請在阿里雲控制台開放端口 80${NC}"
fi

# ===========================================
# 完成！顯示結果
# ===========================================
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}  部署完成！${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "  服務器 IP: ${YELLOW}${SERVER_IP}${NC}"
echo -e "  訪問地址: ${GREEN}http://${SERVER_IP}${NC}"
echo ""
echo -e "  ${YELLOW}請確保阿里雲控制台已開放端口 80${NC}"
echo -e "  路徑: 輕量應用服務器 > 服務器詳情 > 防火牆 > 添加規則"
echo -e "  端口範圍: 80/80  協議: TCP"
echo ""
echo -e "  管理命令:"
echo -e "    ${CYAN}pm2 status${NC}          查看應用狀態"
echo -e "    ${CYAN}pm2 logs macau-news${NC}  查看日誌"
echo -e "    ${CYAN}pm2 restart macau-news${NC}  重啟應用"
echo -e "    ${CYAN}systemctl status nginx${NC}  查看 Nginx"
echo ""
echo -e "${GREEN}  網站已上線！${NC}"
echo ""
