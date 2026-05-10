// ============================================================
// サン電子株式会社 基板ワークフロー管理システム
// ファイル 3/5: WebApp + アラートエンジン
// ============================================================

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('sd_dashboard');
  // ワークフロー定義をHTMLに埋め込む
  t.WORKFLOW_DEFS = WORKFLOW_DEFS;
  return t.evaluate()
    .setTitle('基板進捗管理 | サン電子')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  var out = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  try {
    var p = JSON.parse(e.postData.contents);
    var res = {};
    switch (p.action) {
      case 'getBoardProgress':   res = sdGetBoardProgress(p.filter || {}); break;
      case 'getModelView':       res = sdGetModelView(p.filter || {}); break;
      case 'getDeptView':        res = sdGetDeptView(p.dept); break;
      case 'getHistory':         res = sdGetHistory(p.progressId); break;
      case 'createBoardProgress':res = sdCreateBoardProgress(p); break;
      case 'advance':            res = sdAdvance(p); break;
      case 'createModel':        res = sdCreateModel(p); break;
      case 'updateBoardStatus':  res = sdUpdateBoardStatus(p); break;
      case 'syncFromMitu':       sdSyncFromMitumorikannri(); res = { success: true }; break;
      default:                   res = { success: false, error: '不明なaction: ' + p.action };
    }
    out.setContent(JSON.stringify(res));
  } catch(e) {
    out.setContent(JSON.stringify({ success: false, error: e.message }));
  }
  return out;
}

// ステータス更新（保留・キャンセル等）
function sdUpdateBoardStatus(params) {
  try {
    var sheet = _getWfSS().getSheetByName(WF_SHEETS.BOARDS);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== String(params.progressId)) continue;
      if (params.status)   sheet.getRange(i+1, BP_COLS.STATUS).setValue(params.status);
      if (params.priority) sheet.getRange(i+1, BP_COLS.PRIORITY).setValue(params.priority);
      if (params.memo)     sheet.getRange(i+1, BP_COLS.MEMO).setValue(params.memo);
      sheet.getRange(i+1, BP_COLS.UPDATED_AT).setValue(new Date());
      _sdWriteHistory({
        progressId: params.progressId,
        modelCode: data[i][BP_COLS.MODEL_CODE - 1],
        boardId: data[i][BP_COLS.BOARD_ID - 1],
        phase: data[i][BP_COLS.CURRENT_PHASE - 1],
        step: data[i][BP_COLS.CURRENT_STEP - 1],
        dept: data[i][BP_COLS.BALL_DEPT - 1],
        actor: params.actor || '担当者',
        action: 'ステータス変更: ' + (params.status || params.priority || ''),
        comment: params.memo || '',
      });
      return { success: true };
    }
    return { success: false, error: '見つかりません' };
  } catch(e) { return { success: false, error: e.message }; }
}

// ============================================================
// SLAアラートエンジン（毎時自動実行）
// ============================================================
function sdCheckSlaAlerts() {
  var settings = _getSettings();
  var warnH   = parseFloat(settings['SLA_WARNING_HOURS']) || 48;
  var dangerH = parseFloat(settings['SLA_DANGER_HOURS']) || 8;
  var stagnantH = parseFloat(settings['STAGNANT_HOURS']) || 72;

  var result = sdGetBoardProgress({ status: '進行中' });
  if (!result.success || !result.items.length) return;

  var cache = _sdGetAlertCache();
  var now = new Date();
  var alerts = [];

  result.items.forEach(function(b) {
    var label = '【' + b.modelCode + '】' + b.boardId + '（' + b.boardType + '）';

    // SLA超過
    if (b.slaStatus === 'overdue') {
      var key = b.progressId + '_over_' + _dateKey(now);
      if (!cache[key]) {
        alerts.push({ level: '🚨 SLA超過', label: label, msg: 'SLA期限を ' + Math.abs(b.hoursToSla) + '時間超過', dept: b.ballDept, step: b.stepLabel, key: key });
      }
    }
    // SLA危険
    else if (b.slaStatus === 'danger') {
      var key2 = b.progressId + '_danger_' + _dateKey(now);
      if (!cache[key2]) {
        alerts.push({ level: '🔥 SLA危険', label: label, msg: 'SLA期限まであと ' + b.hoursToSla + '時間', dept: b.ballDept, step: b.stepLabel, key: key2 });
      }
    }
    // 納品日迫る（3日前）
    if (b.daysToDeliv !== null && b.daysToDeliv <= 3 && b.daysToDeliv >= 0) {
      var key3 = b.progressId + '_deliv3_' + _dateKey(now);
      if (!cache[key3]) {
        alerts.push({ level: '📅 納品日迫る', label: label, msg: '納品まであと ' + b.daysToDeliv + '日（' + b.deliveryDate + '）', dept: b.ballDept, step: b.stepLabel, key: key3 });
      }
    }
    // 滞留検知
    if (b.hoursInPhase >= stagnantH) {
      var key4 = b.progressId + '_stagnant_' + _dateKey(now);
      if (!cache[key4]) {
        alerts.push({ level: '🐢 滞留検知', label: label, msg: b.phaseLabel + ' で ' + b.hoursInPhase + '時間停止中', dept: b.ballDept, step: b.stepLabel, key: key4 });
      }
    }
  });

  if (!alerts.length) { Logger.log('[SD ALERT] アラートなし'); return; }

  var msg = '【サン電子 基板進捗アラート】\n' + _fmtDate(now) + '\n\n' +
    alerts.map(function(a) {
      return a.level + '\n' +
        '基板: ' + a.label + '\n' +
        '状況: ' + a.msg + '\n' +
        'ボール: 【' + a.dept + '】' + a.step;
    }).join('\n\n———\n');

  _sdNotify(msg);

  alerts.forEach(function(a) { cache[a.key] = true; });
  _sdSaveAlertCache(cache);

  // ログ
  var logSheet = _getWfSS().getSheetByName(WF_SHEETS.ALERT_LOG);
  if (logSheet) {
    alerts.forEach(function(a) {
      logSheet.appendRow([now, a.key.split('_')[0], '', '', a.level, a.msg]);
    });
  }
}

function _sdGetAlertCache() {
  try { var r = PropertiesService.getScriptProperties().getProperty('SD_ALERT_CACHE'); return r ? JSON.parse(r) : {}; }
  catch(e) { return {}; }
}

function _sdSaveAlertCache(cache) {
  var cutoff = _dateKey(new Date(Date.now() - 7 * 86400000));
  Object.keys(cache).forEach(function(k) {
    var parts = k.split('_'); var d = parts[parts.length - 1];
    if (d < cutoff) delete cache[k];
  });
  PropertiesService.getScriptProperties().setProperty('SD_ALERT_CACHE', JSON.stringify(cache));
}
