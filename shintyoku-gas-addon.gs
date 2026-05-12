// ============================================================
// 進捗管理システム連携 — GAS追記コード
// 03_webapp_ap.gs の末尾に追記してください
// ============================================================

// ============================================================
// ① doGet の先頭に追加するコード
//    （既存 doGet 関数の function doGet(e) { の直後に貼る）
// ============================================================
/*

  // ─── 進捗管理システム: HTMLをホスティング ───
  if (e && e.parameter && e.parameter.page === 'shintyoku') {
    return HtmlService.createHtmlOutputFromFile('ShintyokuFlow')
      .setTitle('業務フロー進捗管理')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // ─── 進捗管理システム: APIエンドポイント（GETリクエスト対応）───
  if (e && e.parameter && e.parameter.action) {
    var action = e.parameter.action;
    var payload = {};
    Object.keys(e.parameter).forEach(function(key) {
      if (key === 'action') return;
      try   { payload[key] = JSON.parse(e.parameter[key]); }
      catch (_) { payload[key] = e.parameter[key]; }
    });
    var result;
    try   { result = handleApiRequest(action, payload); }
    catch (err) { result = { success: false, error: err.message }; }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

*/

// ============================================================
// ② handleApiRequest の switch 文に追加する case
//    （既存の switch(action) { の中に追加）
// ============================================================
/*

  case 'progressGetAll':     return apiProgressGetAll();
  case 'progressGetSummary': return apiProgressGetSummary(payload);

*/

// ============================================================
// ③ 進捗管理専用API関数（末尾に追記）
// ============================================================

/**
 * 進捗管理フロー用: 注文+部署+進捗情報をまとめて返す
 * boardGetOrders が既にあるためそれを拡張する形
 */
function apiProgressGetAll() {
  try {
    var base = apiGetOrdersWithBoardInfo(); // 既存関数を再利用
    if (!base.success) return base;

    var items = base.items.map(function(o) {
      var stageMap = {
        '作成予定': { deptId:'sales',    stageIdx:0, progress:5   },
        '送信済み': { deptId:'sales',    stageIdx:1, progress:25  },
        '受領':     { deptId:'repair',   stageIdx:2, progress:45  },
        '受注済み': { deptId:'mfg',      stageIdx:3, progress:65  },
        '保留':     { deptId:'sales',    stageIdx:0, progress:10  },
        'キャンセル':{ deptId:'sales',   stageIdx:0, progress:0   },
        '失注':     { deptId:'sales',    stageIdx:0, progress:0   },
        '納品済み': { deptId:'billing',  stageIdx:6, progress:100 },
      };
      var stage = stageMap[o.status] || stageMap['作成予定'];
      return {
        mgmtId:      o.mgmtId,
        orderNo:     o.orderNo,
        orderSlipNo: o.orderSlipNo,
        client:      o.client,
        orderDate:   o.orderDate,
        orderAmount: o.orderAmount,
        status:      o.status,
        orderType:   o.orderType,
        modelCode:   o.modelCode,
        machineName: o.machineName,
        boards:      o.boards,
        assignee:    _getAssignee(o.mgmtId),
        memo:        _getMemo(o.mgmtId),
        deptId:      stage.deptId,
        stageIdx:    stage.stageIdx,
        progress:    stage.progress,
      };
    });

    return { success: true, items: items, total: items.length };
  } catch(e) {
    Logger.log('[PROGRESS GET ALL] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * 担当者フィールドをスプレッドシートから取得
 * MGMT_COLS.ASSIGNEE が定義されていれば使用、なければ空文字を返す
 */
function _getAssignee(mgmtId) {
  try {
    var sheet = getSpreadsheet().getSheetByName(CONFIG.SHEET_MANAGEMENT);
    if (!sheet || sheet.getLastRow() <= 1) return '';
    var ids = sheet.getRange(2, MGMT_COLS.ID, sheet.getLastRow() - 1, 1).getValues().flat();
    var idx = ids.map(String).indexOf(String(mgmtId));
    if (idx < 0) return '';
    // MGMT_COLS.ASSIGNEE が存在する場合はそのカラムから取得
    var assigneeCol = MGMT_COLS.ASSIGNEE || 0;
    if (!assigneeCol) return '';
    return String(sheet.getRange(idx + 2, assigneeCol).getValue() || '');
  } catch(e) { return ''; }
}

/**
 * メモフィールドをスプレッドシートから取得
 */
function _getMemo(mgmtId) {
  try {
    var sheet = getSpreadsheet().getSheetByName(CONFIG.SHEET_MANAGEMENT);
    if (!sheet || sheet.getLastRow() <= 1) return '';
    var ids = sheet.getRange(2, MGMT_COLS.ID, sheet.getLastRow() - 1, 1).getValues().flat();
    var idx = ids.map(String).indexOf(String(mgmtId));
    if (idx < 0) return '';
    var memoCol = MGMT_COLS.MEMO || 0;
    if (!memoCol) return '';
    return String(sheet.getRange(idx + 2, memoCol).getValue() || '');
  } catch(e) { return ''; }
}

/**
 * 進捗サマリー（部署別・担当者別集計）
 */
function apiProgressGetSummary() {
  try {
    var result = apiProgressGetAll();
    if (!result.success) return result;
    var items = result.items;

    var byDept = {};
    var byPerson = {};

    items.forEach(function(o) {
      // 部署別
      byDept[o.deptId] = byDept[o.deptId] || { count: 0, amount: 0 };
      byDept[o.deptId].count++;
      byDept[o.deptId].amount += Number(o.orderAmount) || 0;

      // 担当者別
      var name = o.assignee || '未設定';
      byPerson[name] = byPerson[name] || { count: 0, deptId: o.deptId };
      byPerson[name].count++;
      byPerson[name].deptId = o.deptId;
    });

    return {
      success: true,
      total: items.length,
      byDept: byDept,
      byPerson: byPerson,
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// ④ デプロイ手順（コメント）
// ============================================================
/*
【設定手順】

─────────────────────────────────────────
STEP 1: ShintyokuFlow.html をGASプロジェクトに追加
─────────────────────────────────────────
1. Apps Script エディタを開く
2. 左メニュー「+ファイル」→「HTML」
3. ファイル名を「ShintyokuFlow」にする（拡張子.htmlは不要）
4. ShintyokuFlow.html の内容を貼り付け
5. 1行目の GAS_URL の行を以下に変更:
   const GAS_URL = null;  // GAS内蔵モードを使用

─────────────────────────────────────────
STEP 2: 03_webapp_ap.gs を更新
─────────────────────────────────────────
1. doGet 関数の先頭（function doGet(e) { の直後）に
   上記①のコードを追加

2. handleApiRequest の switch 文に
   上記②の case 2行を追加

3. ファイル末尾に この .gs ファイルの内容を追記

─────────────────────────────────────────
STEP 3: 再デプロイ
─────────────────────────────────────────
1. Apps Script エディタ右上「デプロイ」
2. 「既存のデプロイを管理」→ 最新バージョンに更新
   または「新しいデプロイ」→ ウェブアプリ

─────────────────────────────────────────
STEP 4: アクセスURL
─────────────────────────────────────────
進捗管理画面:
  https://script.google.com/macros/s/{ID}/exec?page=shintyoku

VR3既存ダッシュボード:
  https://script.google.com/macros/s/{ID}/exec（変更なし）

BOM管理:
  https://script.google.com/macros/s/{ID}/exec?page=bom（変更なし）

─────────────────────────────────────────
使用されるAPIエンドポイント一覧
─────────────────────────────────────────
読み込み:
  ?action=boardGetOrders    → 注文+基板情報（既存）
  ?action=getAll            → 全注文（既存、fallback用）
  ?action=progressGetAll    → 進捗フロー用拡張データ（新規）

書き込み:
  ?action=updateMgmt        → 担当者・メモ・ステータスを更新（既存）
  ?action=updateStatus      → ステータスのみ更新（既存）

─────────────────────────────────────────
スプレッドシート側で担当者・メモを使う場合
─────────────────────────────────────────
管理シートに「担当者」「メモ」列が存在する場合、
MGMT_COLS.ASSIGNEE と MGMT_COLS.MEMO に列番号を設定してください。

例（01 config and setup.gs の MGMT_COLS に追加）:
  ASSIGNEE: 18,  // 18列目が担当者の場合
  MEMO:     19,  // 19列目がメモの場合
*/
