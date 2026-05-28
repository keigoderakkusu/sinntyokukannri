/**
 * ============================================================
 * email-rpa-main.gs — メールRPAシステム メインエントリポイント
 * ============================================================
 * 機能:
 *   1. 5分ごとに未読メールをスキャン
 *   2. Gemini AI でメール種別を判定
 *   3. 中残処理 / 見積依頼 / 構成表 を自動ルーティング
 *   4. 処理済みラベルを付与してログ記録
 *
 * セットアップ: setupRPATriggers() を一度だけ手動実行
 * ============================================================
 */

// ── 設定（GASスクリプトプロパティで管理） ──────────────────
const RPA = {
  get geminiKey()      { return PropertiesService.getScriptProperties().getProperty('RPA_GEMINI_KEY') || ''; },
  get notifyEmails()   { return (PropertiesService.getScriptProperties().getProperty('RPA_NOTIFY_EMAILS') || '').split(',').map(e=>e.trim()).filter(Boolean); },
  get salesEmail()     { return PropertiesService.getScriptProperties().getProperty('RPA_SALES_EMAIL') || ''; },
  get driveFolderId()  { return PropertiesService.getScriptProperties().getProperty('RPA_DRIVE_FOLDER_ID') || ''; },
  get logSheetId()     { return PropertiesService.getScriptProperties().getProperty('RPA_LOG_SHEET_ID') || ''; },
  get processedLabel() { return PropertiesService.getScriptProperties().getProperty('RPA_PROCESSED_LABEL') || 'RPA処理済み'; },
  get companyName()    { return PropertiesService.getScriptProperties().getProperty('RPA_COMPANY_NAME') || '営業部'; },
};

// ── メイン処理（5分ごとトリガー） ───────────────────────────
function processNewEmails() {
  const label = _getOrCreateLabel(RPA.processedLabel);
  // 未読 かつ 処理済みラベルなし の直近2日分を取得
  const threads = GmailApp.search(
    `is:unread -label:"${RPA.processedLabel}" newer_than:2d`
  );
  Logger.log(`📧 対象スレッド: ${threads.length}件`);

  let processed = 0, skipped = 0, errors = 0;

  threads.forEach(thread => {
    try {
      const messages = thread.getMessages();
      const msg = messages[messages.length - 1]; // 最新メッセージ
      if (!msg.isUnread()) return;

      const result = _classifyAndRoute(msg);

      if (result.handled) {
        thread.addLabel(label);
        msg.markRead();
        _appendLog(msg, result);
        processed++;
        Logger.log(`✅ [${result.type}] ${msg.getSubject()}`);
      } else {
        skipped++;
        Logger.log(`⏭️  スキップ: ${msg.getSubject()}`);
      }
    } catch (e) {
      errors++;
      Logger.log(`❌ エラー (${thread.getFirstMessageSubject()}): ${e.message}`);
    }
  });

  Logger.log(`完了 — 処理:${processed} / スキップ:${skipped} / エラー:${errors}`);
}

// ── 分類 → ルーティング ─────────────────────────────────────
function _classifyAndRoute(msg) {
  const subject     = msg.getSubject();
  const body        = msg.getPlainBody().substring(0, 2500);
  const sender      = msg.getFrom();
  const attachments = msg.getAttachments();

  const cls = rpaClassifyEmail(subject, body, sender);
  Logger.log(`分類: ${JSON.stringify(cls)}`);

  switch (cls.type) {
    case '中残処理': return rpaHandleChuzan(msg, cls, attachments);
    case '見積依頼': return rpaHandleQuote(msg, cls, attachments);
    case '構成表':   return rpaHandleBOM(msg, cls, attachments);
    default:         return { handled: false, type: 'その他', classification: cls };
  }
}

// ── ログシートへ追記 ────────────────────────────────────────
function _appendLog(msg, result) {
  try {
    if (!RPA.logSheetId) return;
    const ss    = SpreadsheetApp.openById(RPA.logSheetId);
    let   sheet = ss.getSheetByName('RPAログ');
    if (!sheet) {
      sheet = ss.insertSheet('RPAログ');
      sheet.appendRow(['日時','種別','送信者','件名','機種','要約','ステータス']);
      sheet.getRange(1,1,1,7).setFontWeight('bold').setBackground('#0f1729').setFontColor('#fff');
    }
    sheet.appendRow([
      new Date(),
      result.type,
      msg.getFrom(),
      msg.getSubject(),
      result.machineId || '—',
      result.summary   || '—',
      '✅ 処理済',
    ]);
  } catch (e) {
    Logger.log('ログシートエラー: ' + e.message);
  }
}

function _getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// ── トリガーセットアップ（一度だけ手動実行） ─────────────────
function setupRPATriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processNewEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processNewEmails')
    .timeBased().everyMinutes(5).create();
  Logger.log('✅ RPAトリガー設定完了（5分ごと）');
}

function removeRPATriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processNewEmails') {
      ScriptApp.deleteTrigger(t);
      Logger.log('トリガー削除完了');
    }
  });
}

/** スクリプトプロパティを一括設定（初期セットアップ用） */
function initRPAConfig(cfg) {
  const props = PropertiesService.getScriptProperties();
  const defaults = {
    RPA_GEMINI_KEY:       cfg.geminiKey       || '',
    RPA_NOTIFY_EMAILS:    cfg.notifyEmails    || '',  // カンマ区切り
    RPA_SALES_EMAIL:      cfg.salesEmail      || '',
    RPA_DRIVE_FOLDER_ID:  cfg.driveFolderId   || '',
    RPA_LOG_SHEET_ID:     cfg.logSheetId      || '',
    RPA_PROCESSED_LABEL:  cfg.processedLabel  || 'RPA処理済み',
    RPA_COMPANY_NAME:     cfg.companyName     || '営業部',
  };
  Object.entries(defaults).forEach(([k,v]) => props.setProperty(k, v));
  Logger.log('✅ RPA設定を保存しました');
}
