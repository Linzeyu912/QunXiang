#!/bin/bash
# ============================================================
# 一键部署脚本（Linux / Ubuntu）
# 用法：在项目根目录执行 bash deploy.sh
# 前提：已装 Docker + Docker Compose 插件
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"
echo "=== 群像 部署脚本 ==="

COMPOSE="docker compose --env-file .env.docker -f docker-compose.prod.yml"

# ── 1. 检查 Docker ──
if ! command -v docker &>/dev/null; then
    echo "错误：未安装 Docker。请先安装："
    echo "  curl -fsSL https://get.docker.com | sh"
    echo "  sudo usermod -aG docker \$USER"
    echo "  重新登录后再次运行此脚本"
    exit 1
fi

if ! docker compose version &>/dev/null; then
    echo "错误：未安装 Docker Compose 插件。"
    echo "  Ubuntu: apt install docker-compose-plugin"
    exit 1
fi

# ── 2. 数据库密码 ──
SECRET_FILE=".db-password"
if [ ! -f "$SECRET_FILE" ]; then
    PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
    echo "$PG_PASS" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "PostgreSQL 密码已生成并保存到 $SECRET_FILE"
else
    echo "使用已保存的 PostgreSQL 密码"
fi
export POSTGRES_PASSWORD=$(cat "$SECRET_FILE")

# 生成 .env.docker（compose 自动读取的变量文件）
echo "POSTGRES_PASSWORD=$(cat "$SECRET_FILE")" > .env.docker
chmod 600 .env.docker

# ── 3. 首次部署：生成密钥 ──
ENV_FILE="api/.env.production"
if grep -q "REPLACE_WITH_RANDOM_64_CHARS" "$ENV_FILE"; then
    echo "首次部署，生成随机密钥..."
    JWT=$(openssl rand -hex 32)
    SIGN=$(openssl rand -hex 32)
    VAULT=$(openssl rand -hex 32)

    sed -i "s/JWT_SECRET=REPLACE_WITH_RANDOM_64_CHARS/JWT_SECRET=$JWT/" "$ENV_FILE"
    sed -i "s/OBJECT_STORAGE_SIGN_SECRET=REPLACE_WITH_RANDOM_64_CHARS/OBJECT_STORAGE_SIGN_SECRET=$SIGN/" "$ENV_FILE"
    sed -i "s/KEY_VAULTS_SECRET=REPLACE_WITH_RANDOM_64_CHARS/KEY_VAULTS_SECRET=$VAULT/" "$ENV_FILE"

    echo "  JWT_SECRET 已生成"
    echo "  OBJECT_STORAGE_SIGN_SECRET 已生成"
    echo "  KEY_VAULTS_SECRET 已生成（请备份！）"
fi

# ── 4. 设置 CORS ──
SERVER_IP=$(curl -s --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')
if grep -q "ALLOWED_ORIGINS=http://localhost" "$ENV_FILE"; then
    echo "设置 CORS 允许来源: http://$SERVER_IP"
    sed -i "s|ALLOWED_ORIGINS=http://localhost|ALLOWED_ORIGINS=http://$SERVER_IP|" "$ENV_FILE"
fi

# ── 5. 构建镜像 ──
echo ""
echo "=== 构建镜像（首次较慢，约 5-10 分钟）==="
$COMPOSE build

# ── 6. 启动数据库 ──
echo ""
echo "=== 启动 PostgreSQL ==="
$COMPOSE up -d postgres
echo "等待数据库就绪..."
for i in $(seq 1 30); do
    if $COMPOSE exec -T postgres \
        pg_isready -U qunxiang -d qunxiang &>/dev/null; then
        echo "PostgreSQL 已就绪"
        break
    fi
    sleep 2
done

# ── 7. 数据库迁移 ──
echo ""
echo "=== 执行数据库迁移 ==="
$COMPOSE run --rm --no-deps api \
    pnpm --filter @qunxiang/storage exec prisma migrate deploy --schema=./prisma/schema.prisma

# ── 8. 启动全部服务 ──
echo ""
echo "=== 启动全部服务 ==="
$COMPOSE up -d

# ── 9. 等待 API 就绪 ──
echo ""
echo "等待 API 就绪..."
for i in $(seq 1 20); do
    if curl -sf "http://localhost/health" &>/dev/null; then
        echo "API 已就绪"
        break
    fi
    sleep 2
done

# ── 10. 完成 ──
echo ""
echo "================================================"
echo "  部署完成！"
echo "  访问地址: http://$SERVER_IP"
echo ""
echo "  重要：备份以下文件（丢失无法恢复）："
echo "    api/.env.production （JWT/SIGN/VAULT）"
echo "    .db-password （PostgreSQL 密码）"
echo "    .env.docker （compose 环境变量）"
echo "================================================"
