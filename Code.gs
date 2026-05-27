/**
 * 営業進捗管理システム — Google Apps Script webapp
 * https://github.com/keigoderakkusu/sinntyokukannri
 */

function doGet(e) {
  // API endpoint for data linkage from other systems
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

/** クライアントから呼び出し: 保存済み状態を返す */
function loadData() {
  return PropertiesService.getScriptProperties().getProperty('sinntyoku_state') || null;
}

/** クライアントから呼び出し: 状態を保存 */
function saveData(stateJson) {
  PropertiesService.getScriptProperties().setProperty('sinntyoku_state', stateJson);
}

/**
 * 見積管理システムなど外部GASからデータを取得 (CORS回避のためサーバーサイド実行)
 * クライアントから google.script.run.getLinkageData(url) で呼び出す
 */
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
