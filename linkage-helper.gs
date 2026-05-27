/**
 * 見積管理システム側に追加するリンケージヘルパー
 * mitumorikannri-VR3 の Code.gs に追記してください
 *
 * 追記後、営業進捗管理の管理コンソールで
 * 見積管理のデプロイURL を入力して「データ取得」をクリックすると連携できます。
 */

/**
 * 既存の doGet に以下の分岐を追加してください:
 *
 * function doGet(e) {
 *   if (e.parameter.action === 'getForLink') {
 *     return getForLink(e);
 *   }
 *   // ... 既存の処理 ...
 * }
 */
function getForLink(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet(); // 必要に応してシート名を指定
    var data = sheet.getDataRange().getValues();
    var headers = data[0];

    var estimates = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var record = {};
      headers.forEach(function(h, idx) {
        record[h] = row[idx];
      });
      if (record['機種名'] || record['machineId'] || record['id']) {
        estimates.push({
          machineId: record['機種名'] || record['machineId'] || record['id'] || '',
          customer:  record['顧客名'] || record['customer'] || record['client'] || '',
          amount:    record['見積金額'] || record['amount'] || '',
          status:    record['ステータス'] || record['status'] || '',
          updatedAt: record['更新日'] || '',
        });
      }
    }

    var output = ContentService.createTextOutput(
      JSON.stringify({ estimates: estimates, updatedAt: new Date().toISOString() })
    );
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  } catch (err) {
    var output = ContentService.createTextOutput(JSON.stringify({ error: err.message }));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
}
