#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "========================================"
echo "  同舟 · 校园手账"
echo "========================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 没有检测到 Node.js。"
  echo "请先安装 Node.js 18 或更高版本：https://nodejs.org/"
  exit 1
fi

if [ ! -d node_modules/playwright-core ]; then
  echo "首次运行，正在安装依赖..."
  npm install
fi

echo "正在启动服务..."
echo "启动后浏览器会自动打开 http://127.0.0.1:4173"
echo "按 Ctrl+C 停止服务。"

(
  sleep 2
  if command -v open >/dev/null 2>&1; then
    open http://127.0.0.1:4173
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://127.0.0.1:4173
  fi
) &

node server.mjs
