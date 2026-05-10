// ============================================================
// サン電子株式会社 基板ワークフロー管理システム
// ファイル 1/5: 設定・業務フロー定義
// ============================================================
// 【導入手順】
// 1. WF_SS_ID を新規スプレッドシートのIDに変更
// 2. MITUMORIKANNRI_SS_ID を既存の見積管理SSのIDに変更
// 3. initSunDenshiWorkflow() を一度だけ手動実行
// 4. setupSunDenshiTriggers() を実行
// 5. WebApp デプロイ → URL を4部署に共有
// ============================================================

// ---- スプレッドシートID ----
var WF_SS_ID             = 'YOUR_NEW_WORKFLOW_SS_ID';
var MITUMORIKANNRI_SS_ID = 'YOUR_EXISTING_MITUMORIKANNRI_SS_ID'; // 見積管理GASのSS

// ---- シート名 ----
var WF_SHEETS = {
  MODELS:    '機種マスタ',      // 機種一覧（お客様からの機種販売表）
  BOARDS:    '基板進捗マスタ',  // 機種×基板ごとの進捗（メインDB）
  HISTORY:   'フロー履歴',      // 各ステップの通過ログ
  ALERT_LOG: 'アラートログ',    // 通知送信履歴
  SETTINGS:  'システム設定',    // Webhook等の設定値
};

// ============================================================
// 基板種別の定義
// ============================================================
var BOARD_TYPES = {
  'M基板': { label: 'M基板（メイン）',    color: '#1a73e8' },
  'D基板': { label: 'D基板（ドライバ）',  color: '#9c27b0' },
  'DE基板':{ label: 'DE基板',             color: '#673ab7' },
  'E基板': { label: 'E基板（電源）',      color: '#e91e63' },
  'C基板': { label: 'C基板（コントロール）',color: '#009688' },
  'S基板': { label: 'S基板（サブ）',      color: '#ff5722' },
  'PCB':   { label: 'PCB',                color: '#607d8b' },
};

// ============================================================
// ワークフロー定義
// 各基板は「新規設計フロー」か「既存流用フロー」のどちらかで動く
// ============================================================
var WORKFLOW_DEFS = {

  // ----------------------------------------------------------
  // A: 新規基板フロー（設計から始まる場合）
  // ----------------------------------------------------------
  '新規設計': {
    label: '新規基板フロー',
    description: '回路設計から製造・納品まで',
    phases: [
      {
        id:        'design_spec',
        label:     '仕様検討',
        dept:      '設計課',
        role:      '設計担当',
        sla_hours: 240,  // 10営業日
        steps: [
          { id: 'spec_review',   label: '仕様書受領・確認',   dept: '設計課' },
          { id: 'spec_check',    label: '技術検討・実現性確認', dept: '設計課' },
          { id: 'spec_approve',  label: '仕様確定・上長承認',  dept: '設計課' },
        ]
      },
      {
        id:        'design_circuit',
        label:     '回路設計',
        dept:      '設計課',
        role:      '設計担当',
        sla_hours: 480,  // 20営業日
        steps: [
          { id: 'circuit_design', label: '回路設計',         dept: '設計課' },
          { id: 'circuit_review', label: '回路レビュー',     dept: '設計課' },
          { id: 'pattern_design', label: 'パターン設計',     dept: '設計課' },
          { id: 'pattern_review', label: 'パターンレビュー', dept: '設計課' },
        ]
      },
      {
        id:        'design_proto',
        label:     '試作・検証',
        dept:      '設計課',
        role:      '設計担当',
        sla_hours: 480,
        steps: [
          { id: 'proto_order',   label: '試作発注（資材購買へ依頼）', dept: '設計課' },
          { id: 'proto_receive', label: '試作品受領',                 dept: '設計課' },
          { id: 'proto_test',    label: '動作検証・評価',             dept: '設計課' },
          { id: 'qc_firstcheck', label: '品質管理課 初回品確認',      dept: '品質管理課' },
          { id: 'proto_approve', label: '量産移行承認',               dept: '設計課' },
        ]
      },
      {
        id:        'bom_confirm',
        label:     'BOM・部材確定',
        dept:      '資材購買課',
        role:      '購買担当',
        sla_hours: 120,
        steps: [
          { id: 'bom_create',    label: 'BOM作成・登録',    dept: '資材購買課' },
          { id: 'parts_select',  label: '部材選定・承認',   dept: '資材購買課' },
          { id: 'supplier_conf', label: '仕入先確定・見積', dept: '資材購買課' },
        ]
      },
      {
        id:        'manufacture',
        label:     '量産製造発注',
        dept:      '資材購買課',
        role:      '購買担当',
        sla_hours: 48,
        steps: [
          { id: 'mfg_order',     label: '外部工場へ製造発注', dept: '資材購買課' },
          { id: 'mfg_confirm',   label: '工場より受注確認',   dept: '資材購買課' },
          { id: 'mfg_progress',  label: '製造進捗確認',       dept: '資材購買課' },
          { id: 'mfg_complete',  label: '製造完了・出荷連絡', dept: '資材購買課' },
        ]
      },
      {
        id:        'qc_incoming',
        label:     '受入検査',
        dept:      '品質管理課',
        role:      'QC担当',
        sla_hours: 48,
        steps: [
          { id: 'qc_receive',    label: '入荷確認・数量検収',   dept: '品質管理課' },
          { id: 'qc_inspect',    label: '受入検査（機能確認）', dept: '品質管理課' },
          { id: 'qc_lot_reg',    label: 'ロット番号登録',       dept: '品質管理課' },
          { id: 'qc_pass',       label: '検査合格・入庫処理',   dept: '品質管理課' },
        ]
      },
      {
        id:        'delivery',
        label:     'お客様納品',
        dept:      '営業課',
        role:      '営業担当',
        sla_hours: 24,
        steps: [
          { id: 'ship_arrange',  label: '出荷手配',           dept: '営業課' },
          { id: 'ship_done',     label: '出荷完了・伝票発行', dept: '営業課' },
          { id: 'deliver_conf',  label: '納品確認・完了',     dept: '営業課' },
        ]
      },
    ]
  },

  // ----------------------------------------------------------
  // B: 既存基板フロー（設計なし、製造・納品のみ）
  // ----------------------------------------------------------
  '既存流用': {
    label: '既存基板フロー',
    description: '既存設計を使用した量産製造・納品',
    phases: [
      {
        id:        'order_receive',
        label:     '受注処理',
        dept:      '営業課',
        role:      '営業担当',
        sla_hours: 24,
        steps: [
          { id: 'quote_create',  label: '見積作成',           dept: '営業課' },
          { id: 'quote_send',    label: '見積送付',           dept: '営業課' },
          { id: 'order_recv',    label: '注文書受領・確認',   dept: '営業課' },
          { id: 'order_accept',  label: '受注確定',           dept: '営業課' },
        ]
      },
      {
        id:        'purchase_order',
        label:     '製造発注',
        dept:      '資材購買課',
        role:      '購買担当',
        sla_hours: 48,
        steps: [
          { id: 'parts_check',   label: '部材在庫・BOM確認',  dept: '資材購買課' },
          { id: 'mfg_order',     label: '外部工場へ製造発注', dept: '資材購買課' },
          { id: 'mfg_confirm',   label: '工場より受注確認',   dept: '資材購買課' },
          { id: 'mfg_progress',  label: '製造進捗確認',       dept: '資材購買課' },
          { id: 'mfg_complete',  label: '製造完了・出荷連絡', dept: '資材購買課' },
        ]
      },
      {
        id:        'qc_incoming',
        label:     '受入検査',
        dept:      '品質管理課',
        role:      'QC担当',
        sla_hours: 48,
        steps: [
          { id: 'qc_receive',    label: '入荷確認・数量検収',   dept: '品質管理課' },
          { id: 'qc_inspect',    label: '受入検査（ロット確認）',dept: '品質管理課' },
          { id: 'qc_lot_reg',    label: 'ロット番号登録',       dept: '品質管理課' },
          { id: 'qc_pass',       label: '検査合格・入庫',       dept: '品質管理課' },
        ]
      },
      {
        id:        'delivery',
        label:     'お客様納品',
        dept:      '営業課',
        role:      '営業担当',
        sla_hours: 24,
        steps: [
          { id: 'ship_arrange',  label: '出荷手配',           dept: '営業課' },
          { id: 'ship_done',     label: '出荷完了・伝票発行', dept: '営業課' },
          { id: 'deliver_conf',  label: '納品確認・完了',     dept: '営業課' },
        ]
      },
    ]
  },
};

// ============================================================
// 部署定義
// ============================================================
var DEPTS = ['設計課', '資材購買課', '営業課', '品質管理課'];

// ============================================================
// 基板進捗マスタのカラム定義
// ============================================================
var BP_COLS = {
  ID:              1,  // A: 進捗ID（自動採番）
  MODEL_CODE:      2,  // B: 機種コード
  MODEL_NAME:      3,  // C: 機種名
  BOARD_ID:        4,  // D: 基板ID（例: M2601A）
  BOARD_TYPE:      5,  // E: 基板種別（M/D/E...）
  FLOW_TYPE:       6,  // F: フロー種別（新規設計/既存流用）
  CURRENT_PHASE:   7,  // G: 現在フェーズID
  CURRENT_STEP:    8,  // H: 現在ステップID
  BALL_DEPT:       9,  // I: ボール所在（部署）
  BALL_OWNER:      10, // J: ボール所在（担当者名）
  PHASE_STARTED:   11, // K: 現フェーズ開始日時
  SLA_DEADLINE:    12, // L: SLA期限（納期）
  DELIVERY_DATE:   13, // M: お客様納品予定日（注文書から取得）
  ORDER_NO:        14, // N: 注文書番号（見積管理GASと連携）
  QUOTE_NO:        15, // O: 見積番号
  STATUS:          16, // P: ステータス（進行中/完了/保留/NG差戻し）
  PRIORITY:        17, // Q: 優先度（高/中/低）
  LOT_NUMBER:      18, // R: ロット番号（QC登録）
  QC_RESULT:       19, // S: QC判定（合格/不合格/保留）
  CREATED_AT:      20, // T: 登録日
  UPDATED_AT:      21, // U: 最終更新日時
  MEMO:            22, // V: メモ・備考
};

// ---- ユーティリティ ----
function _getWfSS() { return SpreadsheetApp.openById(WF_SS_ID); }
function _getMituSS() {
  try { return SpreadsheetApp.openById(MITUMORIKANNRI_SS_ID); }
  catch(e) { Logger.log('[MITU SS ERROR] ' + e.message); return null; }
}
function _fmtDate(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
}
function _fmtDateShort(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy/MM/dd');
}
function _hoursElapsed(fromDate) {
  if (!fromDate) return 0;
  return (new Date() - new Date(fromDate)) / 3600000;
}
function _dateKey(d) {
  return Utilities.formatDate(d instanceof Date ? d : new Date(d), Session.getScriptTimeZone(), 'yyyyMMdd');
}

// ---- 設定値取得 ----
function _getSettings() {
  try {
    var sheet = _getWfSS().getSheetByName(WF_SHEETS.SETTINGS);
    if (!sheet) return {};
    var data = sheet.getDataRange().getValues();
    var s = {};
    for (var i = 1; i < data.length; i++) s[data[i][0]] = data[i][1];
    return s;
  } catch(e) { return {}; }
}

// ============================================================
// 初期化（一度だけ手動実行）
// ============================================================
function initSunDenshiWorkflow() {
  var ss = _getWfSS();

  // 機種マスタ
  var mSheet = ss.getSheetByName(WF_SHEETS.MODELS) || ss.insertSheet(WF_SHEETS.MODELS);
  if (mSheet.getLastRow() === 0) {
    mSheet.appendRow(['機種コード','機種名','顧客名','販売予定時期','登録日','メモ']);
    mSheet.setFrozenRows(1);
    [200,150,180,130,160,120].forEach(function(w,i) { mSheet.setColumnWidth(i+1, w); });
  }

  // 基板進捗マスタ
  var bSheet = ss.getSheetByName(WF_SHEETS.BOARDS) || ss.insertSheet(WF_SHEETS.BOARDS);
  if (bSheet.getLastRow() === 0) {
    bSheet.appendRow([
      '進捗ID','機種コード','機種名','基板ID','基板種別','フロー種別',
      '現在フェーズ','現在ステップ','ボール部署','ボール担当者',
      'フェーズ開始','SLA期限','納品予定日','注文書番号','見積番号',
      'ステータス','優先度','ロット番号','QC判定','登録日','最終更新','メモ'
    ]);
    bSheet.setFrozenRows(1);
    bSheet.setFrozenColumns(4);
  }

  // フロー履歴
  var hSheet = ss.getSheetByName(WF_SHEETS.HISTORY) || ss.insertSheet(WF_SHEETS.HISTORY);
  if (hSheet.getLastRow() === 0) {
    hSheet.appendRow(['進捗ID','機種コード','基板ID','フェーズ','ステップ','実施部署','実施者','アクション','実施日時','所要時間(h)','コメント']);
    hSheet.setFrozenRows(1);
  }

  // アラートログ
  var aSheet = ss.getSheetByName(WF_SHEETS.ALERT_LOG) || ss.insertSheet(WF_SHEETS.ALERT_LOG);
  if (aSheet.getLastRow() === 0) {
    aSheet.appendRow(['日時','進捗ID','機種コード','基板ID','アラート種別','メッセージ']);
    aSheet.setFrozenRows(1);
  }

  // システム設定
  var sSheet = ss.getSheetByName(WF_SHEETS.SETTINGS) || ss.insertSheet(WF_SHEETS.SETTINGS);
  if (sSheet.getLastRow() === 0) {
    sSheet.appendRow(['設定キー','設定値','説明']);
    [
      ['GOOGLE_CHAT_WEBHOOK', '', 'Google Chat Webhook URL'],
      ['EMAIL_ADDRESSES', '', '通知先メール（カンマ区切り）'],
      ['TELEGRAM_BOT_TOKEN', '', 'Telegram Bot Token（任意）'],
      ['TELEGRAM_CHAT_ID', '', 'Telegram Chat ID（任意）'],
      ['SLA_WARNING_HOURS', '48', 'SLA警告閾値（時間）'],
      ['SLA_DANGER_HOURS', '8', 'SLA危険閾値（時間）'],
      ['STAGNANT_HOURS', '72', '滞留検知閾値（時間）'],
    ].forEach(function(r) { sSheet.appendRow(r); });
    sSheet.setFrozenRows(1);
  }

  Logger.log('✅ サン電子 ワークフロー管理システム 初期化完了');
  SpreadsheetApp.getUi().alert('初期化完了！\n次に setupSunDenshiTriggers() を実行してください。');
}

function setupSunDenshiTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (['sdCheckSlaAlerts', 'sdSyncFromMitumorikannri'].indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });
  // SLAチェック：毎時
  ScriptApp.newTrigger('sdCheckSlaAlerts').timeBased().everyHours(1).create();
  // 見積管理GASとの同期：毎朝8時
  ScriptApp.newTrigger('sdSyncFromMitumorikannri').timeBased().everyDays(1).atHour(8).create();
  Logger.log('✅ トリガー設定完了（SLAチェック：毎時 / 注文書同期：毎朝8時）');
}
