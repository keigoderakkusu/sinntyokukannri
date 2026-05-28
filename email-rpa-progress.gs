/**
 * ============================================================
 * email-rpa-progress.gs — 営業進捗管理システム 自動反映
 * ============================================================
 * メールRPAで受信した情報を PropertiesService (sinntyoku_state)
 * に書き込み、営業進捗管理システムの表示に即座に反映させる。
 * ============================================================
 */

/**
 * 進捗管理のログに自動記録（全種別共通）
 * @param {string} machineId - 機種ID（不明な場合は '—'）
 * @param {string} message   - ログメッセージ
 */
function rpaUpdateProgressLog(machineId, message) {
  _withState(state => {
    if (!state.logs) state.logs = [];
    state.logs.unshift({
      ts:  new Date().toLocaleString('ja-JP'),
      msg: `🤖 [RPA自動] ${machineId !== '—' ? machineId + ': ' : ''}${message}`,
    });
    if (state.logs.length > 500) state.logs = state.logs.slice(0, 500);
  });
}

/**
 * 構成表受信時の専用更新
 * - カスタムフローの「構成表受領」ステップを完了済みに
 * - 備考メモに受信記録を追記
 * - ログ記録
 * @param {string} machineId
 * @param {string} subject    - メール件名
 * @param {Array}  savedFiles - Driveに保存したファイル情報
 */
function rpaUpdateProgressWithBOM(machineId, subject, savedFiles) {
  _withState(state => {
    // ── カスタムフローの自動更新 ────────────────────────────
    if (state.customFlows && state.customFlows[machineId]) {
      let updatedSteps = 0;
      state.customFlows[machineId].forEach(grp => {
        grp.steps.forEach(step => {
          // 「構成表」「BOM」「仕様書」を含むステップを完了に
          if (/構成表|bom|仕様書|部品表/i.test(step.label) && !step.done) {
            step.done = true;
            step.date = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
            updatedSteps++;
          }
        });
      });
      if (updatedSteps > 0) {
        Logger.log(`フロー自動更新: ${machineId} の ${updatedSteps}ステップを完了済みに`);
      }
    }

    // ── 備考メモへ受信履歴を追記 ───────────────────────────
    if (!state.notes) state.notes = {};
    const today   = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    const fileInfo = savedFiles.length > 0
      ? `（${savedFiles.length}件 Drive保存済み）`
      : '（添付なし）';
    const record  = `[${today}] 📄 構成表受信: ${subject} ${fileInfo}`;
    state.notes[machineId] = state.notes[machineId]
      ? state.notes[machineId] + '\n' + record
      : record;

    // ── ログ ───────────────────────────────────────────────
    if (!state.logs) state.logs = [];
    state.logs.unshift({
      ts:  new Date().toLocaleString('ja-JP'),
      msg: `🤖 [RPA自動] ${machineId}: 構成表受信 → Drive保存${savedFiles.length}件 → 進捗反映完了`,
    });
    if (state.logs.length > 500) state.logs = state.logs.slice(0, 500);
  });
}

/**
 * スケジュール日付の自動更新（メール本文から日付を抽出した場合）
 * @param {string} machineId
 * @param {string} phaseKey  - 'sampleShip' | 'prodImpl' | etc.
 * @param {string} dateStr   - 'YYYY-MM-DD'
 */
function rpaUpdateScheduleDate(machineId, phaseKey, dateStr) {
  _withState(state => {
    if (!state.schedules) state.schedules = {};
    if (!state.schedules[machineId]) state.schedules[machineId] = {};
    state.schedules[machineId][phaseKey] = dateStr;

    if (!state.logs) state.logs = [];
    const PHASE_LABELS = {
      sampleImpl:'見本機実装',sampleAssy:'見本機組立',sampleShip:'見本機出荷',
      prodImpl:'量産実装',prodAssy:'量産組立',prodShip:'量産出荷',
    };
    state.logs.unshift({
      ts:  new Date().toLocaleString('ja-JP'),
      msg: `🤖 [RPA自動] ${machineId}: ${PHASE_LABELS[phaseKey] || phaseKey} → ${dateStr} に更新`,
    });
  });
}

// ── 内部ヘルパー ────────────────────────────────────────────
/**
 * PropertiesService のstate を読み込み → callback で編集 → 書き戻し
 */
function _withState(callback) {
  try {
    const props = PropertiesService.getScriptProperties();
    const json  = props.getProperty('sinntyoku_state');
    if (!json) {
      Logger.log('sinntyoku_state が未設定のため進捗反映をスキップ');
      return;
    }
    const state = JSON.parse(json);
    callback(state);
    props.setProperty('sinntyoku_state', JSON.stringify(state));
  } catch (e) {
    Logger.log('進捗更新エラー: ' + e.message);
  }
}
