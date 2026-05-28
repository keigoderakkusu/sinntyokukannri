# メールRPAシステム — セットアップガイド

## システム概要

```
Gmail受信
  ↓（5分ごと自動スキャン）
Gemini AI でメール分類
  ├── 中残処理 → 担当者へ通知 + 自動受付返信
  ├── 見積依頼 → 営業課へ通知（楽楽販売で見積作成依頼）
  └── 構成表  → Drive保存 + 社内共有 + 進捗管理自動反映
  ↓
「RPA処理済み」ラベル付与 → ログ記録
```

---

## 手順

### 1. GASプロジェクトにファイルを追加

既存の`営業進捗管理`GASプロジェクト（または新規プロジェクト）に以下を追加:

| ファイル名 | 役割 |
|-----------|------|
| `email-rpa-main.gs` | メインループ・トリガー |
| `email-rpa-classifier.gs` | Gemini AI 分類エンジン |
| `email-rpa-handlers.gs` | 3種類のメール処理 |
| `email-rpa-progress.gs` | 進捗管理自動反映 |

### 2. Gemini APIキーを取得

1. [Google AI Studio](https://aistudio.google.com/app/apikey) にアクセス
2. 「Create API key」でキーを生成

### 3. Google Driveにフォルダを作成

1. Google Driveで「構成表保管」などのフォルダを作成
2. フォルダURLの末尾のIDをコピー（`https://drive.google.com/drive/folders/[このID]`）

### 4. ログ用スプレッドシートを作成（任意）

1. 新規スプレッドシートを作成
2. URLの`/d/[このID]/`の部分をコピー

### 5. スクリプトプロパティを設定

GASエディタ → 「プロジェクトの設定」→「スクリプトプロパティ」で以下を追加:

| プロパティ名 | 値 | 説明 |
|------------|-----|------|
| `RPA_GEMINI_KEY` | `AIza...` | Gemini APIキー |
| `RPA_NOTIFY_EMAILS` | `tanaka@example.com,yamada@example.com` | 社内通知先（カンマ区切り） |
| `RPA_SALES_EMAIL` | `eigyoka@example.com` | 営業課メールアドレス |
| `RPA_DRIVE_FOLDER_ID` | `1ABC...xyz` | Drive保存先フォルダID |
| `RPA_LOG_SHEET_ID` | `1XYZ...abc` | ログスプレッドシートID（任意） |
| `RPA_COMPANY_NAME` | `○○株式会社 営業部` | 自動返信メールの署名 |

### 6. トリガーを起動

GASエディタで `setupRPATriggers()` を一度手動実行:

```
実行 → 関数を選択 → setupRPATriggers → 実行
```

### 7. 権限を承認

初回実行時に「権限が必要です」ダイアログが出ます:
- Gmail の読み取り・送信
- Google Drive のファイル作成
- URLフェッチ（Gemini API）

---

## メール分類ルール

### 自動で分類される条件

| 種別 | 件名・本文のキーワード例 |
|------|------------------------|
| 中残処理 | 「中残」「中古機 処理」「回収依頼」「在庫処理」「撤去依頼」 |
| 見積依頼 | 「見積」「お見積」「価格確認」「発注予定」「数量確認」 |
| 構成表 | 「構成表」「BOM」「仕様書」「基板リスト」「部品表」 |
| その他 | 上記に該当しない場合（自動処理なし） |

> Gemini APIキーが設定されている場合、AI がメール本文全体を読んで判断するため
> キーワードが含まれていなくても正しく分類できます。

---

## 動作フロー詳細

### 中残処理

```
お客様メール受信
  → 自動受付確認返信（即時）
  → 社内担当者へ通知メール
  → 更新ログに記録
```

### 見積依頼

```
お客様メール受信
  → 自動受付確認返信（即時）
  → 営業課へ通知（機種・数量・希望日を整形して転送）
  → 営業課が楽楽販売で見積作成
  → 更新ログに記録
```

### 構成表

```
お客様/社内からメール受信
  → 添付ファイルをGoogle Drive「機種名フォルダ」に保存
  → 社内全員へ共有メール送信（Driveリンク付き）
  → 進捗管理の「構成表」ステップを自動完了済みに
  → 備考メモに受信履歴を追記
  → 自動受付確認返信
```

---

## 進捗管理との連携

### 自動で反映される内容

| アクション | 進捗管理での変化 |
|-----------|----------------|
| 構成表受信 | 業務フローの「構成表受領」ステップが ✅ 完了に |
| 構成表受信 | 備考メモに受信日時・件名を自動追記 |
| 全種別 | 更新ログに `🤖 [RPA自動]` で記録 |

### 業務フローにRPA連携ステップを追加する方法

1. 営業進捗管理 → 業務フロータブ
2. 対象機種を選択
3. フロー追加 → ステップ名に「構成表受領」を追加
4. 以降、構成表メールが届くと自動で完了済みになります

---

## トラブルシューティング

### メールが処理されない

1. GASエディタ → 実行ログで `processNewEmails()` のエラーを確認
2. Gmail ラベル「RPA処理済み」の存在を確認
3. スクリプトプロパティに `RPA_GEMINI_KEY` が設定されているか確認

### 誤分類が多い

1. Gemini APIキーを設定する（未設定の場合はキーワードマッチのみ）
2. `email-rpa-classifier.gs` の `_classifyByKeyword()` にキーワードを追加

### 添付ファイルが保存されない

1. `RPA_DRIVE_FOLDER_ID` が正しいか確認
2. GASが対象フォルダへのアクセス権を持っているか確認

---

## 将来の拡張（楽楽販売 API 連携）

楽楽販売がCSVインポートをサポートしている場合:

```javascript
// 見積依頼受信時にCSVを生成してDriveに出力 → 楽楽販売にインポート
function exportQuoteRequestCSV(machineId, quantity, sender) {
  const csv = `機種名,数量,顧客名,受注日\n${machineId},${quantity},${sender},${new Date().toLocaleDateString('ja-JP')}`;
  const file = DriveApp.getFolderById(RPA.driveFolderId).createFile('見積依頼_' + machineId + '.csv', csv, 'text/csv');
  return file.getUrl();
}
```
