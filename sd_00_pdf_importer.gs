// ============================================================
// サン電子株式会社 機種販売表 PDFインポート機能
// ファイル: sd_00_pdf_importer.gs
// ============================================================
// 【使い方】
// 1. Googleドライブに「機種販売表.pdf」をアップロード
// 2. importLineupFromDrive() を実行 → ファイル選択UIが開く
//    ※ UIが使えない場合は importLineupFromFileId(fileId) に直接ファイルIDを指定
// 3. 自動で機種マスタ・基板進捗マスタに取り込まれる
// ============================================================

// ---- 設定 ----
// PDF解析にClaude APIを使うか、簡易テキスト解析のみにするか
var USE_CLAUDE_API = true;   // trueにするとClaude APIで高精度解析
var CLAUDE_API_KEY = '';     // Claude APIキーをScriptPropertyに保存して使う
                             // PropertiesService.getScriptProperties().setProperty('CLAUDE_API_KEY', 'sk-ant-...')

// ============================================================
// メインエントリ: DriveからPDFを選択してインポート
// ============================================================
function importLineupFromDrive() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    '📄 機種販売表インポート',
    'GoogleドライブのPDFファイルIDを入力してください\n（DriveのURLの /d/[ここ]/view 部分）',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (response.getSelectedButton() !== ui.Button.OK) return;
  
  var fileId = response.getResponseText().trim();
  if (!fileId) { ui.alert('ファイルIDが入力されていません'); return; }
  
  importLineupFromFileId(fileId);
}

/**
 * ファイルIDを直接指定してインポート（自動実行・API連携用）
 * @param {string} fileId - GoogleドライブのファイルID
 */
function importLineupFromFileId(fileId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi ? SpreadsheetApp.getUi() : null;
  
  try {
    Logger.log('📄 PDFインポート開始: ' + fileId);
    
    // PDFファイルを取得
    var file = DriveApp.getFileById(fileId);
    var fileName = file.getName();
    Logger.log('ファイル名: ' + fileName);
    
    // Claude APIで解析するか、GASネイティブ解析か
    var parsedModels;
    if (USE_CLAUDE_API) {
      parsedModels = _parseWithClaudeAPI(file);
    } else {
      parsedModels = _parseWithGasNative(file);
    }
    
    if (!parsedModels || parsedModels.length === 0) {
      throw new Error('機種データを抽出できませんでした');
    }
    
    Logger.log('抽出機種数: ' + parsedModels.length);
    
    // スプレッドシートに書き込む
    var result = _writeToSheets(parsedModels, ss);
    
    // 結果レポート
    var msg = '✅ インポート完了\n\n' +
      'ファイル: ' + fileName + '\n' +
      '抽出機種数: ' + parsedModels.length + '\n' +
      '新規登録: ' + result.new + ' 機種\n' +
      '更新: ' + result.updated + ' 機種\n' +
      'スキップ（完了済）: ' + result.skipped + ' 機種\n\n' +
      '「機種マスタ」シートと「基板進捗マスタ」シートを確認してください';
    
    Logger.log(msg);
    if (ui) ui.alert(msg);
    
    return result;
    
  } catch(e) {
    var errMsg = '❌ インポートエラー: ' + e.message;
    Logger.log(errMsg);
    if (ui) ui.alert(errMsg);
    throw e;
  }
}

// ============================================================
// Claude API を使った高精度PDF解析
// ============================================================
function _parseWithClaudeAPI(file) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY') || CLAUDE_API_KEY;
  if (!apiKey) throw new Error('Claude APIキーが設定されていません。\nPropertiesService.getScriptProperties().setProperty("CLAUDE_API_KEY", "sk-ant-...") を実行してください');
  
  // PDFをBase64エンコード
  var blob = file.getBlob();
  var base64 = Utilities.base64Encode(blob.getBytes());
  
  var prompt = `以下はぱちんこ機種の「ハードウェア構成ラインナップ」PDFです。
このPDFから以下の情報を機種ごとに抽出してJSON形式で返してください。

抽出項目:
- model_code: 機種コード (例: A85, D61, C46, A87)
- platform: プラットフォーム (例: PF40, PFK25, PFK30)
- main_board: 主制御基板の型番 (例: M2401A, M2003A5)
- liq_board: 液晶制御基板の型番 (例: D2101A, SNB52163A-00)
- if_board: 演出IF基板の型番 (例: E2101B, E2501B, E2503B)
- de_board: 液晶IF基板の型番 (例: DE2101A)
- mfg_start: 量産開始日 (YYYY/MM/DD形式、「5/上」等は空文字)
- deliv_date: 納品日 (YYYY/MM/DD形式、「5/上」等は空文字)
- is_future: 今後の機種かどうか (mfg_startまたはdeliv_dateが空=trueが多い)

注意:
- 括弧付きの機種名（例: D55サブ, A78サブ）も別機種として含めてください
- 「－」「-」は空文字として扱ってください  
- 同じ基板型番の複数バリエーション（代替品など）は最初の型番を採用してください
- 未確定の機種（「-」列）は除外してください

JSONのみ返してください（説明文不要）:
[
  {
    "model_code": "A85",
    "platform": "PFK25",
    "main_board": "M2401A",
    "liq_board": "D2101A",
    "if_board": "E2101B",
    "de_board": "DE2101A",
    "mfg_start": "2026/03/16",
    "deliv_date": "2026/04/19",
    "is_future": false
  }
]`;

  var payload = {
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64
          }
        },
        { type: 'text', text: prompt }
      ]
    }]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  Logger.log('Claude API呼び出し中...');
  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  var result = JSON.parse(response.getContentText());

  if (result.error) throw new Error('Claude API エラー: ' + result.error.message);

  var content = result.content[0].text;
  Logger.log('Claude API レスポンス長: ' + content.length);

  // JSONを抽出してパース
  var jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Claude APIのレスポンスからJSONを抽出できませんでした');

  return JSON.parse(jsonMatch[0]);
}

// ============================================================
// GASネイティブ解析（Claude API不使用 / フォールバック用）
// テキストベースの位置マッピングで抽出
// ============================================================
function _parseWithGasNative(file) {
  // GASはPDFのテキスト抽出が直接できないため
  // DriveAPIでPDFをGoogleドキュメントに変換してからテキスト取得する
  
  Logger.log('GASネイティブ解析: Google Docs変換を使用');
  
  // PDFをGoogleドキュメントとして一時コピー
  var tempFile = Drive.Files.copy(
    { title: '_tmp_lineup_parse', mimeType: MimeType.GOOGLE_DOCS },
    file.getId()
  );
  
  try {
    var doc = DocumentApp.openById(tempFile.id);
    var text = doc.getBody().getText();
    
    // テキストから機種情報をパース
    return _parseTextLayout(text);
    
  } finally {
    // 一時ファイル削除
    DriveApp.getFileById(tempFile.id).setTrashed(true);
  }
}

/**
 * テキストレイアウトから機種情報をパース（位置ベース解析）
 */
function _parseTextLayout(text) {
  var lines = text.split('\n');
  var results = [];
  
  // キーとなる行を特定
  var modelLine1 = '', modelLine2 = '', modelLine3 = '', modelLine4 = '';
  var mainBoardLine = '', liqBoardLine = '', ifBoardLine = '';
  var mfgStartLine = '', delivLine = '';
  
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (l.match(/A72\s+A72W\s+A73/)) { modelLine1 = l; }
    else if (l.match(/C43\s+D54/)) { modelLine2 = l; }
    else if (l.match(/A77\s+A77LT/)) { modelLine3 = l; }
    else if (l.match(/D57C\s+D57D\s+A80/)) { modelLine4 = l; }
    else if (l.match(/M1904B.*D1401C.*E1403C/)) { mainBoardLine = l; }
    else if (l.match(/液晶制御基板.*D1401C/)) { liqBoardLine = l; }
    else if (l.match(/演出IF基板.*E1403C/)) { ifBoardLine = l; }
    else if (l.match(/量産開始/)) { mfgStartLine = l; }
    else if (l.match(/納品[日⽇]/)) { delivLine = l; }
  }
  
  // 各行をトークンに分割
  function parseTokens(line) {
    var tokens = [];
    var re = /(\s+)/g;
    var parts = line.split(/  +/);
    var pos = 0;
    parts.forEach(function(p) {
      var idx = line.indexOf(p, pos);
      if (idx >= 0 && p.trim()) {
        tokens.push({ pos: idx, val: p.trim() });
        pos = idx + p.length;
      }
    });
    return tokens;
  }
  
  function findNearest(tokens, targetPos, tolerance) {
    tolerance = tolerance || 15;
    var best = null, bestDist = 9999;
    tokens.forEach(function(t) {
      var d = Math.abs(t.pos - targetPos);
      if (d < tolerance && d < bestDist) { best = t.val; bestDist = d; }
    });
    return best || '';
  }
  
  // 機種コード → 列位置のマッピング
  var modelPositions = {};
  var MODEL_PATTERN = /^[A-Z]\d{2,}[A-Z0-9a-z\u30A0-\u30FF()]*$/;
  
  [modelLine1, modelLine2, modelLine3, modelLine4].forEach(function(ml) {
    if (!ml) return;
    parseTokens(ml).forEach(function(t) {
      var clean = t.val.replace(/[()]/g, '');
      if (MODEL_PATTERN.test(clean) && !modelPositions[clean]) {
        modelPositions[clean] = t.pos;
      }
    });
  });
  
  var mainTokens = parseTokens(mainBoardLine);
  var liqTokens  = parseTokens(liqBoardLine);
  var ifTokens   = parseTokens(ifBoardLine);
  var mfgTokens  = parseTokens(mfgStartLine);
  var delivTokens = parseTokens(delivLine);
  
  Object.keys(modelPositions).forEach(function(code) {
    var pos = modelPositions[code];
    
    function clean(v) {
      if (!v || v === '－' || v === '-' || v === '—') return '';
      return v;
    }
    
    // 日付フォーマット: "YYYY/MM/DD"か空文字
    function formatDate(v) {
      v = clean(v);
      if (!v) return '';
      var m = v.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (m) return Utilities.formatDate(new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3])), 'Asia/Tokyo', 'yyyy/MM/dd');
      return ''; // 「5/上」等は空文字
    }
    
    var mainBoard = clean(findNearest(mainTokens, pos));
    // M基板のIDをクリーンアップ（括弧内の注記を除く）
    var mainBoardClean = mainBoard.match(/M\d{4}[A-Z0-9]*/);
    mainBoardClean = mainBoardClean ? mainBoardClean[0] : mainBoard;
    
    var liqBoard = clean(findNearest(liqTokens, pos));
    liqBoard = liqBoard.replace(/[（(].*?[)）]/g, '').trim();
    
    var ifBoard = clean(findNearest(ifTokens, pos));
    ifBoard = ifBoard.replace(/Ｅ/g, 'E').replace(/[（(].*?[)）]/g, '').trim();
    
    var mfgDate = formatDate(findNearest(mfgTokens, pos));
    var delivDate = formatDate(findNearest(delivTokens, pos));
    
    results.push({
      model_code:  code,
      platform:    '',  // プラットフォームは別行解析が必要
      main_board:  mainBoardClean,
      liq_board:   liqBoard,
      if_board:    ifBoard,
      de_board:    '',
      mfg_start:   mfgDate,
      deliv_date:  delivDate,
      is_future:   !mfgDate && !delivDate
    });
  });
  
  return results;
}

// ============================================================
// スプレッドシートへの書き込み
// ============================================================
function _writeToSheets(models, ss) {
  var today = new Date();
  var result = { new: 0, updated: 0, skipped: 0 };
  
  // ---- 機種マスタシートへ書き込み ----
  var modelSheet = ss.getSheetByName(WF_SHEETS.MODELS);
  if (!modelSheet) {
    Logger.log('機種マスタシートが見つかりません。initSunDenshiWorkflow() を実行してください');
  } else {
    var existingModels = {};
    if (modelSheet.getLastRow() > 1) {
      var existData = modelSheet.getRange(2, 1, modelSheet.getLastRow() - 1, 6).getValues();
      existData.forEach(function(r) { if (r[0]) existingModels[r[0]] = true; });
    }
    
    models.forEach(function(m) {
      if (!existingModels[m.model_code]) {
        modelSheet.appendRow([
          m.model_code,
          m.model_code + '型遊技機',  // 機種名（後で修正可能）
          '',                           // 顧客名
          m.deliv_date || m.mfg_start || '',  // 販売予定時期
          today,
          'PDFインポート: ' + (m.platform || '') + ' ' + (m.main_board || '')
        ]);
      }
    });
  }
  
  // ---- 基板進捗マスタへ書き込み ----
  var boardSheet = ss.getSheetByName(WF_SHEETS.BOARDS);
  if (!boardSheet) {
    Logger.log('基板進捗マスタシートが見つかりません');
    return result;
  }
  
  // 既存データのキー（機種コード+基板ID）を収集
  var existingKeys = {};
  if (boardSheet.getLastRow() > 1) {
    var existBoardData = boardSheet.getRange(2, 1, boardSheet.getLastRow() - 1, 22).getValues();
    existBoardData.forEach(function(r) {
      var key = r[BP_COLS.MODEL_CODE - 1] + '_' + r[BP_COLS.BOARD_ID - 1];
      existingKeys[key] = {
        rowStatus: r[BP_COLS.STATUS - 1],
        rowDeliv:  r[BP_COLS.DELIVERY_DATE - 1]
      };
    });
  }
  
  // 基板種別ごとの型番 → 種別マッピング
  var boardTypeMap = _getBoardTypeMap();
  
  // 各機種の基板をループ
  models.forEach(function(m) {
    var boardsToRegister = _extractBoardsFromModel(m, boardTypeMap);
    
    boardsToRegister.forEach(function(board) {
      var key = m.model_code + '_' + board.boardId;
      
      if (existingKeys[key]) {
        // 既存レコード
        var existing = existingKeys[key];
        if (existing.rowStatus === '完了') {
          result.skipped++;
          return;
        }
        // 納品日が変更された場合は更新
        if (m.deliv_date && existing.rowDeliv !== m.deliv_date) {
          _updateDeliveryInSheet(boardSheet, m.model_code, board.boardId, m.deliv_date);
          result.updated++;
        } else {
          result.skipped++;
        }
      } else {
        // 新規登録
        var delivDate = m.deliv_date ? new Date(m.deliv_date.replace(/\//g, '-')) : '';
        var slaDeadline = delivDate || '';
        
        // フロー種別の判定（主制御基板が過去のもの→既存流用 / 新しいもの→判断が必要）
        var flowType = _judgeFlowType(board.boardId, m);
        
        // 進捗ID採番
        var lastRow = boardSheet.getLastRow();
        var progressId = 'SD-' + Utilities.formatDate(today, 'Asia/Tokyo', 'yyyyMMdd') + '-' + String(lastRow).padStart(4, '0');
        
        // フロー定義の最初のフェーズ・ステップ
        var flowDef = WORKFLOW_DEFS[flowType];
        var firstPhase = flowDef.phases[0];
        var firstStep  = firstPhase.steps[0];
        
        boardSheet.appendRow([
          progressId,
          m.model_code,
          m.model_code + '型遊技機',
          board.boardId,
          board.boardType,
          flowType,
          firstPhase.id,
          firstStep.id,
          firstPhase.dept,
          firstPhase.dept + ' 担当者',
          today,
          slaDeadline,
          delivDate,
          '',            // 注文書番号（後で見積管理GASと連携）
          '',            // 見積番号
          '進行中',
          '中',
          '',            // ロット番号
          '',            // QC判定
          today,
          today,
          'PDFインポート自動登録 | PF:' + (m.platform||'') + ' | 量産開始:' + (m.mfg_start||'未定')
        ]);
        
        result.new++;
      }
    });
  });
  
  Logger.log('書き込み完了: 新規=' + result.new + ' 更新=' + result.updated + ' スキップ=' + result.skipped);
  return result;
}

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * 基板型番 → 基板種別マッピング
 */
function _getBoardTypeMap() {
  return {
    'M': 'M基板（主制御）',
    'D': 'D基板（液晶制御）',
    'E': 'E基板（演出IF）',
    'DE': 'DE基板（液晶IF）',
    'L': 'L基板（演出制御）',
    'S': 'S基板',
    'SNB': 'SNB基板（液晶制御・新型）',
  };
}

/**
 * モデルデータから登録すべき基板リストを生成
 */
function _extractBoardsFromModel(model, boardTypeMap) {
  var boards = [];
  
  var boardFields = [
    { key: 'main_board', prefix: 'M', type: 'M基板' },
    { key: 'liq_board',  prefix: 'D', type: 'D基板' },
    { key: 'if_board',   prefix: 'E', type: 'E基板' },
    { key: 'de_board',   prefix: 'DE', type: 'DE基板' },
  ];
  
  boardFields.forEach(function(bf) {
    var boardId = (model[bf.key] || '').trim();
    if (!boardId || boardId === '' || boardId === '—') return;
    
    // 型番をクリーンアップ（括弧内の注記除去）
    boardId = boardId.replace(/[（(].*?[)）]/g, '').replace(/\s.*$/, '').trim();
    if (!boardId) return;
    
    // SNBは特別扱い
    var boardType = bf.type;
    if (boardId.startsWith('SNB')) boardType = 'D基板（SNB新型）';
    if (boardId.startsWith('L')) boardType = 'L基板（演出制御）';
    
    // 重複チェック
    var isDup = boards.some(function(b) { return b.boardId === boardId; });
    if (!isDup) boards.push({ boardId: boardId, boardType: boardType });
  });
  
  return boards;
}

/**
 * フロー種別の自動判定
 * - 基板型番が既存BOMマスタにある → 既存流用
 * - ない / 新しいバージョン番号 → 新規設計または既存流用（デフォルト）
 */
function _judgeFlowType(boardId, model) {
  // 簡易判定: M24xx以降の新型は新規設計の可能性高い
  // M2401A, M2422B, M2503A など2024年以降設計
  if (boardId.match(/^M2[4-9]\d{2}/)) {
    // ただし既に量産実績がある（mfg_startが過去）なら既存流用
    if (model.mfg_start) {
      var mfgDate = new Date(model.mfg_start.replace(/\//g, '-'));
      if (mfgDate < new Date()) return '既存流用';
    }
    return '新規設計';
  }
  // それ以外は基本的に既存流用（7割以上という実態に合わせる）
  return '既存流用';
}

/**
 * 既存行の納品日を更新
 */
function _updateDeliveryInSheet(sheet, modelCode, boardId, delivDate) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][BP_COLS.MODEL_CODE - 1]) === String(modelCode) &&
        String(data[i][BP_COLS.BOARD_ID - 1]) === String(boardId)) {
      sheet.getRange(i + 1, BP_COLS.DELIVERY_DATE).setValue(new Date(delivDate.replace(/\//g, '-')));
      sheet.getRange(i + 1, BP_COLS.UPDATED_AT).setValue(new Date());
      Logger.log('納品日更新: ' + modelCode + '/' + boardId + ' → ' + delivDate);
      return;
    }
  }
}

// ============================================================
// Drive上の特定フォルダを監視して自動インポート
// 「機種販売表」フォルダに新しいPDFが追加されたら自動実行
// ============================================================

var LINEUP_FOLDER_NAME = '機種販売表';  // 監視するフォルダ名

function autoImportFromLineupFolder() {
  // フォルダを検索
  var folders = DriveApp.getFoldersByName(LINEUP_FOLDER_NAME);
  if (!folders.hasNext()) {
    Logger.log('フォルダ「' + LINEUP_FOLDER_NAME + '」が見つかりません');
    return;
  }
  
  var folder = folders.next();
  
  // 最近24時間以内に追加されたPDFを処理
  var oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  var files = folder.getFilesByType(MimeType.PDF);
  
  var processed = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated() >= oneDayAgo) {
      Logger.log('新しいPDFを検出: ' + f.getName());
      try {
        importLineupFromFileId(f.getId());
        processed++;
      } catch(e) {
        Logger.log('インポートエラー: ' + f.getName() + ' - ' + e.message);
      }
    }
  }
  
  if (processed > 0) {
    Logger.log(processed + '件のPDFをインポートしました');
  } else {
    Logger.log('新しいPDFはありませんでした');
  }
}

/**
 * フォルダ監視トリガーを設定（毎朝7時に実行）
 */
function setupImportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'autoImportFromLineupFolder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autoImportFromLineupFolder')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();
  Logger.log('✅ 自動インポートトリガー設定完了（毎朝7時）');
}

// ============================================================
// テスト実行（ダミーデータで動作確認）
// ============================================================
function testImportWithSampleData() {
  // 実際のPDF解析結果のサンプル（今回のPDFから抽出したもの）
  var sampleData = [
    { model_code: 'A85',  platform: 'PFK25', main_board: 'M2401A',  liq_board: 'D2101A', if_board: 'E2101B', de_board: 'DE2101A', mfg_start: '2026/03/16', deliv_date: '2026/04/19', is_future: false },
    { model_code: 'A85B', platform: 'PFK25', main_board: 'M2401A',  liq_board: 'D2101A', if_board: 'E2101B', de_board: 'DE2101A', mfg_start: '2026/03/16', deliv_date: '2026/04/19', is_future: false },
    { model_code: 'A85C', platform: 'PFK25/PF45', main_board: 'M2401A', liq_board: 'D2101A', if_board: 'E2101B', de_board: '', mfg_start: '2026/04/13', deliv_date: '2026/05/10', is_future: false },
    { model_code: 'A86',  platform: 'PFK25', main_board: 'M2422B',  liq_board: 'D2101A', if_board: 'E2101B', de_board: '', mfg_start: '2026/04/13', deliv_date: '2026/05/10', is_future: false },
    { model_code: 'A86B', platform: 'PFK25', main_board: 'M2422B',  liq_board: 'D2101A', if_board: 'E2101B', de_board: '', mfg_start: '2026/07/07', deliv_date: '2026/08/02', is_future: false },
    { model_code: 'D61',  platform: 'PFK25', main_board: 'M2422B',  liq_board: 'D2101A', if_board: 'E2101B', de_board: '', mfg_start: '2026/07/07', deliv_date: '2026/08/02', is_future: false },
    { model_code: 'C47',  platform: 'PFK25', main_board: 'M2401A',  liq_board: 'D2101A', if_board: 'E2101B', de_board: '', mfg_start: '2026/08/24', deliv_date: '2026/10/04', is_future: false },
    { model_code: 'A87',  platform: 'PFK30', main_board: 'M2503A',  liq_board: 'SNB52163A-00', if_board: 'E2501B', de_board: '', mfg_start: '2026/08/24', deliv_date: '2026/10/04', is_future: false },
    { model_code: 'A88',  platform: 'PFK30', main_board: 'M2503A',  liq_board: 'D2101A', if_board: 'E2503B', de_board: '', mfg_start: '', deliv_date: '', is_future: true },
    { model_code: 'D62',  platform: 'PFK30', main_board: 'M2503A',  liq_board: 'D2101A', if_board: 'E2503B', de_board: '', mfg_start: '', deliv_date: '', is_future: true },
    { model_code: 'A89',  platform: 'PFK30', main_board: 'M2503A',  liq_board: 'D2101A', if_board: 'E2503B', de_board: '', mfg_start: '', deliv_date: '', is_future: true },
    { model_code: 'D63',  platform: 'PFK30', main_board: 'M2503A',  liq_board: 'SNB52163A-00', if_board: 'E2501B', de_board: '', mfg_start: '', deliv_date: '', is_future: true },
    { model_code: 'A90',  platform: 'PFK30', main_board: 'M2503A',  liq_board: 'D2101A', if_board: 'E2503B', de_board: '', mfg_start: '', deliv_date: '', is_future: true },
    { model_code: 'D64',  platform: 'PFK30', main_board: 'M2503A',  liq_board: 'SNB52163A-00', if_board: 'E2501B', de_board: '', mfg_start: '', deliv_date: '', is_future: true },
  ];
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = _writeToSheets(sampleData, ss);
  
  var msg = '✅ テストインポート完了\n新規: ' + result.new + '件 / 更新: ' + result.updated + '件 / スキップ: ' + result.skipped + '件';
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}
