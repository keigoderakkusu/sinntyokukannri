/**
 * ============================================================
 * email-rpa-classifier.gs — Gemini AI メール分類エンジン
 * ============================================================
 * 1次: Gemini 1.5 Flash API で高精度分類
 * 2次: キーワードルールによるフォールバック
 * ============================================================
 */

/**
 * メールを分類して構造化オブジェクトを返す
 * @returns {{
 *   type: '中残処理'|'見積依頼'|'構成表'|'その他',
 *   machineId: string|null,
 *   quantity: number|null,
 *   requestDate: string|null,
 *   urgency: 'high'|'normal'|'low',
 *   summary: string,
 *   confidence: number
 * }}
 */
function rpaClassifyEmail(subject, body, sender) {
  // 件名ベースの業務種別判定（注残資料作成依頼／金型処理依頼／構成表送付／
  // 見積書作成依頼 など）を最優先で判定。「機種ID＋キーワード」のような
  // 件名パターンを確実に拾うため、Geminiより前にチェックする。
  const subjectMatch = _classifyBySubjectKeyword(subject);
  if (subjectMatch) return subjectMatch;

  const apiKey = RPA.geminiKey;
  if (apiKey) {
    const result = _classifyWithGemini(subject, body, sender, apiKey);
    if (result) return result;
  }
  return _classifyByKeyword(subject, body);
}

// ── 件名キーワード分類（最優先） ────────────────────────────
// 「A86仮注残資料作成依頼」のような「機種ID＋キーワード」の件名を検出
function _classifyBySubjectKeyword(subject) {
  const text = subject.replace(/\s/g, '');

  const SUBJECT_RULES = [
    { type: '注残資料作成依頼', pattern: /(仮)?注残.*(資料|作成|依頼)/i },
    { type: '金型処理依頼',     pattern: /金型.*(処理|依頼)/i },
    { type: '構成表送付',       pattern: /構成表.*(送付|送信|提出)/i },
    { type: '見積書作成依頼',   pattern: /見積書?.*(作成依頼|依頼)/i },
  ];

  for (const rule of SUBJECT_RULES) {
    if (rule.pattern.test(text)) {
      return {
        type: rule.type,
        machineId: _extractMachineId(text),
        quantity: _extractQuantity(text),
        requestDate: null,
        urgency: /至急|急ぎ|本日中|asap/i.test(text) ? 'high' : 'normal',
        summary: `${rule.type}（件名キーワード検出）`,
        confidence: 0.9,
        source: 'subject-keyword',
      };
    }
  }
  return null;
}

// ── Gemini API 呼び出し ─────────────────────────────────────
function _classifyWithGemini(subject, body, sender, apiKey) {
  const prompt = `
あなたは遊技機メーカーの営業メール分類AIです。
受信メールを正確に分析してJSON形式のみで回答してください。

【メール情報】
送信者: ${sender}
件名: ${subject}
本文（最初の2000文字）:
---
${body.substring(0, 2000)}
---

【分類定義】
- 中残処理: 遊技機の中古機・残量の処理依頼。「中残」「回収」「在庫処理」「撤去」などを含む
- 見積依頼: 遊技機の購入見積もり、価格確認、発注数量に関する問い合わせ
- 構成表: 基板構成表、BOM（部品表）、仕様書、回路図などのファイル共有
- その他: 上記に該当しないメール（挨拶、一般連絡など）

【抽出ルール】
- machineId: 機種名（例: A86, D59B, E62, A84B など英数字）。複数ある場合は最初の1件
- quantity: 台数（数値のみ）
- requestDate: 「〇月〇日」「YYYY年MM月DD日」形式の日付をYYYY-MM-DDに変換
- urgency: 「至急」「急ぎ」「本日中」→high / 「通常」→normal / その他→low
- summary: 30文字以内の日本語要約

【回答（JSONのみ、コードブロック不要）】
{
  "type": "中残処理 | 見積依頼 | 構成表 | その他",
  "machineId": "機種名 or null",
  "quantity": 台数の数値 or null,
  "requestDate": "YYYY-MM-DD or null",
  "urgency": "high | normal | low",
  "summary": "要約テキスト",
  "confidence": 0.0〜1.0
}
`;

  try {
    const res = UrlFetchApp.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
            maxOutputTokens: 256,
          },
        }),
      }
    );

    if (res.getResponseCode() !== 200) {
      Logger.log('Gemini HTTPエラー: ' + res.getResponseCode());
      return null;
    }

    const data = JSON.parse(res.getContentText());
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    // JSON文字列をクリーンアップ（コードブロック除去）
    const clean = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);

    // confidence が低い場合はキーワードで補完
    if (parsed.confidence < 0.6) {
      const kw = _classifyByKeyword(subject, text);
      if (kw.type !== 'その他') return { ...parsed, ...kw, source: 'hybrid' };
    }

    return { ...parsed, source: 'gemini' };
  } catch (e) {
    Logger.log('Gemini 分類エラー: ' + e.message);
    return null;
  }
}

// ── キーワードフォールバック ────────────────────────────────
function _classifyByKeyword(subject, body) {
  const text = (subject + ' ' + body).replace(/\s/g, '');

  // 優先順位順にチェック
  const RULES = [
    {
      type: '構成表',
      pattern: /構成表|bom|基板.*リスト|部品.*構成|仕様書|回路図|部品表/i,
    },
    {
      type: '中残処理',
      pattern: /中残|ちゅうざん|中古.*処理|回収.*依頼|在庫.*処理|撤去.*依頼/i,
    },
    {
      type: '見積依頼',
      pattern: /見積|お見積|価格.*確認|発注.*予定|数量.*確認|見積書.*依頼/i,
    },
  ];

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return {
        type: rule.type,
        machineId: _extractMachineId(text),
        quantity: _extractQuantity(text),
        requestDate: null,
        urgency: /至急|急ぎ|本日中|asap/i.test(text) ? 'high' : 'normal',
        summary: `${rule.type}（キーワード検出）`,
        confidence: 0.75,
        source: 'keyword',
      };
    }
  }

  return {
    type: 'その他',
    machineId: null,
    quantity: null,
    requestDate: null,
    urgency: 'low',
    summary: '分類対象外',
    confidence: 1.0,
    source: 'keyword',
  };
}

// ── ユーティリティ ──────────────────────────────────────────
function _extractMachineId(text) {
  // 機種IDパターン: A86, D59B, E62, A84B など
  const m = text.match(/\b([AaDdEe]\d{2,3}[Bb]?)\b/);
  return m ? m[1].toUpperCase() : null;
}

function _extractQuantity(text) {
  // 「300台」「3,700台」などのパターン
  const m = text.match(/([0-9,，]+)\s*台/);
  if (m) return parseInt(m[1].replace(/[,，]/g, ''), 10);
  return null;
}
