import { useState, useCallback, useEffect, useRef } from "react";
import ReactFlow, {
  MiniMap, Controls, Background,
  useNodesState, useEdgesState,
  Handle, Position,
} from "reactflow";
import "reactflow/dist/style.css";

// ============================================================
// ★ 設定 — ここだけ変更してください
// ============================================================
const GAS_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
//  GASのWebアプリURL（03_webapp_ap.gs をデプロイしたもの）

const POLL_SEC = 5; // ポーリング間隔（秒）— 5秒で実用上「即時」に見える

// ============================================================
// 部署定義
// ============================================================
const DEPTS = [
  { id: "sales",     label: "営業部",   color: "#6366f1", icon: "🤝" },
  { id: "repair",    label: "修理部",   color: "#3b82f6", icon: "🔧" },
  { id: "mfg",       label: "製造部",   color: "#f59e0b", icon: "⚙️" },
  { id: "qa",        label: "品質管理", color: "#10b981", icon: "🔍" },
  { id: "logistics", label: "物流部",   color: "#8b5cf6", icon: "🚚" },
  { id: "billing",   label: "経理部",   color: "#ec4899", icon: "💴" },
];
const DEPT = Object.fromEntries(DEPTS.map(d => [d.id, d]));

const STAGES = [
  { label: "受付",   deptId: "sales",     color: "#6366f1" },
  { label: "見積",   deptId: "sales",     color: "#818cf8" },
  { label: "受注",   deptId: "repair",    color: "#3b82f6" },
  { label: "作業中", deptId: "mfg",       color: "#f59e0b" },
  { label: "検査",   deptId: "qa",        color: "#10b981" },
  { label: "出荷",   deptId: "logistics", color: "#8b5cf6" },
  { label: "完了",   deptId: "billing",   color: "#ec4899" },
];

// VR3ステータス → { deptId, stageIdx, progress }
const S = {
  "作成予定":   { deptId:"sales",     stageIdx:0, progress:5,   color:"#6366f1", icon:"📋" },
  "送信済み":   { deptId:"sales",     stageIdx:1, progress:25,  color:"#3b82f6", icon:"📤" },
  "受領":       { deptId:"repair",    stageIdx:2, progress:45,  color:"#f59e0b", icon:"📥" },
  "受注済み":   { deptId:"mfg",       stageIdx:3, progress:65,  color:"#10b981", icon:"✅" },
  "保留":       { deptId:"sales",     stageIdx:0, progress:10,  color:"#8b5cf6", icon:"⏸" },
  "キャンセル": { deptId:"sales",     stageIdx:0, progress:0,   color:"#ef4444", icon:"❌" },
  "失注":       { deptId:"sales",     stageIdx:0, progress:0,   color:"#ef4444", icon:"✕"  },
  "納品済み":   { deptId:"billing",   stageIdx:6, progress:100, color:"#059669", icon:"🏁" },
};
const bg = { "作成予定":"#eef2ff","送信済み":"#eff6ff","受領":"#fffbeb","受注済み":"#ecfdf5","保留":"#f5f3ff","キャンセル":"#fef2f2","失注":"#fef2f2","納品済み":"#d1fae5" };

// ============================================================
// GAS API クライアント（外部サービスゼロ）
// ============================================================
const Api = {
  async get(action, params = {}) {
    const u = new URL(GAS_URL);
    u.searchParams.set("action", action);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    try {
      const r = await fetch(u.toString());
      return await r.json();
    } catch { return { success: false }; }
  },
  async updateStatus(mgmtId, status, assignee) {
    return this.get("updateStatus", { mgmtId, newStatus: status, assignee: assignee || "" });
  },
  async getOrders() {
    // boardGetOrders があれば優先、なければ getAll
    let r = await this.get("boardGetOrders");
    if (!r.success || !r.items?.length) r = await this.get("getAll");
    return r;
  },
  // 担当者・メモをスプレッドシートに書き込む（updateMgmt を使用）
  async updateOrder(mgmtId, patch) {
    return this.get("updateMgmt", { mgmtId, ...patch });
  },
};

// ============================================================
// モックデータ（GAS未接続時のデモ）
// ============================================================
const MOCK = [
  { mgmtId:"M001", orderNo:"ORD-001", client:"山田製作所",     status:"受注済み",  orderAmount:1850000, modelCode:"MD-A", machineName:"精密加工機A", orderType:"修理",     assignee:"佐藤",  memo:"基板交換済み" },
  { mgmtId:"M002", orderNo:"ORD-002", client:"田中電機",       status:"受領",      orderAmount:420000,  modelCode:"MD-B", machineName:"制御盤B",    orderType:"修理",     assignee:"鈴木",  memo:"" },
  { mgmtId:"M003", orderNo:"ORD-003", client:"佐藤工業",       status:"送信済み",  orderAmount:780000,  modelCode:"MD-C", machineName:"サーボC",    orderType:"部品交換", assignee:"田中",  memo:"見積確認中" },
  { mgmtId:"M004", orderNo:"ORD-004", client:"グリーンテック",  status:"作成予定",  orderAmount:250000,  modelCode:"MD-D", machineName:"",           orderType:"点検",     assignee:"高橋",  memo:"" },
  { mgmtId:"M005", orderNo:"ORD-005", client:"鈴木精機",       status:"納品済み",  orderAmount:3200000, modelCode:"MD-E", machineName:"高速プレスE", orderType:"OH",       assignee:"渡辺",  memo:"完了" },
  { mgmtId:"M006", orderNo:"ORD-006", client:"ナカムラ産業",   status:"保留",      orderAmount:560000,  modelCode:"MD-F", machineName:"インバータF", orderType:"修理",     assignee:"伊藤",  memo:"部品待ち" },
  { mgmtId:"M007", orderNo:"ORD-007", client:"東部エンジニア",  status:"受注済み",  orderAmount:920000,  modelCode:"MD-A", machineName:"NC旋盤G",    orderType:"修理",     assignee:"山田",  memo:"" },
  { mgmtId:"M008", orderNo:"ORD-008", client:"西日本メカトロ",  status:"送信済み",  orderAmount:340000,  modelCode:"MD-B", machineName:"制御盤B",    orderType:"部品交換", assignee:"中村",  memo:"" },
];

// ============================================================
// フロービルダー
// ============================================================
const CW = 188, CH = 132, SW = 218, LANE_TOP = 46, VPAD = 10;

function buildFlow(orders) {
  const nodes = [];
  const totalW = STAGES.length * SW + 40;

  // 部署ごとの行数とy位置を計算
  const deptRows = {};
  orders.forEach(o => {
    const meta = S[o.status] || S["作成予定"];
    const key = `${meta.deptId}-${meta.stageIdx}`;
    deptRows[key] = (deptRows[key] || 0) + 1;
  });
  const deptH = {};
  let curY = 68;
  DEPTS.forEach(d => {
    const maxRows = Math.max(1, ...STAGES.map((_, i) => deptRows[`${d.id}-${i}`] || 0));
    const h = LANE_TOP + VPAD * 2 + maxRows * (CH + 10);
    deptH[d.id] = { y: curY, h };
    curY += h + 10;
  });

  // レーン背景
  DEPTS.forEach(d => {
    const { y, h } = deptH[d.id];
    const count = orders.filter(o => (S[o.status]?.deptId || "sales") === d.id).length;
    nodes.push({
      id: `lane-${d.id}`, type: "laneNode",
      position: { x: 20, y },
      data: { d, totalW, h, count },
      selectable: false, draggable: false, zIndex: -10,
    });
  });

  // ステージヘッダー
  STAGES.forEach((st, i) => {
    nodes.push({
      id: `sh-${i}`, type: "default",
      position: { x: i * SW + 20, y: 14 },
      data: { label: st.label },
      style: {
        background: st.color, color: "#fff", border: "none",
        borderRadius: 8, fontSize: 11, fontWeight: 800,
        padding: "5px 18px", pointerEvents: "none",
        fontFamily: "'Noto Sans JP', sans-serif",
        boxShadow: `0 4px 14px ${st.color}77`, letterSpacing: 1,
      },
      selectable: false, draggable: false,
    });
  });

  // 注文カード
  const slots = {};
  orders.forEach(o => {
    const meta = S[o.status] || S["作成予定"];
    const { deptId, stageIdx } = meta;
    const key = `${deptId}-${stageIdx}`;
    const idx = slots[key] || 0;
    slots[key] = idx + 1;
    const { y } = deptH[deptId];
    nodes.push({
      id: `o-${o.mgmtId}`, type: "orderNode",
      position: {
        x: stageIdx * SW + 20 + (SW - CW) / 2,
        y: y + LANE_TOP + VPAD + idx * (CH + 10),
      },
      data: { ...o, meta },
      zIndex: 10,
    });
  });

  return nodes;
}

// ============================================================
// NODE: レーン
// ============================================================
function LaneNode({ data: { d, totalW, h, count } }) {
  return (
    <div style={{ width: totalW, height: h, borderRadius: 12, pointerEvents: "none",
      background: d.color + "09", border: `1.5px solid ${d.color}2a` }}>
      <div style={{ padding: "7px 14px", background: d.color + "1a",
        borderRadius: "10px 10px 0 0", display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 15 }}>{d.icon}</span>
        <span style={{ color: d.color, fontWeight: 800, fontSize: 12,
          fontFamily: "'Noto Sans JP', sans-serif" }}>{d.label}</span>
        <div style={{ marginLeft: "auto", background: d.color, color: "#fff",
          borderRadius: 20, padding: "1px 10px", fontSize: 11, fontWeight: 800,
          boxShadow: count > 0 ? `0 0 10px ${d.color}99` : "none" }}>
          {count}件
        </div>
      </div>
    </div>
  );
}

// ============================================================
// NODE: 注文カード
// ============================================================
function OrderNode({ data, selected }) {
  const { meta } = data;
  const dept = DEPT[meta.deptId] || DEPTS[0];
  return (
    <div style={{
      background: selected ? "#fff" : (bg[data.status] || "#f8fafc"),
      border: `2.5px solid ${selected ? dept.color : meta.color}`,
      borderRadius: 10, width: CW, cursor: "pointer",
      boxShadow: selected ? `0 0 0 3px ${dept.color}44, 0 8px 24px #0003` : "0 2px 10px #0001",
      fontFamily: "'Noto Sans JP', sans-serif", overflow: "hidden", transition: "all 0.18s",
    }}>
      <div style={{
        background: `linear-gradient(90deg, ${dept.color}, ${meta.color})`,
        color: "#fff", padding: "3px 10px", fontSize: 10, fontWeight: 700,
        display: "flex", justifyContent: "space-between",
      }}>
        <span>{dept.icon} {dept.label}</span>
        <span>👤 {data.assignee || "未設定"}</span>
      </div>
      <div style={{ padding: "8px 10px 7px" }}>
        <div style={{ fontWeight: 800, fontSize: 12, color: "#1e293b", marginBottom: 2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {data.client}
        </div>
        <div style={{ color: "#94a3b8", fontSize: 10, fontFamily: "monospace", marginBottom: 5 }}>
          {data.orderNo}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
          <span style={{ background: meta.color + "22", color: meta.color,
            borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
            {meta.icon} {data.status}
          </span>
          <span style={{ color: "#94a3b8", fontSize: 10 }}>{data.orderType}</span>
        </div>
        <div style={{ background: "#e2e8f0", borderRadius: 3, height: 3, marginBottom: 5 }}>
          <div style={{ width: `${meta.progress}%`, height: "100%", borderRadius: 3,
            background: `linear-gradient(90deg, ${dept.color}, ${meta.color})`, transition: "width 0.6s" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b" }}>
          <span>{data.orderAmount > 0 ? `¥${Number(data.orderAmount).toLocaleString()}` : "—"}</span>
          <span style={{ maxWidth: 95, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
            {data.machineName || data.modelCode || ""}
          </span>
        </div>
        {data.memo && (
          <div style={{ marginTop: 4, fontSize: 10, color: "#64748b",
            background: "#f1f5f9", borderRadius: 4, padding: "2px 6px",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            📝 {data.memo}
          </div>
        )}
      </div>
      <Handle type="target" position={Position.Left}
        style={{ background: dept.color, width: 8, height: 8, border: "2px solid #fff" }} />
      <Handle type="source" position={Position.Right}
        style={{ background: dept.color, width: 8, height: 8, border: "2px solid #fff" }} />
    </div>
  );
}

const nodeTypes = { laneNode: LaneNode, orderNode: OrderNode };

// ============================================================
// 担当者入力モーダル（スマホ対応）
// ============================================================
function InputModal({ order, onClose, onSubmit, saving }) {
  const [status, setStatus]     = useState(order?.status || "作成予定");
  const [assignee, setAssignee] = useState(order?.assignee || "");
  const [memo, setMemo]         = useState(order?.memo || "");

  useEffect(() => {
    if (order) { setStatus(order.status || "作成予定"); setAssignee(order.assignee || ""); setMemo(order.memo || ""); }
  }, [order?.mgmtId]);

  if (!order) return null;
  const meta = S[status] || S["作成予定"];
  const dept = DEPT[meta.deptId] || DEPTS[0];

  return (
    <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:2000,
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:12, fontFamily:"'Noto Sans JP', sans-serif" }}>
      <div style={{ background:"#1e293b", borderRadius:16, width:"100%", maxWidth:430,
        boxShadow:"0 24px 64px #000a", border:`2px solid ${dept.color}`, overflow:"hidden" }}>

        {/* ヘッダー */}
        <div style={{ background:`linear-gradient(135deg, ${dept.color}, ${meta.color})`,
          color:"#fff", padding:"14px 18px",
          display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:10, opacity:0.8 }}>{order.orderNo} / {order.orderType}</div>
            <div style={{ fontSize:17, fontWeight:800, marginTop:2 }}>{order.client}</div>
            <div style={{ fontSize:11, opacity:0.75, marginTop:2 }}>
              {order.machineName || order.modelCode || ""}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none",
            color:"#fff", fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        <div style={{ padding:16 }}>
          {/* ボールの場所プレビュー */}
          <div style={{ background: dept.color + "18", border:`1px solid ${dept.color}33`,
            borderRadius:8, padding:"8px 12px", marginBottom:14,
            display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:20 }}>{dept.icon}</span>
            <div>
              <div style={{ color:dept.color, fontWeight:800, fontSize:12 }}>
                ボールは {dept.label} にあります
              </div>
              <div style={{ color:"#64748b", fontSize:10 }}>
                {STAGES[meta.stageIdx]?.label} フェーズ / 進捗 {meta.progress}%
              </div>
            </div>
          </div>

          {/* ステータス選択 */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:"#64748b", marginBottom:8, fontWeight:700 }}>
              📍 ステータスを選択（変更すると全員の画面に反映）
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              {Object.entries(S).map(([s, m]) => (
                <button key={s} onClick={() => setStatus(s)} style={{
                  padding:"9px 10px", borderRadius:8,
                  border:`2px solid ${status === s ? m.color : "#334155"}`,
                  background: status === s ? m.color + "22" : "#0f172a",
                  color: status === s ? m.color : "#475569",
                  fontSize:11, fontWeight:700, cursor:"pointer", textAlign:"left",
                  transition:"all 0.15s", fontFamily:"'Noto Sans JP', sans-serif",
                }}>
                  {m.icon} {s}
                </button>
              ))}
            </div>
          </div>

          {/* 担当者 */}
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#64748b", marginBottom:6, fontWeight:700 }}>👤 担当者名</div>
            <input value={assignee} onChange={e => setAssignee(e.target.value)}
              placeholder="担当者名を入力"
              style={{ width:"100%", padding:"10px 12px", borderRadius:8, boxSizing:"border-box",
                border:"1px solid #334155", background:"#0f172a",
                color:"#e2e8f0", fontSize:14, fontFamily:"'Noto Sans JP', sans-serif" }} />
          </div>

          {/* メモ */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, color:"#64748b", marginBottom:6, fontWeight:700 }}>📝 メモ（任意）</div>
            <textarea value={memo} onChange={e => setMemo(e.target.value)}
              placeholder="作業メモ・連絡事項など" rows={3}
              style={{ width:"100%", padding:"10px 12px", borderRadius:8, boxSizing:"border-box",
                border:"1px solid #334155", background:"#0f172a",
                color:"#e2e8f0", fontSize:13, resize:"none",
                fontFamily:"'Noto Sans JP', sans-serif" }} />
          </div>

          {/* 送信ボタン */}
          <button
            onClick={() => onSubmit({ status, assignee, memo })}
            disabled={saving}
            style={{
              width:"100%", padding:"13px",
              background: saving ? "#334155" : `linear-gradient(90deg, ${dept.color}, ${meta.color})`,
              border:"none", borderRadius:10, color:"#fff",
              fontSize:15, fontWeight:800, cursor: saving ? "not-allowed" : "pointer",
              fontFamily:"'Noto Sans JP', sans-serif",
              boxShadow: saving ? "none" : `0 4px 16px ${dept.color}66`,
              display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              transition:"all 0.2s",
            }}>
            {saving
              ? <><span style={{ animation:"spin 1s linear infinite", display:"inline-block" }}>⏳</span> GASに書き込み中...</>
              : "✅ 全員の画面に反映する"
            }
          </button>
          <div style={{ marginTop:8, textAlign:"center", color:"#475569", fontSize:10 }}>
            ※ Googleスプレッドシートに直接書き込みます。外部サービス不要。
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 左パネル: 部署別 + 担当者別
// ============================================================
function SidePanel({ orders, tab, onTab }) {
  const byDept = {};
  const byPerson = {};
  DEPTS.forEach(d => { byDept[d.id] = { n: 0, amt: 0 }; });
  orders.forEach(o => {
    const deptId = S[o.status]?.deptId || "sales";
    byDept[deptId].n++;
    byDept[deptId].amt += Number(o.orderAmount) || 0;
    const name = o.assignee || "未設定";
    if (!byPerson[name]) byPerson[name] = { n: 0, deptId };
    byPerson[name].n++;
    byPerson[name].deptId = deptId;
  });

  return (
    <div style={{ position:"absolute", top:60, left:12, width:196,
      background:"#1e293b", borderRadius:12, boxShadow:"0 8px 24px #0008",
      zIndex:150, border:"1px solid #334155", overflow:"hidden",
      fontFamily:"'Noto Sans JP', sans-serif",
      maxHeight:"calc(100vh - 80px)", display:"flex", flexDirection:"column" }}>

      {/* タブ */}
      <div style={{ display:"flex", background:"#0f172a", flexShrink:0 }}>
        {[["dept","🏢 部署別"],["person","👤 担当者別"]].map(([v, label]) => (
          <button key={v} onClick={() => onTab(v)} style={{
            flex:1, padding:"7px 4px",
            background: tab === v ? "#1e293b" : "transparent",
            border:"none", borderBottom: tab === v ? "2px solid #3b82f6" : "2px solid transparent",
            color: tab === v ? "#e2e8f0" : "#475569",
            fontSize:10, fontWeight:700, cursor:"pointer",
            fontFamily:"'Noto Sans JP', sans-serif",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ overflowY:"auto", flex:1 }}>
        {tab === "dept"
          ? DEPTS.map(d => {
              const info = byDept[d.id];
              return (
                <div key={d.id} style={{ padding:"9px 12px", borderBottom:"1px solid #0f172a",
                  display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:16 }}>{d.icon}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:d.color, fontWeight:700, fontSize:11 }}>{d.label}</div>
                    {info.amt > 0 && <div style={{ color:"#475569", fontSize:9 }}>¥{info.amt.toLocaleString()}</div>}
                  </div>
                  <div style={{
                    background: info.n > 0 ? d.color : "#334155",
                    color:"#fff", borderRadius:"50%",
                    width:26, height:26, display:"flex",
                    alignItems:"center", justifyContent:"center",
                    fontWeight:800, fontSize:12, flexShrink:0,
                    boxShadow: info.n > 0 ? `0 0 10px ${d.color}99` : "none",
                    transition:"all 0.3s",
                  }}>{info.n}</div>
                </div>
              );
            })
          : Object.entries(byPerson)
              .sort((a, b) => b[1].n - a[1].n)
              .map(([name, info]) => {
                const d = DEPT[info.deptId] || DEPTS[0];
                return (
                  <div key={name} style={{ padding:"8px 12px", borderBottom:"1px solid #0f172a",
                    display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{
                      width:28, height:28, borderRadius:"50%",
                      background:`linear-gradient(135deg, ${d.color}, ${d.color}88)`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      color:"#fff", fontWeight:800, fontSize:13, flexShrink:0,
                    }}>{name[0]}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:"#e2e8f0", fontWeight:700, fontSize:11,
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{name}</div>
                      <div style={{ color:d.color, fontSize:9 }}>{d.icon} {d.label}</div>
                    </div>
                    <div style={{ background:d.color, color:"#fff", borderRadius:"50%",
                      width:22, height:22, display:"flex", alignItems:"center",
                      justifyContent:"center", fontWeight:800, fontSize:11, flexShrink:0 }}>
                      {info.n}
                    </div>
                  </div>
                );
              })
        }
      </div>
    </div>
  );
}

// ============================================================
// ヘッダー
// ============================================================
function Header({ connected, countdown, polling, onTogglePoll, onSync, syncing, lastSync, toast }) {
  return (
    <div style={{ position:"absolute", top:0, left:0, right:0, height:52,
      background:"linear-gradient(90deg, #0f172a, #1e293b)",
      display:"flex", alignItems:"center", padding:"0 14px",
      zIndex:300, gap:10, fontFamily:"'Noto Sans JP', sans-serif",
      borderBottom:"1px solid #334155" }}>

      <span style={{ fontSize:18 }}>📊</span>
      <div style={{ color:"#fff", fontWeight:800, fontSize:14 }}>業務フロー進捗管理</div>
      <div style={{ color:"#38bdf8", fontWeight:700, fontSize:10,
        background:"#0ea5e922", border:"1px solid #0ea5e944",
        borderRadius:6, padding:"2px 8px" }}>× VR3</div>

      {/* トースト通知 */}
      {toast && (
        <div style={{ background:"#10b981", color:"#fff", borderRadius:20,
          padding:"3px 14px", fontSize:11, fontWeight:700, animation:"fadeIn 0.3s" }}>
          ✅ {toast}
        </div>
      )}

      <div style={{ flex:1 }} />

      {/* GAS接続状態 */}
      <div style={{ display:"flex", alignItems:"center", gap:5, padding:"3px 10px",
        background: connected ? "#10b98115" : "#ef444415",
        border:`1px solid ${connected ? "#10b98133" : "#ef444433"}`,
        borderRadius:20 }}>
        <div style={{ width:7, height:7, borderRadius:"50%",
          background: connected ? "#10b981" : "#6b7280",
          animation: connected && polling ? "pulse 1.5s infinite" : "none" }} />
        <span style={{ color: connected ? "#10b981" : "#94a3b8", fontSize:10, fontWeight:700 }}>
          {connected ? `GAS接続 (${countdown}s)` : "デモモード"}
        </span>
      </div>

      {/* ポーリングON/OFF */}
      <button onClick={onTogglePoll} style={{
        padding:"4px 12px",
        background: polling ? "#10b98122" : "#334155",
        border:`1px solid ${polling ? "#10b98144" : "#475569"}`,
        borderRadius:20, color: polling ? "#10b981" : "#64748b",
        fontSize:10, fontWeight:700, cursor:"pointer",
        fontFamily:"'Noto Sans JP', sans-serif",
      }}>
        {polling ? "🔄 自動更新ON" : "⏸ 自動更新OFF"}
      </button>

      {/* 手動同期 */}
      <button onClick={onSync} disabled={syncing} style={{
        padding:"5px 12px", background: syncing ? "#334155" : "#3b82f6",
        border:"none", borderRadius:6, color:"#fff",
        fontSize:10, fontWeight:700, cursor: syncing ? "not-allowed" : "pointer",
        display:"flex", alignItems:"center", gap:4,
        fontFamily:"'Noto Sans JP', sans-serif",
      }}>
        <span style={{ animation: syncing ? "spin 1s linear infinite" : "none", display:"inline-block" }}>🔄</span>
        {syncing ? "同期中" : "今すぐ同期"}
      </button>

      <div style={{ color:"#334155", fontSize:9, whiteSpace:"nowrap" }}>{lastSync}</div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [orders, setOrders]       = useState([]);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges]         = useState([]);
  const [modal, setModal]         = useState(null);   // 入力モーダル対象
  const [saving, setSaving]       = useState(false);
  const [tab, setTab]             = useState("dept");
  const [connected, setConnected] = useState(false);
  const [polling, setPolling]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [lastSync, setLastSync]   = useState("");
  const [countdown, setCountdown] = useState(POLL_SEC);
  const [toast, setToast]         = useState("");
  const pollTimer  = useRef(null);
  const cntTimer   = useRef(null);

  function applyOrders(list) {
    setOrders(list);
    setNodes(buildFlow(list));
  }

  async function fetchOrders(quiet = false) {
    if (!quiet) setSyncing(true);
    try {
      const r = await Api.getOrders();
      if (r.success && r.items?.length) {
        const mapped = r.items.map(o => ({
          mgmtId: o.mgmtId || o.id,
          orderNo: o.orderNo || "—",
          client: o.client || o.destCompany || "—",
          status: o.status || "作成予定",
          orderAmount: o.orderAmount || 0,
          modelCode: o.modelCode || "",
          machineName: o.machineName || "",
          orderType: o.orderType || "",
          assignee: o.assignee || "",
          memo: o.memo || "",
          boards: o.boards || [],
        }));
        applyOrders(mapped);
        setConnected(true);
      }
    } catch {
      if (!connected) applyOrders(MOCK);
    } finally {
      if (!quiet) setSyncing(false);
      setLastSync(new Date().toLocaleTimeString("ja-JP"));
      setCountdown(POLL_SEC);
    }
  }

  // ポーリング制御
  useEffect(() => {
    clearInterval(pollTimer.current);
    clearInterval(cntTimer.current);
    if (polling) {
      pollTimer.current = setInterval(() => fetchOrders(true), POLL_SEC * 1000);
      cntTimer.current  = setInterval(() => setCountdown(c => c <= 1 ? POLL_SEC : c - 1), 1000);
    }
    return () => { clearInterval(pollTimer.current); clearInterval(cntTimer.current); };
  }, [polling, connected]);

  // 初期ロード
  useEffect(() => {
    applyOrders(MOCK);
    fetchOrders(false);
  }, []);

  // 担当者がモーダルで送信
  async function handleSubmit({ status, assignee, memo }) {
    if (!modal) return;
    setSaving(true);
    try {
      // GAS updateMgmt にステータス・担当者・メモを書き込む
      await Api.updateOrder(modal.mgmtId, { status, assignee, memo });
      // ローカルにも即時反映（UIをすぐに動かす）
      applyOrders(orders.map(o =>
        o.mgmtId === modal.mgmtId ? { ...o, status, assignee, memo } : o
      ));
      showToast(`${modal.client} → ${status}`);
    } finally {
      setSaving(false);
      setModal(null);
    }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const onNodeClick = useCallback((_, node) => {
    if (node.type === "orderNode") setModal(node.data);
  }, []);

  return (
    <div style={{ width:"100%", height:"100vh", background:"#0f172a", position:"relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes fadeIn  { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:#0f172a; }
        ::-webkit-scrollbar-thumb { background:#334155; border-radius:4px; }
      `}</style>

      <Header
        connected={connected}
        countdown={countdown}
        polling={polling}
        onTogglePoll={() => setPolling(v => !v)}
        onSync={() => fetchOrders(false)}
        syncing={syncing}
        lastSync={lastSync}
        toast={toast}
      />

      <div style={{ position:"absolute", top:52, left:0, right:0, bottom:0 }}>
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onPaneClick={() => {}}
          nodeTypes={nodeTypes}
          fitView fitViewOptions={{ padding:0.08 }}
          minZoom={0.1} maxZoom={2.5}
          style={{ background:"#0f172a" }}
        >
          <MiniMap
            nodeColor={n => {
              if (n.type === "laneNode") return n.data?.d?.color + "44" || "#1e293b";
              return S[n.data?.status]?.color || "#334155";
            }}
            style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8 }}
          />
          <Controls style={{ bottom:20 }} />
          <Background color="#1e293b" gap={24} size={1} />
        </ReactFlow>

        <SidePanel orders={orders} tab={tab} onTab={setTab} />
      </div>

      <InputModal order={modal} onClose={() => setModal(null)} onSubmit={handleSubmit} saving={saving} />
    </div>
  );
}
