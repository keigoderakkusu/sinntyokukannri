/**
 * 営業進捗管理システム — Google Apps Script webapp
 *
 * デプロイ手順:
 * 1. GASプロジェクトを新規作成
 * 2. このファイルの内容を Code.gs に貼り付け
 * 3. 「index」という名前のHTMLファイルを作成し、営業進捗管理.htmlの内容を貼り付け
 * 4. デプロイ → 新しいデプロイ → ウェブアプリ
 *    - 実行するユーザー: 自分
 *    - アクセスできるユーザー: 自分 (または全員)
 */

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('営業進捗管理システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * クライアントから呼び出し: 保存済み状態を返す
 * @returns {string|null} JSON文字列 or null
 */
function loadData() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('sinntyoku_state') || null;
}

/**
 * クライアントから呼び出し: 状態をPropertiesServiceに保存
 * @param {string} stateJson - JSON.stringify(state) の文字列
 */
function saveData(stateJson) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('sinntyoku_state', stateJson);
}

/**
 * (オプション) スプレッドシートIDを設定すればSheets連携も可能
 * var SHEET_ID = 'YOUR_SPREADSHEET_ID';
 */
