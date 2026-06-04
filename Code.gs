/**
 * 営業進捗管理システム — Google Apps Script webapp
 * https://github.com/keigoderakkusu/sinntyokukannri
 */

/* ============================================================
   WEB APP
============================================================ */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'getForLink') {
    var data = loadData();
    var output = ContentService.createTextOutput(data || '{}');
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('営業進捗管理システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ============================================================
   DATA PERSISTENCE
============================================================ */
function loadData() {
  return PropertiesService.getScriptProperties().getProperty('sinntyoku_state') || null;
}

function saveData(stateJson) {
  PropertiesService.getScriptProperties().setProperty('sinntyoku_state', stateJson);
}

/* ============================================================
   EXTERNAL LINKAGE
============================================================ */
function getLinkageData(url) {
  if (!url) return null;
  try {
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    var res = UrlFetchApp.fetch(url + sep + 'action=getForLink', {
      muteHttpExceptions: true,
      followRedirects: true,
    });
    if (res.getResponseCode() === 200) return res.getContentText();
    return null;
  } catch (e) {
    Logger.log('getLinkageData error: ' + e.message);
    return null;
  }
}

/* ============================================================
   DRIVE FILE UPLOAD
============================================================ */
function uploadFileToDrive(fileName, base64Data, mimeType, machineId) {
  try {
    var FOLDER_NAME = '営業進捗管理_添付ファイル';
    var folders = DriveApp.getFoldersByName(FOLDER_NAME);
    var rootFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);

    var machineFolders = rootFolder.getFoldersByName(machineId);
    var machineFolder = machineFolders.hasNext() ? machineFolders.next() : rootFolder.createFolder(machineId);

    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType, fileName);
    var file = machineFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return JSON.stringify({
      success: true,
      fileId: file.getId(),
      fileName: fileName,
      url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
      uploadedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

function deleteFileFromDrive(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/* ============================================================
   EMAIL NOTIFICATION
============================================================ */

/**
 * [クライアントから呼び出し] 重要変更時にアラートメールを送信
 * @param {string} stateJson - JSON.stringify(state)
 * @param {string} changeDesc - 変更内容の説明
 */
function sendAlertEmail(stateJson, changeDesc) {
  var state = _parseState(stateJson);
  if (!state) return;
  var email = _getNotifyEmail(state);
  if (!email) return;

  var alerts = _checkAlerts(state);
  // 変更内容があるか、アラートがある場合のみ送信
  if (!changeDesc && alerts.length === 0) return;

  MailApp.sendEmail({
    to: email,
    subject: '【営業進捗】' + (changeDesc || 'アラート通知') + ' ' + _fmtDate(new Date()),
    htmlBody: _buildAlertHtml(state, changeDesc, alerts),
  });
  Logger.log('アラートメール送信: ' + email + ' / ' + changeDesc);
}

/**
 * [GASタイマーから自動呼び出し] 毎日朝8時のサマリーメール
 * setupDailyTrigger() を一度実行してトリガーを設定してください
 */
function sendDailySummary() {
  var state = _parseState(loadData());
  if (!state) return;
  var email = _getNotifyEmail(state);
  if (!email) {
    Logger.log('通知先メールアドレス未設定 — 管理コンソールで設定してください');
    return;
  }

  MailApp.sendEmail({
    to: email,
    subject: '【営業進捗】日次サマリー ' + _fmtDate(new Date()),
    htmlBody: _buildDailySummaryHtml(state),
  });
  Logger.log('日次サマリーメール送信: ' + email);
}

/**
 * 毎日8時の自動トリガーをセットアップ
 * GASエディタの「実行」メニューから一度だけ手動実行してください
 */
function setupDailyTrigger() {
  // 既存トリガーをクリア
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDailySummary') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('sendDailySummary')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
  Logger.log('✅ 毎日8時トリガーを設定しました');
}

/** トリガーを削除（通知を停止したい場合） */
function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDailySummary') {
      ScriptApp.deleteTrigger(t);
      Logger.log('トリガーを削除しました');
    }
  });
}

/* ============================================================
   INTERNAL HELPERS
============================================================ */
function _parseState(json) {
  if (!json) return null;
  try { return typeof json === 'string' ? JSON.parse(json) : json; } catch(e) { return null; }
}

function _getNotifyEmail(state) {
  return (state.config && state.config.notifyEmail) ? state.config.notifyEmail.trim() : '';
}

function _fmtDate(d) {
  return d.getFullYear() + '年' + (d.getMonth()+1) + '月' + d.getDate() + '日';
}

var _STAGE_LABELS = {
  collection:'回収', disassembly:'解体', e_inspect:'E基板検査',
  snb_inspect:'SNB基板検査', assembly:'組み立て', delivered:'納品完了',
};
var _PHASE_LABELS = {
  sampleShip:'見本機出荷', prodImpl:'量産実装',
  prodAssy:'量産組立', prodShip:'量産出荷',
};

function _checkAlerts(state) {
  var alerts = [];
  var today = new Date(); today.setHours(0,0,0,0);
  var ids = Object.keys(state.statuses || {});

  // スケジュール警告（7日以内）
  ids.forEach(function(id) {
    var sc = state.schedules && state.schedules[id];
    if (!sc) return;
    Object.keys(_PHASE_LABELS).forEach(function(key) {
      if (!sc[key]) return;
      var d = new Date(sc[key]); d.setHours(0,0,0,0);
      var diff = Math.ceil((d - today) / 86400000);
      if (diff >= 0 && diff <= 7) {
        alerts.push({type:'schedule', id:id, label:_PHASE_LABELS[key], date:sc[key], diff:diff});
      }
    });
  });

  // エコ滞留警告
  var threshold = (state.config && state.config.notifyThreshold) || 50;
  if (state.eco) {
    Object.keys(state.eco).forEach(function(machineId) {
      var eco = state.eco[machineId] || {};
      Object.keys(eco).forEach(function(stage) {
        if (stage !== 'delivered' && (eco[stage] || 0) >= threshold) {
          alerts.push({type:'eco', id:machineId, stage:stage, qty:eco[stage]});
        }
      });
    });
  }

  // マイルストーン警告（見積提出・注文書受領）
  _checkMilestoneAlerts(state, alerts);

  return alerts;
}

function _buildDailySummaryHtml(state) {
  var today = new Date();
  var alerts = _checkAlerts(state);
  var ids = Object.keys(state.statuses || {});

  var cnt = {量産前:0, 量産中:0, 量産終了:0};
  ids.forEach(function(id) { var s = state.statuses[id]; if (cnt[s] !== undefined) cnt[s]++; });

  var ecoTotal = 0;
  if (state.eco) {
    Object.values(state.eco).forEach(function(eco) {
      Object.keys(eco).forEach(function(k) { if (k !== 'delivered') ecoTotal += (eco[k]||0); });
    });
  }

  var schedAlerts = alerts.filter(function(a){return a.type==='schedule';});
  var ecoAlerts   = alerts.filter(function(a){return a.type==='eco';});
  var msAlerts    = alerts.filter(function(a){return a.type==='milestone';});

  var schedRows = schedAlerts.map(function(a) {
    return '<tr>' +
      '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;">' + a.id + '</td>' +
      '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;">' + a.label + '</td>' +
      '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;font-family:monospace;">' + a.date + '</td>' +
      '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;font-weight:700;color:' +
        (a.diff===0?'#dc2626':a.diff<=3?'#d97706':'#2563eb') + ';">' +
        (a.diff===0?'🔴 本日':a.diff<=3?'🟠 '+a.diff+'日後':'🔵 '+a.diff+'日後') + '</td>' +
    '</tr>';
  }).join('');

  var ecoRows = ecoAlerts.map(function(a) {
    return '<tr>' +
      '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;">' + a.id + '</td>' +
      '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;">' + (_STAGE_LABELS[a.stage]||a.stage) + '</td>' +
      '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;font-weight:700;color:#2563eb;">' + a.qty + '台</td>' +
    '</tr>';
  }).join('');

  var appUrl = (state.config && state.config.appUrl) || '';

  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6fb;font-family:sans-serif;">' +
    '<div style="max-width:600px;margin:24px auto;">' +
    // Header
    '<div style="background:#0f1729;padding:20px 24px;border-radius:10px 10px 0 0;">' +
      '<div style="font-size:16px;font-weight:700;color:#fff;">📊 営業進捗管理システム</div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.55);margin-top:4px;">日次サマリー — ' + _fmtDate(today) + '</div>' +
    '</div>' +
    // Summary cards
    '<div style="background:#fff;padding:20px 24px;border-left:1px solid #e8eaed;border-right:1px solid #e8eaed;">' +
      '<table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:20px;"><tr>' +
        '<td style="background:#eff6ff;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:26px;font-weight:700;color:#2563eb;">' + cnt['量産中'] + '</div><div style="font-size:10px;color:#64748b;">量産中</div></td>' +
        '<td style="background:#fffbeb;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:26px;font-weight:700;color:#d97706;">' + cnt['量産前'] + '</div><div style="font-size:10px;color:#64748b;">量産前</div></td>' +
        '<td style="background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:26px;font-weight:700;color:#16a34a;">' + cnt['量産終了'] + '</div><div style="font-size:10px;color:#64748b;">量産終了</div></td>' +
        '<td style="background:#f0f9ff;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:26px;font-weight:700;color:#0891b2;">' + ecoTotal + '</div><div style="font-size:10px;color:#64748b;">エコ処理中</div></td>' +
      '</tr></table>' +
      // Schedule alerts
      (schedAlerts.length > 0 ?
        '<div style="font-size:13px;font-weight:700;color:#dc2626;margin-bottom:8px;">⚠️ 直近7日スケジュール警告 (' + schedAlerts.length + '件)</div>' +
        '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12px;">' +
          '<tr style="background:#f8fafc;"><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">機種</th><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">工程</th><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">日程</th><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">残り</th></tr>' +
          schedRows +
        '</table>'
        : '<p style="color:#16a34a;font-size:13px;margin-bottom:20px;">✅ 直近7日以内のスケジュール警告なし</p>'
      ) +
      // ECO alerts
      (ecoAlerts.length > 0 ?
        '<div style="font-size:13px;font-weight:700;color:#d97706;margin-bottom:8px;">⚠️ エコフロー滞留警告 (' + ecoAlerts.length + '件)</div>' +
        '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12px;">' +
          '<tr style="background:#f8fafc;"><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">機種</th><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">工程</th><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">滞留台数</th></tr>' +
          ecoRows +
        '</table>'
        : ''
      ) +
      // Milestone alerts
      (msAlerts.length > 0 ?
        '<div style="font-size:13px;font-weight:700;color:#dc2626;margin-bottom:8px;">🚨 見積・注文書 期限アラート (' + msAlerts.length + '件)</div>' +
        '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12px;">' +
          '<tr style="background:#f8fafc;"><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">機種</th><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">項目</th><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">期限</th><th style="padding:6px 12px;text-align:left;font-size:11px;border-bottom:2px solid #e8eaed;">状況</th></tr>' +
          msAlerts.map(function(a){
            return '<tr>' +
              '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;font-weight:700;">' + a.id + '</td>' +
              '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;">' + a.label + '</td>' +
              '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;font-family:monospace;">' + a.deadline + '</td>' +
              '<td style="padding:7px 12px;border-bottom:1px solid #e8eaed;font-weight:700;color:' + (a.urgent?'#dc2626':'#d97706') + ';">' +
                (a.urgent ? '🔴 '+Math.abs(a.diff)+'日超過' : '⚠️ あと'+a.diff+'日') +
              '</td></tr>';
          }).join('') +
        '</table>'
        : ''
      ) +
    '</div>' +
    // Footer
    '<div style="background:#f8fafc;padding:12px 24px;border-radius:0 0 10px 10px;border:1px solid #e8eaed;border-top:none;">' +
      '<p style="margin:0;font-size:11px;color:#94a3b8;">自動送信メール — 返信不要' +
        (appUrl ? ' | <a href="' + appUrl + '" style="color:#2563eb;">システムを開く</a>' : '') +
      '</p>' +
    '</div></div></body></html>';
}

function _buildAlertHtml(state, changeDesc, alerts) {
  // サマリーHTMLのヘッダーを変更して再利用
  return _buildDailySummaryHtml(state)
    .replace('日次サマリー', '更新通知: ' + (changeDesc||'変更あり'));
}

/* ============================================================
   マイルストーン アラート拡張（_checkAlerts に統合）
   ※ _checkAlerts 内の return alerts; の前に呼ぶ
   ============================================================ */
function _checkMilestoneAlerts(state, alerts) {
  var today = new Date(); today.setHours(0,0,0,0);
  var ms = state.milestones || {};

  Object.keys(ms).forEach(function(machineId) {
    var m = ms[machineId];
    if (!m || !m.goalDate) return;

    var goalD = new Date(m.goalDate); goalD.setHours(0,0,0,0);
    var qLead = m.quoteLeadDays || 60;
    var pLead = m.poLeadDays    || 30;

    var qDeadline = new Date(goalD); qDeadline.setDate(qDeadline.getDate() - qLead);
    var pDeadline = new Date(goalD); pDeadline.setDate(pDeadline.getDate() - pLead);

    var quoteOk = m.quoteSubmitted || false;
    var poOk    = m.poReceived     || false;

    var qDiff = Math.ceil((qDeadline - today) / 86400000);
    var pDiff = Math.ceil((pDeadline - today) / 86400000);

    // 14日以内 or 超過
    if (!quoteOk && qDiff <= 14) {
      alerts.push({
        type: 'milestone', subtype: 'quote',
        id: machineId, label: '見積書未提出',
        deadline: Utilities.formatDate(qDeadline, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        diff: qDiff, urgent: qDiff <= 0,
      });
    }
    if (!poOk && pDiff <= 14) {
      alerts.push({
        type: 'milestone', subtype: 'po',
        id: machineId, label: '注文書未受領',
        deadline: Utilities.formatDate(pDeadline, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        diff: pDiff, urgent: pDiff <= 0,
      });
    }
  });
  return alerts;
}
