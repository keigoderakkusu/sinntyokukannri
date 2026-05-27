# GAS セットアップガイド — 営業進捗管理システム

## 1. GAS プロジェクト作成

1. [script.google.com](https://script.google.com) を開く
2. 「新しいプロジェクト」をクリック
3. プロジェクト名を「営業進捗管理」に変更

## 2. ファイルを追加

### Code.gs
デフォルトの `コード.gs` を開き、`Code.gs` の内容をすべて貼り付けて保存。

### index.html（HTMLファイル）
1. 左パネルの「＋」→「HTML」→ ファイル名を `index` に設定
2. `営業進捗管理.html` の内容をすべて貼り付けて保存

## 3. デプロイ

1. 右上「デプロイ」→「新しいデプロイ」
2. 種類: **ウェブアプリ**
3. 設定:
   - 説明: `営業進捗管理 v1`
   - 実行するユーザー: **自分**
   - アクセスできるユーザー: **自分** (社内限定なら「組織内の全員」)
4. 「デプロイ」→ URL をコピー

## 4. 動作確認

コピーした URL をブラウザで開く。  
初回は「アクセスを承認」が求められるので許可する。

## 5. データ永続化

- 編集・エコ更新・工程移動のたびに自動で `PropertiesService` に保存
- 次回アクセス時に自動復元
- 管理コンソール → データ管理 → JSONバックアップ で手動保存も可能

---

## 見積管理システムとの連携

### 営業進捗管理側の設定
1. 「管理コンソール」→「見積管理システム連携」を開く
2. 見積管理システムの GAS デプロイ URL を入力
3. 「URL保存」→「データ取得」

### 見積管理システム側の設定
1. `linkage-helper.gs` を見積管理プロジェクトに追加（「＋」→「スクリプト」）
2. 既存の `doGet` 関数に以下を追記:

```javascript
function doGet(e) {
  if (e.parameter.action === 'getForLink') {
    return getForLink(e);  // linkage-helper.gs の関数
  }
  // ... 既存の処理 ...
}
```

3. デプロイを更新

---

## clasp を使う場合（上級者向け）

```bash
# インストール
npm install -g @google/clasp

# ログイン
clasp login

# プロジェクト作成
clasp create --title "営業進捗管理" --type webapp

# ファイルをコピーして push
cp 営業進捗管理.html index.html
clasp push

# デプロイ
clasp deploy --description "v1"
```
