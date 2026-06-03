#!/bin/bash
# =============================================================
# 両システム デプロイスクリプト
# 使い方:
#   chmod +x deploy.sh
#   ./deploy.sh              # 両方デプロイ
#   ./deploy.sh shintyoku    # 営業進捗管理のみ
#   ./deploy.sh mitsumori    # 見積管理システムのみ
# =============================================================
set -e

# ---- 設定（あなたの環境に合わせて変更） ----
SHINTYOKU_DIR="${SHINTYOKU_DIR:-$HOME/sinntyokukannri}"
MITSUMORI_DIR="${MITSUMORI_DIR:-$HOME/mitumorikannri}"     # 見積管理システムのディレクトリ
DEPLOY_DESC="update-$(date +%Y%m%d-%H%M)"
# -------------------------------------------

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()   { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

check_clasp() {
  if ! command -v clasp &>/dev/null; then
    error "claspが見つかりません。\n  npm install -g @google/clasp でインストール後\n  clasp login を実行してください。"
  fi
}

deploy_shintyoku() {
  log "📊 営業進捗管理システム をデプロイ中..."
  cd "$SHINTYOKU_DIR" || error "ディレクトリが見つかりません: $SHINTYOKU_DIR"

  # .clasp.json が無ければスキップ
  if [ ! -f ".clasp.json" ]; then
    warn ".clasp.json が見つかりません。初回は手動で clasp clone または clasp create を実行してください。"
    return 1
  fi

  # HTMLをindex.htmlとしてコピー（GASはindex.htmlを参照）
  if [ -f "営業進捗管理.html" ]; then
    cp "営業進捗管理.html" "index.html"
    ok "index.html を更新"
  fi

  # linkage-helper.gs もコピー
  if [ -f "linkage-helper.gs" ]; then
    ok "linkage-helper.gs 確認済"
  fi

  clasp push --force
  ok "push完了"

  # デプロイ更新（既存デプロイのバージョンを上げる）
  DEPLOY_ID=$(clasp deployments 2>/dev/null | grep -v "^No\|^$" | tail -1 | awk '{print $2}')
  if [ -n "$DEPLOY_ID" ]; then
    clasp deploy --deploymentId "$DEPLOY_ID" --description "$DEPLOY_DESC"
    ok "デプロイ更新完了 (ID: $DEPLOY_ID)"
  else
    clasp deploy --description "$DEPLOY_DESC"
    ok "新規デプロイ完了"
  fi
}

deploy_mitsumori() {
  log "💰 見積管理システム をデプロイ中..."
  cd "$MITSUMORI_DIR" || { warn "ディレクトリが見つかりません: $MITSUMORI_DIR"; return 1; }

  if [ ! -f ".clasp.json" ]; then
    warn ".clasp.json が見つかりません。スキップします。"
    return 1
  fi

  # linkage-helper.gs を見積管理にもコピー（同期）
  if [ -f "$SHINTYOKU_DIR/linkage-helper.gs" ]; then
    cp "$SHINTYOKU_DIR/linkage-helper.gs" "./linkage-helper.gs"
    ok "linkage-helper.gs を同期"
  fi

  clasp push --force
  ok "push完了"

  DEPLOY_ID=$(clasp deployments 2>/dev/null | grep -v "^No\|^$" | tail -1 | awk '{print $2}')
  if [ -n "$DEPLOY_ID" ]; then
    clasp deploy --deploymentId "$DEPLOY_ID" --description "$DEPLOY_DESC"
    ok "デプロイ更新完了 (ID: $DEPLOY_ID)"
  else
    clasp deploy --description "$DEPLOY_DESC"
    ok "新規デプロイ完了"
  fi
}

sync_github() {
  log "📦 GitHub に push中..."
  cd "$SHINTYOKU_DIR"
  git add -A
  git commit -m "deploy: $DEPLOY_DESC" 2>/dev/null || true
  git push origin main 2>/dev/null || warn "git pushスキップ（リモートなし or 変更なし）"
  ok "GitHub push完了"
}

# ---- メイン ----
check_clasp

TARGET="${1:-both}"
case "$TARGET" in
  shintyoku|s)
    deploy_shintyoku
    ;;
  mitsumori|m)
    deploy_mitsumori
    ;;
  both|"")
    deploy_shintyoku
    echo ""
    deploy_mitsumori
    echo ""
    sync_github
    ;;
  *)
    echo "使い方: $0 [shintyoku|mitsumori|both]"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}✅ デプロイ完了: $DEPLOY_DESC${NC}"
