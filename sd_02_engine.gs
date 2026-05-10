// ============================================================
// サン電子株式会社 基板ワークフロー管理システム
// ファイル 2/5: 進捗管理エンジン
// ============================================================

// ============================================================
// 機種登録
// ============================================================
function sdCreateModel(params) {
  try {
    var ss = _getWfSS();
    var sheet = ss.getSheetByName(WF_SHEETS.MODELS);
    var now = new Date();
    sheet.appendRow([
      params.modelCode, params.modelName, params.clientName,
      params.salesPlan || '', now, params.memo || ''
    ]);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// ============================================================
// 基板進捗登録（機種×基板ごとにフローを起動）
// ============================================================
/**
 * @param {Object} params
 *   modelCode, modelName, clientName,
 *   boardId, boardType, flowType（'新規設計' or '既存流用'）,
 *   actor, priority, quoteNo, orderNo, deliveryDate, memo
 */
function sdCreateBoardProgress(params) {
  try {
    var ss = _getWfSS();
    var sheet = ss.getSheetByName(WF_SHEETS.BOARDS);

    var flowDef = WORKFLOW_DEFS[params.flowType];
    if (!flowDef) return { success: false, error: '不明なフロー種別: ' + params.flowType };

    var firstPhase = flowDef.phases[0];
    var firstStep  = firstPhase.steps[0];

    // 採番
    var lastRow = sheet.getLastRow();
    var today = _dateKey(new Date());
    var progressId = 'SD-' + today + '-' + String(lastRow).padStart(4, '0');

    var now = new Date();
    // SLAは納品予定日 or フェーズSLAのうち厳しい方
    var slaByPhase = new Date(now.getTime() + firstPhase.sla_hours * 3600000);
    var slaDeadline = params.deliveryDate
      ? (new Date(params.deliveryDate) < slaByPhase ? new Date(params.deliveryDate) : slaByPhase)
      : slaByPhase;

    sheet.appendRow([
      progressId,
      params.modelCode || '',
      params.modelName || '',
      params.boardId || '',
      params.boardType || '',
      params.flowType,
      firstPhase.id,
      firstStep.id,
      firstPhase.dept,
      firstStep.dept + ' 担当者',
      now,
      slaDeadline,
      params.deliveryDate || '',
      params.orderNo || '',
      params.quoteNo || '',
      '進行中',
      params.priority || '中',
      '',
      '',
      now,
      now,
      params.memo || '',
    ]);

    _sdWriteHistory({
      progressId: progressId,
      modelCode:  params.modelCode,
      boardId:    params.boardId,
      phase:      firstPhase.label,
      step:       firstStep.label,
      dept:       firstPhase.dept,
      actor:      params.actor || 'システム',
      action:     'フロー開始（' + params.flowType + '）',
      comment:    params.memo || '',
    });

    _sdNotify(
      '🆕 基板フロー開始\n' +
      '機種: ' + params.modelCode + ' ' + params.modelName + '\n' +
      '基板: ' + params.boardId + '（' + params.boardType + '）\n' +
      'フロー: ' + params.flowType + '\n' +
      '最初のボール: 【' + firstPhase.dept + '】' + firstStep.label + '\n' +
      '納品予定: ' + (params.deliveryDate ? _fmtDateShort(params.deliveryDate) : '未定')
    );

    return { success: true, progressId: progressId };
  } catch(e) {
    Logger.log('[SD CREATE ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
// ステップ完了・ボール移動
// ============================================================
function sdAdvance(params) {
  // params: { progressId, actor, comment, qcResult, lotNumber }
  try {
    var ss = _getWfSS();
    var sheet = ss.getSheetByName(WF_SHEETS.BOARDS);
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== String(params.progressId)) continue;

      var row = data[i];
      var flowType    = row[BP_COLS.FLOW_TYPE - 1];
      var curPhaseId  = row[BP_COLS.CURRENT_PHASE - 1];
      var curStepId   = row[BP_COLS.CURRENT_STEP - 1];
      var modelCode   = row[BP_COLS.MODEL_CODE - 1];
      var boardId     = row[BP_COLS.BOARD_ID - 1];
      var delivDate   = row[BP_COLS.DELIVERY_DATE - 1];

      var flowDef = WORKFLOW_DEFS[flowType];
      if (!flowDef) return { success: false, error: 'フロー定義なし' };

      var phase = flowDef.phases.find(function(p) { return p.id === curPhaseId; });
      if (!phase) return { success: false, error: 'フェーズ定義なし: ' + curPhaseId };

      var stepIdx = phase.steps.findIndex(function(s) { return s.id === curStepId; });
      var now = new Date();
      var phaseStarted = row[BP_COLS.PHASE_STARTED - 1];
      var elapsedH = phaseStarted ? _hoursElapsed(phaseStarted) : 0;

      // QC不合格の場合は差し戻し
      if (params.qcResult === '不合格') {
        sheet.getRange(i + 1, BP_COLS.STATUS).setValue('NG差し戻し');
        sheet.getRange(i + 1, BP_COLS.QC_RESULT).setValue('不合格');
        sheet.getRange(i + 1, BP_COLS.UPDATED_AT).setValue(now);
        _sdWriteHistory({
          progressId: params.progressId, modelCode: modelCode, boardId: boardId,
          phase: phase.label, step: phase.steps[stepIdx].label,
          dept: phase.dept, actor: params.actor, action: '❌ QC不合格 → 差し戻し',
          comment: params.comment || '',
        });
        _sdNotify(
          '❌ QC不合格・差し戻し\n機種: ' + modelCode + ' 基板: ' + boardId + '\n' +
          '検査者: ' + params.actor + '\nコメント: ' + (params.comment || '')
        );
        return { success: true, result: 'ng_returned' };
      }

      // ロット番号登録
      if (params.lotNumber) {
        sheet.getRange(i + 1, BP_COLS.LOT_NUMBER).setValue(params.lotNumber);
      }
      if (params.qcResult) {
        sheet.getRange(i + 1, BP_COLS.QC_RESULT).setValue(params.qcResult);
      }

      // 現ステップ履歴記録
      _sdWriteHistory({
        progressId: params.progressId, modelCode: modelCode, boardId: boardId,
        phase: phase.label, step: phase.steps[stepIdx].label,
        dept: phase.dept, actor: params.actor,
        action: '✅ ステップ完了', duration: elapsedH.toFixed(1),
        comment: params.comment || '',
      });

      // 次ステップ or 次フェーズ計算
      var nextPhaseId, nextStepId, nextDept, nextSla;
      var isCompleted = false;

      if (stepIdx < phase.steps.length - 1) {
        // 同フェーズ内の次ステップ
        var nextStep = phase.steps[stepIdx + 1];
        nextPhaseId = curPhaseId;
        nextStepId  = nextStep.id;
        nextDept    = nextStep.dept;
        nextSla     = row[BP_COLS.SLA_DEADLINE - 1]; // SLAはフェーズ単位
      } else {
        // 次フェーズへ
        var phaseIdx = flowDef.phases.findIndex(function(p) { return p.id === curPhaseId; });
        if (phaseIdx >= flowDef.phases.length - 1) {
          // 全フェーズ完了
          sheet.getRange(i + 1, BP_COLS.STATUS).setValue('完了');
          sheet.getRange(i + 1, BP_COLS.CURRENT_PHASE).setValue('完了');
          sheet.getRange(i + 1, BP_COLS.CURRENT_STEP).setValue('完了');
          sheet.getRange(i + 1, BP_COLS.BALL_DEPT).setValue('—');
          sheet.getRange(i + 1, BP_COLS.BALL_OWNER).setValue('—');
          sheet.getRange(i + 1, BP_COLS.UPDATED_AT).setValue(now);
          _sdWriteHistory({
            progressId: params.progressId, modelCode: modelCode, boardId: boardId,
            phase: '完了', step: '完了', dept: phase.dept, actor: params.actor,
            action: '🎉 全フロー完了', comment: params.comment || '',
          });
          _sdNotify('🎉 基板フロー完了\n機種: ' + modelCode + ' 基板: ' + boardId + '\n完了者: ' + params.actor);
          return { success: true, completed: true };
        }
        var nextPhase = flowDef.phases[phaseIdx + 1];
        nextPhaseId = nextPhase.id;
        nextStepId  = nextPhase.steps[0].id;
        nextDept    = nextPhase.steps[0].dept;
        // 次フェーズSLAと納品予定日の厳しい方
        var slaByNextPhase = new Date(now.getTime() + nextPhase.sla_hours * 3600000);
        nextSla = delivDate && new Date(delivDate) < slaByNextPhase ? new Date(delivDate) : slaByNextPhase;
      }

      // マスタ更新
      sheet.getRange(i + 1, BP_COLS.CURRENT_PHASE).setValue(nextPhaseId);
      sheet.getRange(i + 1, BP_COLS.CURRENT_STEP).setValue(nextStepId);
      sheet.getRange(i + 1, BP_COLS.BALL_DEPT).setValue(nextDept);
      sheet.getRange(i + 1, BP_COLS.BALL_OWNER).setValue(nextDept + ' 担当者');
      sheet.getRange(i + 1, BP_COLS.PHASE_STARTED).setValue(now);
      sheet.getRange(i + 1, BP_COLS.SLA_DEADLINE).setValue(nextSla);
      sheet.getRange(i + 1, BP_COLS.UPDATED_AT).setValue(now);

      // 次担当者への通知
      var nextPhaseConf = flowDef.phases.find(function(p) { return p.id === nextPhaseId; });
      var nextStepConf  = nextPhaseConf ? nextPhaseConf.steps.find(function(s) { return s.id === nextStepId; }) : null;
      _sdNotify(
        '🔔 ボール移動\n機種: ' + modelCode + ' 基板: ' + boardId + '\n' +
        '次の担当: 【' + nextDept + '】\n' +
        'ステップ: ' + (nextStepConf ? nextStepConf.label : nextStepId) + '\n' +
        'SLA期限: ' + _fmtDate(nextSla)
      );

      return { success: true, nextPhase: nextPhaseId, nextStep: nextStepId, nextDept: nextDept };
    }
    return { success: false, error: '進捗ID ' + params.progressId + ' が見つかりません' };
  } catch(e) {
    Logger.log('[SD ADVANCE ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
// データ取得
// ============================================================

function sdGetBoardProgress(filter) {
  try {
    var ss = _getWfSS();
    var sheet = ss.getSheetByName(WF_SHEETS.BOARDS);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, items: [] };

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 22).getValues();
    var now = new Date();

    var items = data.filter(function(r) { return r[0]; }).map(function(r) {
      var slaDeadline  = r[BP_COLS.SLA_DEADLINE - 1]  ? new Date(r[BP_COLS.SLA_DEADLINE - 1]) : null;
      var delivDate    = r[BP_COLS.DELIVERY_DATE - 1] ? new Date(r[BP_COLS.DELIVERY_DATE - 1]) : null;
      var phaseStarted = r[BP_COLS.PHASE_STARTED - 1] ? new Date(r[BP_COLS.PHASE_STARTED - 1]) : null;
      var hoursInPhase = phaseStarted ? (now - phaseStarted) / 3600000 : 0;
      var hoursToSla   = slaDeadline ? (slaDeadline - now) / 3600000 : null;
      var daysToDeliv  = delivDate   ? (delivDate - now) / 86400000  : null;

      var settings = _getSettings();
      var warnH = parseFloat(settings['SLA_WARNING_HOURS']) || 48;
      var dangerH = parseFloat(settings['SLA_DANGER_HOURS']) || 8;

      var slaStatus = 'ok';
      if (hoursToSla !== null) {
        if (hoursToSla < 0)       slaStatus = 'overdue';
        else if (hoursToSla < dangerH) slaStatus = 'danger';
        else if (hoursToSla < warnH)   slaStatus = 'warning';
      }

      var flowType = r[BP_COLS.FLOW_TYPE - 1];
      var flowDef  = WORKFLOW_DEFS[flowType];
      var totalPhases  = flowDef ? flowDef.phases.length : 0;
      var curPhaseId   = r[BP_COLS.CURRENT_PHASE - 1];
      var phaseProgress = 0;
      if (flowDef && curPhaseId !== '完了') {
        var idx = flowDef.phases.findIndex(function(p) { return p.id === curPhaseId; });
        phaseProgress = idx >= 0 ? idx + 1 : totalPhases;
      } else if (curPhaseId === '完了') {
        phaseProgress = totalPhases;
      }

      // 現在フェーズの表示ラベル
      var phaseLabel = curPhaseId;
      if (flowDef) {
        var pConf = flowDef.phases.find(function(p) { return p.id === curPhaseId; });
        if (pConf) phaseLabel = pConf.label;
      }
      var stepLabel = r[BP_COLS.CURRENT_STEP - 1];
      if (flowDef) {
        var phConf = flowDef.phases.find(function(p) { return p.id === curPhaseId; });
        if (phConf) {
          var stConf = phConf.steps.find(function(s) { return s.id === stepLabel; });
          if (stConf) stepLabel = stConf.label;
        }
      }

      return {
        progressId:   r[BP_COLS.ID - 1],
        modelCode:    r[BP_COLS.MODEL_CODE - 1],
        modelName:    r[BP_COLS.MODEL_NAME - 1],
        boardId:      r[BP_COLS.BOARD_ID - 1],
        boardType:    r[BP_COLS.BOARD_TYPE - 1],
        flowType:     flowType,
        currentPhase: curPhaseId,
        phaseLabel:   phaseLabel,
        currentStep:  r[BP_COLS.CURRENT_STEP - 1],
        stepLabel:    stepLabel,
        ballDept:     r[BP_COLS.BALL_DEPT - 1],
        ballOwner:    r[BP_COLS.BALL_OWNER - 1],
        phaseStarted: phaseStarted ? _fmtDate(phaseStarted) : '',
        slaDeadline:  slaDeadline  ? _fmtDateShort(slaDeadline) : '',
        deliveryDate: delivDate    ? _fmtDateShort(delivDate) : '',
        daysToDeliv:  daysToDeliv  !== null ? Math.round(daysToDeliv) : null,
        orderNo:      r[BP_COLS.ORDER_NO - 1],
        quoteNo:      r[BP_COLS.QUOTE_NO - 1],
        status:       r[BP_COLS.STATUS - 1],
        priority:     r[BP_COLS.PRIORITY - 1],
        lotNumber:    r[BP_COLS.LOT_NUMBER - 1],
        qcResult:     r[BP_COLS.QC_RESULT - 1],
        createdAt:    _fmtDate(r[BP_COLS.CREATED_AT - 1]),
        updatedAt:    _fmtDate(r[BP_COLS.UPDATED_AT - 1]),
        memo:         r[BP_COLS.MEMO - 1],
        slaStatus:    slaStatus,
        hoursInPhase: Math.round(hoursInPhase * 10) / 10,
        hoursToSla:   hoursToSla !== null ? Math.round(hoursToSla) : null,
        phaseProgress:phaseProgress,
        totalPhases:  totalPhases,
      };
    });

    // フィルタ
    filter = filter || {};
    if (filter.status)     items = items.filter(function(i) { return i.status === filter.status; });
    if (filter.dept)       items = items.filter(function(i) { return i.ballDept === filter.dept; });
    if (filter.modelCode)  items = items.filter(function(i) { return i.modelCode === filter.modelCode; });
    if (filter.flowType)   items = items.filter(function(i) { return i.flowType === filter.flowType; });
    if (filter.boardType)  items = items.filter(function(i) { return i.boardType === filter.boardType; });
    if (filter.searchText) {
      var q = filter.searchText.toLowerCase();
      items = items.filter(function(i) {
        return (i.progressId + i.modelCode + i.modelName + i.boardId + i.ballDept).toLowerCase().indexOf(q) >= 0;
      });
    }

    // ソート：優先度→SLA切迫
    var priMap = { '高': 0, '中': 1, '低': 2 };
    var slaMap = { 'overdue': 0, 'danger': 1, 'warning': 2, 'ok': 3 };
    items.sort(function(a, b) {
      var p = (priMap[a.priority] || 1) - (priMap[b.priority] || 1);
      if (p) return p;
      return (slaMap[a.slaStatus] || 3) - (slaMap[b.slaStatus] || 3);
    });

    return { success: true, items: items };
  } catch(e) {
    Logger.log('[SD GET PROGRESS ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

// 機種ビュー（機種コードでグループ化）
function sdGetModelView(filter) {
  var result = sdGetBoardProgress(filter);
  if (!result.success) return result;

  var modelMap = {};
  result.items.forEach(function(item) {
    var key = item.modelCode;
    if (!modelMap[key]) {
      modelMap[key] = {
        modelCode: key,
        modelName: item.modelName,
        boards: [],
        slaWorst: 'ok',
        totalBoards: 0,
        completedBoards: 0,
      };
    }
    modelMap[key].boards.push(item);
    modelMap[key].totalBoards++;
    if (item.status === '完了') modelMap[key].completedBoards++;
    // 最悪のSLA状態を採用
    var slaRank = { overdue: 0, danger: 1, warning: 2, ok: 3 };
    if ((slaRank[item.slaStatus] || 3) < (slaRank[modelMap[key].slaWorst] || 3)) {
      modelMap[key].slaWorst = item.slaStatus;
    }
  });

  return { success: true, models: Object.values(modelMap) };
}

// 部署ビュー（自分の部署に来ているボール）
function sdGetDeptView(dept) {
  return sdGetBoardProgress({ dept: dept, status: '進行中' });
}

// 履歴取得
function sdGetHistory(progressId) {
  try {
    var ss = _getWfSS();
    var sheet = ss.getSheetByName(WF_SHEETS.HISTORY);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, items: [] };
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
    var items = data
      .filter(function(r) { return String(r[0]) === String(progressId); })
      .map(function(r) {
        return {
          progressId: r[0], modelCode: r[1], boardId: r[2],
          phase: r[3], step: r[4], dept: r[5], actor: r[6],
          action: r[7], timestamp: _fmtDate(r[8]), duration: r[9], comment: r[10],
        };
      }).reverse();
    return { success: true, items: items };
  } catch(e) { return { success: false, error: e.message }; }
}

// ---- 履歴書き込み ----
function _sdWriteHistory(p) {
  try {
    var sheet = _getWfSS().getSheetByName(WF_SHEETS.HISTORY);
    if (!sheet) return;
    sheet.appendRow([p.progressId, p.modelCode, p.boardId, p.phase, p.step,
      p.dept, p.actor, p.action, new Date(), p.duration || '', p.comment || '']);
  } catch(e) { Logger.log('[HISTORY ERROR] ' + e.message); }
}

// ============================================================
// 見積管理GAS（mitumorikannri-VR3）との同期
// 注文書の納品日・注文番号を取り込む
// ============================================================
function sdSyncFromMitumorikannri() {
  try {
    var mituSS = _getMituSS();
    if (!mituSS) { Logger.log('[SYNC] 見積管理SSに接続できません'); return; }

    var mgmtSheet = mituSS.getSheetByName('見積提出管理');
    if (!mgmtSheet) { Logger.log('[SYNC] 「見積提出管理」シートが見つかりません'); return; }

    var mituData = mgmtSheet.getDataRange().getValues();
    var mituHeaders = mituData[0];
    var orderNoIdx   = mituHeaders.indexOf('発注書番号');
    var deliveryIdx  = mituHeaders.indexOf('納期');
    var quoteNoIdx   = mituHeaders.indexOf('見積No');
    var statusIdx    = mituHeaders.indexOf('ステータス');

    // 注文書マップ作成（注文書番号 → 納品日）
    var orderMap = {};
    for (var i = 1; i < mituData.length; i++) {
      var oNo = String(mituData[i][orderNoIdx] || '').trim();
      var dDate = mituData[i][deliveryIdx];
      var qNo = String(mituData[i][quoteNoIdx] || '').trim();
      if (oNo && dDate) orderMap[oNo] = { deliveryDate: dDate, quoteNo: qNo };
    }

    // 基板進捗マスタに納品日を反映
    var wfSS = _getWfSS();
    var bpSheet = wfSS.getSheetByName(WF_SHEETS.BOARDS);
    if (!bpSheet || bpSheet.getLastRow() < 2) return;

    var bpData = bpSheet.getDataRange().getValues();
    var updated = 0;
    for (var j = 1; j < bpData.length; j++) {
      var orderNo = String(bpData[j][BP_COLS.ORDER_NO - 1] || '').trim();
      if (!orderNo || !orderMap[orderNo]) continue;

      var newDelivDate = orderMap[orderNo].deliveryDate;
      var currentDelivDate = bpData[j][BP_COLS.DELIVERY_DATE - 1];

      // 変更があった場合のみ更新
      if (!currentDelivDate || new Date(newDelivDate).getTime() !== new Date(currentDelivDate).getTime()) {
        bpSheet.getRange(j + 1, BP_COLS.DELIVERY_DATE).setValue(newDelivDate);
        bpSheet.getRange(j + 1, BP_COLS.UPDATED_AT).setValue(new Date());
        updated++;
      }
    }

    Logger.log('[SYNC] 見積管理GAS同期完了 ' + updated + '件の納品日を更新');
  } catch(e) {
    Logger.log('[SYNC ERROR] ' + e.message);
  }
}

// 通知送信
function _sdNotify(message) {
  var settings = _getSettings();
  if (settings['GOOGLE_CHAT_WEBHOOK'] && settings['GOOGLE_CHAT_WEBHOOK'].indexOf('chat.googleapis.com') >= 0) {
    try {
      UrlFetchApp.fetch(settings['GOOGLE_CHAT_WEBHOOK'], {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ text: message })
      });
    } catch(e) { Logger.log('[GChat] ' + e.message); }
  }
  if (settings['EMAIL_ADDRESSES']) {
    settings['EMAIL_ADDRESSES'].split(',').map(function(s) { return s.trim(); }).filter(Boolean).forEach(function(addr) {
      try { MailApp.sendEmail({ to: addr, subject: '【基板フロー通知】', body: message }); }
      catch(e) { Logger.log('[Email] ' + e.message); }
    });
  }
  if (settings['TELEGRAM_BOT_TOKEN'] && settings['TELEGRAM_CHAT_ID']) {
    try {
      UrlFetchApp.fetch('https://api.telegram.org/bot' + settings['TELEGRAM_BOT_TOKEN'] + '/sendMessage', {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ chat_id: settings['TELEGRAM_CHAT_ID'], text: message })
      });
    } catch(e) { Logger.log('[Telegram] ' + e.message); }
  }
}
