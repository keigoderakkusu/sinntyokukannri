/**
 * ============================================================
 * business-flow-helper.gs — 業務種別フロー自動登録
 * ============================================================
 * メール件名から判定した業務種別（注残資料作成依頼／金型処理依頼／
 * 構成表送付／見積書作成依頼 など）ごとに、進捗管理の「業務フロー」
 * タブ（state.customFlows）へ自動でフローを追加・更新する。
 *
 * 既存の見本機/量産フローと同じデータ構造を使い、委託先A/Bへの
 * 記入依頼〜資料作成〜提出までの工程を可視化する。
 * ============================================================
 */

// 業務種別ごとの標準フロー定義（ラベル・色・工程・委託先有無）
const BIZ_FLOW_TEMPLATES = {
  '注残資料作成依頼': {
    label: '注残資料作成フロー',
    color: '#dc2626',
    withVendors: true,
    steps: ['社内受付', '委託先へ記入依頼', '委託先回答受領', '資料作成', '提出完了'],
  },
  '金型処理依頼': {
    label: '金型処理フロー',
    color: '#d97706',
    withVendors: true,
    steps: ['社内受付', '金型保管先へ確認', '処理方法決定', '処理手配', '完了報告'],
  },
  '見積書作成依頼': {
    label: '見積書作成フロー',
    color: '#0891b2',
    withVendors: false,
    steps: ['社内受付', '見積条件確認', '見積書作成', '社内承認', '提出完了'],
  },
  '構成表送付': {
    label: '構成表対応フロー',
    color: '#16a34a',
    withVendors: false,
    steps: ['社内受付', '構成表確認', 'お客様へ送付'],
  },
};

/**
 * 機種ID×業務種別に対応するフローグループを取得 or 新規作成し、
 * 1番目の工程（社内受付）を完了済みにして保存する。
 * @param {string} machineId 機種ID（例: A86）。不明な場合は null
 * @param {string} flowType BIZ_FLOW_TEMPLATES のキー
 * @param {string} sender メール送信者（メモ欄に記録）
 * @return {boolean} 成功したかどうか
 */
function addBusinessFlowStep(machineId, flowType, sender) {
  const tmpl = BIZ_FLOW_TEMPLATES[flowType];
  if (!tmpl) return false;
  if (!machineId) return false; // 機種不明な場合は進捗フローへは登録しない

  const stateJson = loadData();
  if (!stateJson) return false;
  const state = JSON.parse(stateJson);

  if (!state.customFlows) state.customFlows = {};
  if (!state.customFlows[machineId]) {
    state.customFlows[machineId] = _defaultFlowsForMachine(machineId, state);
  }
  const groups = state.customFlows[machineId];

  const groupId = 'grp_biz_' + flowType + '_' + machineId;
  let grp = groups.find(g => g.id === groupId);
  if (!grp) {
    grp = {
      id: groupId,
      label: tmpl.label,
      color: tmpl.color,
      vendors: tmpl.withVendors ? [
        { id: 'v1', name: '委託先A', color: '#7c3aed', contact: '', tel: '', role: '' },
        { id: 'v2', name: '委託先B', color: '#0891b2', contact: '', tel: '', role: '' },
      ] : [],
      steps: tmpl.steps.map((label, i) => ({
        id: 'step_biz_' + flowType + '_' + i,
        label: label,
        date: null,
        done: false,
        dept: '',
        note: '',
        vp: {},
      })),
    };
    groups.push(grp);
  }

  // 1番目の工程「社内受付」を完了にする
  const today = new Date();
  const ymd = Utilities.formatDate(today, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
  if (grp.steps[0]) {
    grp.steps[0].done = true;
    grp.steps[0].date = grp.steps[0].date || ymd;
    grp.steps[0].note = (grp.steps[0].note ? grp.steps[0].note + '\n' : '') +
      '受信: ' + sender + ' (' + today.toLocaleString('ja-JP') + ')';
  }

  saveData(JSON.stringify(state));
  return true;
}

// 機種に既存のフローが無い場合のデフォルト（見本機/量産フロー）を生成
function _defaultFlowsForMachine(machineId, state) {
  const sc = (state.schedules && state.schedules[machineId]) || {};
  return [
    { id: 'grp_sample_' + machineId, label: '見本機フロー', color: '#7c3aed',
      vendors: [
        { id: 'v1', name: '委託先A', color: '#7c3aed', contact: '', tel: '', role: '' },
        { id: 'v2', name: '委託先B', color: '#0891b2', contact: '', tel: '', role: '' },
      ],
      steps: [
        { id: 'sampleImpl', label: '基板実装', date: sc.sampleImpl || null, done: false, dept: '', note: '', vp: {} },
        { id: 'sampleAssy', label: '組立',    date: sc.sampleAssy || null, done: false, dept: '', note: '', vp: {} },
        { id: 'sampleShip', label: '出荷',    date: sc.sampleShip || null, done: false, dept: '', note: '', vp: {} },
      ] },
    { id: 'grp_prod_' + machineId, label: '量産フロー', color: '#2563eb',
      vendors: [
        { id: 'v1', name: '委託先A', color: '#2563eb', contact: '', tel: '', role: '' },
        { id: 'v2', name: '委託先B', color: '#16a34a', contact: '', tel: '', role: '' },
      ],
      steps: [
        { id: 'prodImpl', label: '基板実装', date: sc.prodImpl || null, done: false, dept: '', note: '', vp: {} },
        { id: 'prodAssy', label: '組立',    date: sc.prodAssy || null, done: false, dept: '', note: '', vp: {} },
        { id: 'prodShip', label: '出荷',    date: sc.prodShip || null, done: false, dept: '', note: '', vp: {} },
      ] },
  ];
}
