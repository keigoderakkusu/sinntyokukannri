// ============================================================
// 進捗管理システム連携用 追加コード
// mitumorikannri-VR3 の 03_webapp_ap.gs に追記してください
// ============================================================

// ============================================================
// 1. doGet を CORS対応に更新（既存のdoGetを下記で置き換え）
// ============================================================
/*
 既存の doGet() の中に以下の action ルートを追加:
 
 if (e && e.parameter && e.parameter.action) {
   var result = handleApiRequest(e.parameter.action, e.parameter);
   return ContentService.createTextOutput(JSON.stringify(result))
     .setMimeType(ContentService.MimeType.JSON);
 }
*/

// ============================================================
// 2. GETリクエスト対応のAPIルーターを追加
// ============================================================

/**
 * 進捗管理システムからGETリクエストを受け付けるエンドポイント
 * doGet の先頭に追記する（既存コードの前に追加）
 * 
 * 使用例:
 *   ?action=getAll
 *   ?action=boardGetOrders
 *   ?action=updateStatus&mgmtId=M001&newStatus=受注済み
 */
function doGet_WithApiSupport(e) {
  // === CORS対応ヘッダー付きJSON返却用 ===
  if (e && e.parameter && e.parameter.action) {
    var action = e.parameter.action;
    var payload = {};
    
    // パラメータを全部payloadに入れる
    Object.keys(e.parameter).forEach(function(key) {
      if (key !== 'action') {
        try {
          payload[key] = JSON.parse(e.parameter[key]);
        } catch(ex) {
          payload[key] = e.parameter[key];
        }
      }
    });
    
    var result;
    try {
      result = handleApiRequest(action, payload);
    } catch(err) {
      result = { success: false, error: err.message };
    }
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // 通常のUI表示（既存のdoGetロジックをここに）
  // ... 既存コードをここに移動 ...
}

// ============================================================
// 3. handleApiRequest に追加する新アクション
//    既存の switch文の中に下記 case を追加してください
// ============================================================

/*
 switch (action) {
   // 既存のcase...
   
   // === 進捗管理システム連携用 ===
   case 'progressGetAll':       return apiProgressGetAll();
   case 'progressUpdateStatus': return apiProgressUpdateStatus(payload);
   case 'progressGetSummary':   return apiProgressGetSummary();
   
   // 既存: boardGetOrders, getAll, updateStatus は既にあるのでそのまま使用可
 }
*/

// ============================================================
// 4. 進捗管理専用API関数
// ============================================================

/**
 * 進捗管理システム向け: 注文一覧を進捗フロー形式で返す
 */
function apiProgressGetAll() {
  try {
    // 既存のboardGetOrdersを活用
    var ordersResult = apiGetOrdersWithBoardInfo();
    if (!ordersResult.success) return ordersResult;
    
    var items = ordersResult.items.map(function(o) {
      // 進捗ステージの算出
      var stageIndex = _calcProgressStage(o.status);
      var progressPct = _calcProgressPercent(o.status);
      
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
        // 進捗管理フロー用の追加フィールド
        stageIndex:  stageIndex,
        progress:    progressPct,
        dept:        _getDeptByOrderType(o.orderType),
        deadline:    o.deliveryDate || '',
      };
    });
    
    return { success: true, items: items, total: items.length };
  } catch(e) {
    Logger.log('[PROGRESS GET ALL ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * 進捗管理システム向け: ステータスを更新して進捗フロー上のノードを移動
 */
function apiProgressUpdateStatus(p) {
  try {
    if (!p.mgmtId || !p.newStatus) {
      return { success: false, error: 'mgmtId と newStatus が必要です' };
    }
    
    // 既存のupdateStatusを再利用
    var result = _apiUpdateStatus({ mgmtId: p.mgmtId, newStatus: p.newStatus });
    if (!result.success) return result;
    
    // Telegramに通知（既存のchatbot機能があれば）
    try {
      var msg = '📊 進捗更新: ' + (p.orderNo || p.mgmtId) + '\n' +
                'ステータス → ' + p.newStatus + '\n' +
                '更新者: 進捗管理システム';
      // sendTelegram(msg); // 既存のTelegram送信関数があれば有効化
    } catch(te) {
      Logger.log('[TELEGRAM SKIP] ' + te.message);
    }
    
    return {
      success: true,
      mgmtId: p.mgmtId,
      newStatus: p.newStatus,
      stageIndex: _calcProgressStage(p.newStatus),
      progress: _calcProgressPercent(p.newStatus),
      updatedAt: nowJST(),
    };
  } catch(e) {
    Logger.log('[PROGRESS UPDATE STATUS ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * 進捗管理システム向け: サマリー統計
 */
function apiProgressGetSummary() {
  try {
    var ordersResult = apiGetOrdersWithBoardInfo();
    if (!ordersResult.success) return ordersResult;
    
    var items = ordersResult.items;
    var summary = {
      total: items.length,
      byStatus: {},
      totalAmount: 0,
      byOrderType: {},
      avgProgress: 0,
    };
    
    var progressSum = 0;
    items.forEach(function(o) {
      // ステータス別集計
      summary.byStatus[o.status] = (summary.byStatus[o.status] || 0) + 1;
      // 金額集計
      summary.totalAmount += Number(o.orderAmount) || 0;
      // 種別集計
      if (o.orderType) {
        summary.byOrderType[o.orderType] = (summary.byOrderType[o.orderType] || 0) + 1;
      }
      // 進捗率
      progressSum += _calcProgressPercent(o.status);
    });
    
    summary.avgProgress = items.length > 0
      ? Math.round(progressSum / items.length)
      : 0;
    
    return { success: true, summary: summary };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// 5. ヘルパー関数
// ============================================================

/**
 * ステータスから進捗ステージインデックスを算出
 * 進捗管理フロー: 0=作成予定, 1=送信済み, 2=受領確認, 3=受注済み, 7=納品済み
 */
function _calcProgressStage(status) {
  var map = {
    '作成予定':   0,
    '送信済み':   1,
    '受領':       2,
    '受注済み':   3,
    '保留':       0,
    'キャンセル': 0,
    '失注':       0,
    '納品済み':   7,
  };
  return map[status] !== undefined ? map[status] : 0;
}

/**
 * ステータスから進捗パーセントを算出
 */
function _calcProgressPercent(status) {
  var map = {
    '作成予定':   0,
    '送信済み':   25,
    '受領':       50,
    '受注済み':   75,
    '保留':       10,
    'キャンセル': 0,
    '失注':       0,
    '納品済み':   100,
  };
  return map[status] !== undefined ? map[status] : 0;
}

/**
 * 受注種別から担当部署を推定
 */
function _getDeptByOrderType(orderType) {
  if (!orderType) return '営業部';
  var map = {
    '修理':         '修理部',
    '部品交換':     '製造部',
    '点検':         '品質管理',
    'オーバーホール': '製造部',
    '新規':         '営業部',
  };
  return map[orderType] || '営業部';
}

// ============================================================
// 6. セットアップ手順
// ============================================================
/*
【VR3側の設定手順】

1. 上記コードを 03_webapp_ap.gs に追記する

2. doGet 関数の先頭に以下を追加:
   
   // 進捗管理システムからのAPI呼び出し対応
   if (e && e.parameter && e.parameter.action) {
     var action = e.parameter.action;
     var payload = {};
     Object.keys(e.parameter).forEach(function(key) {
       if (key !== 'action') {
         try { payload[key] = JSON.parse(e.parameter[key]); }
         catch(ex) { payload[key] = e.parameter[key]; }
       }
     });
     var result;
     try { result = handleApiRequest(action, payload); }
     catch(err) { result = { success: false, error: err.message }; }
     return ContentService
       .createTextOutput(JSON.stringify(result))
       .setMimeType(ContentService.MimeType.JSON);
   }

3. handleApiRequest の switch 文に以下を追加:
   case 'progressGetAll':       return apiProgressGetAll();
   case 'progressUpdateStatus': return apiProgressUpdateStatus(payload);
   case 'progressGetSummary':   return apiProgressGetSummary();

4. Apps Script の「デプロイ」→「新しいデプロイ」で再デプロイ
   - 種類: ウェブアプリ
   - 実行ユーザー: 自分
   - アクセスユーザー: 全員（または組織内）
   
5. 発行されたWebアプリURLを進捗管理システムの「API URL設定」に入力

【進捗管理システム側の設定手順】

1. 上記ファイル (integrated-flow-system.jsx) をReactプロジェクトに配置

2. GAS_API_URL を実際のWebアプリURLに変更
   const GAS_API_URL = "https://script.google.com/macros/s/XXXXXX/exec";

3. 「VR3から同期」ボタンで接続確認

【APIエンドポイント一覧】

GET ?action=getAll                    → 全注文一覧
GET ?action=boardGetOrders            → 注文+基板情報
GET ?action=progressGetAll            → 進捗フロー用データ
GET ?action=boardGetAnalysis          → 基板分析
GET ?action=updateStatus&mgmtId=X&newStatus=Y → ステータス更新
GET ?page=bom                         → BOMダッシュボード（HTML）
*/
