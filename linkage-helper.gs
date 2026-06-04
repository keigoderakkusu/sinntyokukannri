/**
 * ============================================================
 * 見積管理システム → 営業進捗管理システム 連携ヘルパー
 * linkage-helper.gs
 *
 * 【導入方法】
 * 1. このファイルを見積管理GASプロジェクトに追加
 *    （左ペイン「＋」→「スクリプト」→ファイル名: linkage-helper）
 *
 * 2. 既存の doGet に以下の分岐を追加:
 *    function doGet(e) {
 *      if (e.parameter.action === 'getForLink') return getForLink(e);
 *      // ... 既存処理 ...
 *    }
 *
 * 3. デプロイを更新（バージョン: 新しいバージョン）
 *
 * 4. 営業進捗管理の「管理コンソール → 見積管理システム連携」に
 *    デプロイURLを入力して「データ取得」
 * ============================================================
 */

// ============================================================
// ★ ここをあなたの見積管理SSに合わせて設定してください ★
// ============================================================
var LINKAGE_CONFIG = {

  // データが入っているシート名（空白 = アクティブシート）
  sheetName: '',

  // 列名マッピング（あなたのシートの実際の列名 → 左辺はそのまま）
  // 複数候補を配列で書けば上から順に探します
  columns: {
    machineId:      ['機種名', '機種コード', 'モデル', 'id', 'machineId'],
    customer:       ['顧客名', '得意先', 'お客様', 'client', 'customer'],
    amount:         ['見積金額', '金額', '受注金額', 'amount'],
    status:         ['ステータス', '状態', 'status'],
    quoteDate:      ['見積提出日', '見積日', '提出日', 'quoteDate'],
    poDate:         ['注文書受領日', '注文書日', '受領日', 'poDate', 'orderDate'],
    url:            ['見積書URL', '見積リンク', '見積PDF', 'URL', 'リンク', 'url', 'link'],
    orderUrl:       ['注文書URL', '注文書リンク', '注文書PDF', 'orderUrl', 'orderLink', 'po_url'],
    orderNo:        ['注文番号', '注文書番号', 'PO番号', 'orderNo'],
    quoteNo:        ['見積番号', '見積No', 'quoteNo'],
    memo:           ['備考', 'メモ', 'note', 'memo'],
  },

  // ステータス値 → 意味マッピング（あなたのシートの実際の値に合わせて）
  statusMap: {
    // 見積提出済みとみなすステータス値
    quoteSubmitted: ['見積提出済', '提出済', '見積済', '商談中', '受注', '注文書受領', '完了'],
    // 注文書受領済みとみなすステータス値
    poReceived:     ['注文書受領', '受注', '注文書受領済', '注文確定', '完了'],
  },
};
// ============================================================

/**
 * メインエントリ: 営業進捗管理から呼ばれる
 */
function getForLink(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = LINKAGE_CONFIG.sheetName
      ? ss.getSheetByName(LINKAGE_CONFIG.sheetName)
      : ss.getActiveSheet();

    if (!sheet) throw new Error('シートが見つかりません: ' + LINKAGE_CONFIG.sheetName);

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return _jsonOut({ estimates: [], updatedAt: new Date().toISOString(), warning: 'データなし' });
    }

    var headers = data[0].map(function(h){ return String(h).trim(); });
    var colIdx  = _buildColIndex(headers);

    var estimates = [];
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var machineId = _val(row, colIdx.machineId);
      if (!machineId) continue;

      var status    = String(_val(row, colIdx.status) || '');
      var quoteDate = _dateStr(_val(row, colIdx.quoteDate));
      var poDate    = _dateStr(_val(row, colIdx.poDate));

      // 見積提出済 の判定（日付あり OR ステータスマッチ OR 提出済チェック列）
      var quoteSubmitted = !!(quoteDate || _statusMatch(status, LINKAGE_CONFIG.statusMap.quoteSubmitted));
      // 注文書受領済 の判定
      var poReceived     = !!(poDate   || _statusMatch(status, LINKAGE_CONFIG.statusMap.poReceived));

      estimates.push({
        id:             machineId,
        machineId:      machineId,
        customer:       _val(row, colIdx.customer)  || '',
        amount:         _num(_val(row, colIdx.amount)),
        status:         status,
        quoteSubmitted: quoteSubmitted,
        quoteDate:      quoteDate,
        poReceived:     poReceived,
        poDate:         poDate,
        url:            _val(row, colIdx.url)       || '',
        orderUrl:       _val(row, colIdx.orderUrl)  || '',
        orderNo:        _val(row, colIdx.orderNo)   || '',
        quoteNo:        _val(row, colIdx.quoteNo)   || '',
        memo:           _val(row, colIdx.memo)      || '',
        rowIndex:       r + 1,  // シート上の行番号（更新用）
      });
    }

    return _jsonOut({
      estimates:  estimates,
      total:      estimates.length,
      updatedAt:  new Date().toISOString(),
      sheetName:  sheet.getName(),
    });

  } catch (err) {
    Logger.log('getForLink error: ' + err.message);
    return _jsonOut({ error: err.message, estimates: [] });
  }
}

/**
 * 営業進捗管理から「注文書受領済」を書き戻す（オプション機能）
 * 使い方: 営業進捗管理側で google.script.run.writeLinkageStatus({...}) を呼ぶ
 */
function writeLinkageStatus(params) {
  // params: { machineId, field: 'poReceived'|'quoteSubmitted', value, date }
  try {
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var sheet  = LINKAGE_CONFIG.sheetName ? ss.getSheetByName(LINKAGE_CONFIG.sheetName) : ss.getActiveSheet();
    var data   = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h){ return String(h).trim(); });
    var colIdx  = _buildColIndex(headers);

    for (var r = 1; r < data.length; r++) {
      if (String(data[r][colIdx.machineId] || '').trim() !== String(params.machineId || '').trim()) continue;

      if (params.field === 'quoteSubmitted' && colIdx.quoteDate >= 0 && params.date) {
        sheet.getRange(r + 1, colIdx.quoteDate + 1).setValue(params.date);
      }
      if (params.field === 'poReceived' && colIdx.poDate >= 0 && params.date) {
        sheet.getRange(r + 1, colIdx.poDate + 1).setValue(params.date);
      }
      return { success: true };
    }
    return { success: false, reason: '機種が見つかりません: ' + params.machineId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---- 内部ユーティリティ ----

function _buildColIndex(headers) {
  var result = {};
  Object.keys(LINKAGE_CONFIG.columns).forEach(function(field) {
    var candidates = LINKAGE_CONFIG.columns[field];
    result[field] = -1;
    for (var i = 0; i < candidates.length; i++) {
      var idx = headers.indexOf(candidates[i]);
      if (idx >= 0) { result[field] = idx; break; }
    }
  });
  return result;
}

function _val(row, colIdx) {
  if (colIdx < 0 || colIdx >= row.length) return '';
  var v = row[colIdx];
  return (v === null || v === undefined) ? '' : v;
}

function _num(v) {
  if (!v) return 0;
  var n = parseFloat(String(v).replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function _dateStr(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(s)) return s.substring(0, 10).replace(/\//g, '-');
  return '';
}

function _statusMatch(statusVal, candidates) {
  if (!statusVal) return false;
  var s = statusVal.trim();
  return candidates.some(function(c){ return s.indexOf(c) >= 0; });
}

function _jsonOut(obj) {
  var out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}
