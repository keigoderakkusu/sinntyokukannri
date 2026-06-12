/**
 * ============================================================
 * email-rpa-handlers.gs — 3種類のメールハンドラー
 * ============================================================
 * rpaHandleChuzan()     — 中残処理
 * rpaHandleQuote()      — 見積依頼
 * rpaHandleBOM()        — 構成表
 * rpaHandleChuzanShiryo()— 注残資料作成依頼
 * rpaHandleKanagata()   — 金型処理依頼
 * rpaHandleBomSofu()    — 構成表送付
 * rpaHandleQuoteCreate()— 見積書作成依頼
 * ============================================================
 */

// ============================================================
// 1. 中残処理ハンドラー
// ============================================================
function rpaHandleChuzan(msg, cls, attachments) {
  const machineId = cls.machineId || '（機種不明）';
  const urgencyLabel = cls.urgency === 'high' ? '🔴 至急' : cls.urgency === 'normal' ? '🟡 通常' : '🟢 低';
  const sender   = msg.getFrom();
  const subject  = msg.getSubject();
  const received = new Date().toLocaleString('ja-JP');

  // ── 1. 依頼元への自動受付確認 ────────────────────────────
  const replyBody = _buildReply(msg, `
中残処理依頼を受け付けました。
担当者より折り返しご連絡いたします。

【受付情報】
機種    : ${machineId}
件名    : ${subject}
受付日時: ${received}
  `);
  msg.reply(replyBody);

  // ── 2. 社内通知メール ─────────────────────────────────────
  const internalHtml = _buildInternalHtml({
    title: '中残処理依頼',
    color: cls.urgency === 'high' ? '#dc2626' : '#d97706',
    fields: [
      { label: '送信者',   value: sender },
      { label: '機種',     value: `<strong>${machineId}</strong>` },
      { label: '緊急度',   value: urgencyLabel },
      { label: '要約',     value: cls.summary },
      { label: '受信日時', value: received },
    ],
    bodyPreview: msg.getPlainBody().substring(0, 800),
    actions: [
      '担当者にて内容を確認し、中残処理の手配をお願いします',
      '必要に応じてお客様へ回答期日をご連絡ください',
    ],
  });

  RPA.notifyEmails.forEach(email => {
    GmailApp.sendEmail(email, `【中残処理依頼${cls.urgency==='high'?' ⚠️至急':''}】${machineId} — ${sender.replace(/<.*>/,'').trim()}`, '', {
      htmlBody: internalHtml,
    });
  });

  // ── 3. 進捗管理にログ記録 ─────────────────────────────────
  rpaUpdateProgressLog(machineId, `中残処理依頼受信: ${cls.summary} (from: ${sender})`);

  return { handled: true, type: '中残処理', machineId, summary: cls.summary };
}

// ============================================================
// 2. 見積依頼ハンドラー
// ============================================================
function rpaHandleQuote(msg, cls, attachments) {
  const machineId  = cls.machineId  || '（機種不明）';
  const quantity   = cls.quantity   ? `${cls.quantity}台` : '（台数不明）';
  const reqDate    = cls.requestDate || '（希望日未記載）';
  const urgencyLabel = cls.urgency === 'high' ? '🔴 至急' : '🟡 通常';
  const sender     = msg.getFrom();
  const subject    = msg.getSubject();
  const received   = new Date().toLocaleString('ja-JP');

  // ── 1. 営業課へ通知 ──────────────────────────────────────
  if (RPA.salesEmail) {
    const salesHtml = _buildInternalHtml({
      title: '見積依頼 ← 顧客',
      color: '#2563eb',
      fields: [
        { label: '顧客',       value: sender },
        { label: '機種',       value: `<strong>${machineId}</strong>` },
        { label: '数量',       value: `<strong>${quantity}</strong>` },
        { label: '希望納期',   value: reqDate },
        { label: '緊急度',     value: urgencyLabel },
        { label: '要約',       value: cls.summary },
        { label: '受信日時',   value: received },
      ],
      bodyPreview: msg.getPlainBody().substring(0, 1200),
      actions: [
        '楽楽販売で見積書を作成してください',
        `顧客（${sender.replace(/<.*>/,'').trim()}）へ見積回答をお願いします`,
        cls.urgency === 'high' ? '⚠️ 至急依頼のため本日中に対応お願いします' : '',
      ].filter(Boolean),
    });

    GmailApp.sendEmail(
      RPA.salesEmail,
      `【見積依頼${cls.urgency==='high'?' ⚠️至急':''}】${machineId} ${quantity} — ${sender.replace(/<.*>/,'').trim()}`,
      '',
      { htmlBody: salesHtml }
    );
  }

  // ── 2. 依頼元への受付確認返信 ────────────────────────────
  msg.reply(_buildReply(msg, `
見積依頼を受け付けました。
担当の営業より見積書をご連絡させていただきます。

【受付情報】
機種    : ${machineId}
数量    : ${quantity}
受付日時: ${received}
  `));

  // ── 3. 進捗ログ更新 ──────────────────────────────────────
  rpaUpdateProgressLog(machineId, `見積依頼受信: ${quantity} from ${sender}`);

  return { handled: true, type: '見積依頼', machineId, summary: cls.summary };
}

// ============================================================
// 3. 構成表ハンドラー
// ============================================================
function rpaHandleBOM(msg, cls, attachments) {
  const machineId = cls.machineId || '（機種不明）';
  const sender    = msg.getFrom();
  const subject   = msg.getSubject();
  const received  = new Date().toLocaleString('ja-JP');

  // ── 1. 添付ファイルをGoogle Driveに保存 ──────────────────
  const savedFiles = [];
  const folderId = RPA.driveFolderId;

  if (attachments.length > 0 && folderId) {
    try {
      const folder = _getOrCreateSubfolder(folderId, machineId);
      const today  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
      attachments.forEach(att => {
        const fname = `[${today}] ${att.getName()}`;
        const file  = folder.createFile(att.copyBlob().setName(fname));
        // 閲覧権限をドメイン内に設定
        try { file.setSharing(DriveApp.Access.DOMAIN, DriveApp.Permission.VIEW); } catch(_) {}
        savedFiles.push({ name: fname, url: file.getUrl(), mimeType: att.getContentType() });
        Logger.log(`📁 Drive保存: ${fname}`);
      });
    } catch (e) {
      Logger.log('Drive保存エラー: ' + e.message);
    }
  }

  // ── 2. 社内共有メール ─────────────────────────────────────
  const fileLinksHtml = savedFiles.length > 0
    ? savedFiles.map(f =>
        `<li><a href="${f.url}" style="color:#2563eb;">${f.name}</a></li>`
      ).join('')
    : '<li>（添付ファイルなし）</li>';

  const internalHtml = _buildInternalHtml({
    title: '構成表受信・Drive保存完了',
    color: '#16a34a',
    fields: [
      { label: '送信者',   value: sender },
      { label: '機種',     value: `<strong>${machineId}</strong>` },
      { label: '件名',     value: subject },
      { label: '受信日時', value: received },
      { label: '保存先',   value: `Google Drive / ${machineId} フォルダ` },
    ],
    bodyPreview: msg.getPlainBody().substring(0, 600),
    actions: [
      '内容を確認し、業務フローに反映させてください',
      savedFiles.length > 0 ? `${savedFiles.length}件のファイルをDriveに保存しました` : '',
    ].filter(Boolean),
    extra: savedFiles.length > 0 ? `
      <div style="margin-top:16px;">
        <div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:8px;">📁 保存ファイル一覧</div>
        <ul style="margin:0;padding-left:20px;font-size:12px;">${fileLinksHtml}</ul>
      </div>` : '',
  });

  RPA.notifyEmails.forEach(email => {
    GmailApp.sendEmail(
      email,
      `【構成表受信】${machineId} — ${subject}`,
      '',
      { htmlBody: internalHtml }
    );
  });

  // ── 3. 進捗管理システムへ自動反映 ────────────────────────
  rpaUpdateProgressWithBOM(machineId, subject, savedFiles);

  // ── 4. 受信確認返信 ──────────────────────────────────────
  msg.reply(_buildReply(msg, `
構成表を受領しました。
社内にて共有・保管いたします。

【受領情報】
機種    : ${machineId}
件名    : ${subject}
受領日時: ${received}
${savedFiles.length > 0 ? `添付  : ${savedFiles.length}件保存済み` : ''}
  `));

  return { handled: true, type: '構成表', machineId, savedFiles, summary: cls.summary };
}

// ============================================================
// 共通ユーティリティ
// ============================================================

/** フォルダを取得、なければ作成 */
function _getOrCreateSubfolder(parentId, name) {
  const parent = DriveApp.getFolderById(parentId);
  const iter   = parent.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : parent.createFolder(name);
}

/** 自動返信メール本文を生成 */
function _buildReply(msg, content) {
  const senderName = msg.getFrom().replace(/<.*>/,'').trim() || 'お客様';
  return `${senderName} 様

いつもお世話になっております。

${content.trim()}

─────────────────────────────
${RPA.companyName}
このメールはRPAシステムによる自動返信です。
ご不明な点は担当者まで直接お問い合わせください。
`;
}

/** 社内通知HTMLメールテンプレート */
function _buildInternalHtml({ title, color, fields, bodyPreview, actions, extra }) {
  const fieldRows = fields.map(f => `
    <tr>
      <td style="padding:6px 12px;width:90px;font-size:11px;font-weight:600;color:#64748b;white-space:nowrap;border-bottom:1px solid #f0f2f5;">${f.label}</td>
      <td style="padding:6px 12px;font-size:12px;border-bottom:1px solid #f0f2f5;">${f.value}</td>
    </tr>`).join('');

  const actionItems = actions.map(a =>
    `<li style="margin-bottom:4px;">${a}</li>`).join('');

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6fb;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;">
  <!-- Header -->
  <div style="background:#0f1729;padding:18px 24px;border-radius:10px 10px 0 0;display:flex;align-items:center;gap:12px;">
    <div style="width:10px;height:40px;background:${color};border-radius:4px;flex-shrink:0;"></div>
    <div>
      <div style="font-size:14px;font-weight:700;color:#fff;">🤖 RPA自動通知 — ${title}</div>
      <div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:3px;">営業進捗管理システム / ${new Date().toLocaleString('ja-JP')}</div>
    </div>
  </div>
  <!-- Body -->
  <div style="background:#fff;border:1px solid #e8eaed;border-top:none;padding:20px 24px;">
    <!-- Fields -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;border:1px solid #e8eaed;border-radius:8px;overflow:hidden;">
      ${fieldRows}
    </table>
    <!-- Actions -->
    ${actions.length > 0 ? `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:6px;">📋 対応依頼</div>
      <ol style="margin:0;padding-left:20px;font-size:12px;color:#1e293b;">${actionItems}</ol>
    </div>` : ''}
    ${extra || ''}
    <!-- Email preview -->
    <div style="background:#f8fafc;border:1px solid #e8eaed;border-radius:6px;padding:12px;margin-top:16px;">
      <div style="font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:6px;">▼ 元メール本文（抜粋）</div>
      <div style="font-size:11px;color:#475569;line-height:1.6;white-space:pre-wrap;">${bodyPreview.substring(0,600)}</div>
    </div>
  </div>
  <!-- Footer -->
  <div style="background:#f8fafc;border:1px solid #e8eaed;border-top:none;border-radius:0 0 10px 10px;padding:10px 24px;">
    <p style="margin:0;font-size:10px;color:#94a3b8;">このメールはRPAシステムにより自動生成されました — 返信不要</p>
  </div>
</div>
</body></html>`;
}

// ============================================================
// 件名キーワード分類 用 共通ハンドラー
// ============================================================
// 件名「機種ID＋キーワード」型の依頼（注残資料作成依頼／金型処理依頼／
// 構成表送付／見積書作成依頼）を、お客様への自動返信は行わず、
// 社内通知＋振り分け（業務フロー登録）のみ行う。
function _handleSubjectKeywordType(msg, cls, title, color, actions) {
  const machineId = cls.machineId || '（機種不明）';
  const sender    = msg.getFrom();
  const subject   = msg.getSubject();
  const received  = new Date().toLocaleString('ja-JP');
  const urgencyLabel = cls.urgency === 'high' ? '🔴 至急' : cls.urgency === 'normal' ? '🟡 通常' : '🟢 低';

  // 社内通知メール
  const internalHtml = _buildInternalHtml({
    title: title,
    color: color,
    fields: [
      { label: '送信者',   value: sender },
      { label: '件名',     value: subject },
      { label: '機種',     value: `<strong>${machineId}</strong>` },
      { label: '緊急度',   value: urgencyLabel },
      { label: '受信日時', value: received },
    ],
    bodyPreview: msg.getPlainBody().substring(0, 800),
    actions: actions,
  });

  RPA.notifyEmails.forEach(email => {
    GmailApp.sendEmail(email, `【${title}${cls.urgency === 'high' ? ' ⚠️至急' : ''}】${machineId} — ${sender.replace(/<.*>/, '').trim()}`, '', {
      htmlBody: internalHtml,
    });
  });

  // 業務フロー（進捗管理）への登録
  try {
    addBusinessFlowStep(cls.machineId, cls.type, sender);
  } catch (e) {
    Logger.log('addBusinessFlowStep error: ' + e.message);
  }

  // 進捗管理ログへ記録
  if (cls.machineId) {
    rpaUpdateProgressLog(machineId, `${title}受信: ${cls.summary} (from: ${sender})`);
  }

  return { handled: true, type: cls.type, machineId: cls.machineId, summary: cls.summary };
}

// ============================================================
// 4. 注残資料作成依頼ハンドラー
// ============================================================
function rpaHandleChuzanShiryo(msg, cls, attachments) {
  return _handleSubjectKeywordType(msg, cls, '注残資料作成依頼', '#dc2626', [
    '担当者にて内容を確認してください',
    '必要に応じて委託先へ注残データの記入を依頼してください（業務フロータブから進捗確認できます）',
    '資料作成後、提出をお願いします',
  ]);
}

// ============================================================
// 5. 金型処理依頼ハンドラー
// ============================================================
function rpaHandleKanagata(msg, cls, attachments) {
  return _handleSubjectKeywordType(msg, cls, '金型処理依頼', '#d97706', [
    '担当者にて金型の保管状況を確認してください',
    '処理方法（廃棄／返却／保管継続）を決定し、手配をお願いします',
  ]);
}

// ============================================================
// 6. 構成表送付ハンドラー
// ============================================================
function rpaHandleBomSofu(msg, cls, attachments) {
  return _handleSubjectKeywordType(msg, cls, '構成表送付', '#16a34a', [
    '構成表の内容を確認してください',
    'お客様へ構成表を送付してください',
  ]);
}

// ============================================================
// 7. 見積書作成依頼ハンドラー
// ============================================================
function rpaHandleQuoteCreate(msg, cls, attachments) {
  return _handleSubjectKeywordType(msg, cls, '見積書作成依頼', '#0891b2', [
    '見積条件（台数・単価・納期）を確認してください',
    '見積書を作成し、社内承認後にお客様へ提出してください',
  ]);
}
