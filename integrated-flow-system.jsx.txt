import { useState, useCallback, useEffect, useRef } from "react";
import ReactFlow, {
  MiniMap, Controls, Background,
  useNodesState, useEdgesState, addEdge,
  Handle, Position, MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";

// ============================================================
// CONFIG - GASのWebアプリURLをここに設定
// ============================================================
const GAS_API_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
// 本番環境では上記URLを実際のGAS WebアプリURLに置き換えてください

// ============================================================
// API LAYER - 見積管理VR3との連携
// ============================================================
const GasApi = {
  async call(action, payload = {}) {
    try {
      const url = new URL(GAS_API_URL);
      url.searchParams.set("action", action);
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
        mode: "no-cors", // GAS CORS対応
      });
      // no-corsの場合はレスポンスが読めないのでGETで対応
      return await this.callGet(action, payload);
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
  async callGet(action, payload = {}) {
    try {
      const url = new URL(GAS_API_URL);
      url.searchParams.set("action", action);
      Object.entries(payload).forEach(([k, v]) =>
        url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : v)
      );
      const res = await fetch(url.toString());
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
  // 見積管理VR3: 注文一覧 + 基板情報取得
  async getOrdersWithBoardInfo() {
    return this.callGet("boardGetOrders", {});
  },
  // 見積管理VR3: 全注文取得
  async getAll() {
    return this.callGet("getAll", {});
  },
  // 見積管理VR3: ステータス更新
  async updateStatus(mgmtId, newStatus) {
    return this.callGet("updateStatus", { mgmtId, newStatus });
  },
  // 見積管理VR3: 基板分析データ
  async getBoardAnalysis() {
    return this.callGet("boardGetAnalysis", {});
  },
};

// ============================================================
// STATUS & DEPT CONFIG
// ============================================================
const ORDER_STATUS_MAP = {
  "作成予定":   { color: "#94a3b8", bg: "#f1f5f9", icon: "📋", flowStatus: "waiting" },
  "送信済み":   { color: "#3b82f6", bg: "#eff6ff", icon: "📤", flowStatus: "inProgress" },
  "受領":       { color: "#f59e0b", bg: "#fffbeb", icon: "📥", flowStatus: "review" },
  "受注済み":   { color: "#10b981", bg: "#ecfdf5", icon: "✅", flowStatus: "done" },
  "保留":       { color: "#8b5cf6", bg: "#f5f3ff", icon: "⏸", flowStatus: "waiting" },
  "キャンセル": { color: "#ef4444", bg: "#fef2f2", icon: "❌", flowStatus: "blocked" },
  "失注":       { color: "#ef4444", bg: "#fef2f2", icon: "✕",  flowStatus: "blocked" },
  "納品済み":   { color: "#059669", bg: "#d1fae5", icon: "🏁", flowStatus: "done" },
};

const FLOW_STAGE_LABELS = [
  "受注入力", "見積作成", "見積送付", "受領確認",
  "製造手配", "品質検査", "出荷準備", "納品完了",
];

const STAGE_COLORS = [
  "#6366f1","#3b82f6","#0ea5e9","#10b981",
  "#f59e0b","#ef4444","#8b5cf6","#059669",
];

// ============================================================
// GASデータ → フローノード変換
// ============================================================
function orderToNode(order, idx) {
  const st = ORDER_STATUS_MAP[order.status] || ORDER_STATUS_MAP["作成予定"];
  const stageIdx = {
    "作成予定": 0, "送信済み": 2, "受領": 3,
    "受注済み": 4, "保留": 1, "キャンセル": 0,
    "失注": 0, "納品済み": 7,
  }[order.status] ?? 0;

  const col = stageIdx;
  const row = idx;

  return {
    id: `order-${order.mgmtId || order.id || idx}`,
    type: "orderNode",
    position: { x: col * 220 + 20, y: row * 130 + 20 },
    data: {
      mgmtId: order.mgmtId || order.id,
      orderNo: order.orderNo || "—",
      client: order.client || order.destCompany || "—",
      status: order.status || "作成予定",
      orderDate: order.orderDate || "",
      orderAmount: order.orderAmount || 0,
      modelCode: order.modelCode || "",
      machineName: order.machineName || "",
      boards: order.boards || [],
      orderType: order.orderType || "",
      stageIdx,
      statusMeta: st,
    },
  };
}

// ============================================================
// CUSTOM NODE: 注文ノード（GASデータ連携）
// ============================================================
function OrderNode({ data, selected }) {
  const st = data.statusMeta || ORDER_STATUS_MAP["作成予定"];
  const stageColor = STAGE_COLORS[data.stageIdx] || "#64748b";

  return (
    <div style={{
      background: selected ? "#fff" : st.bg,
      border: `2px solid ${selected ? stageColor : st.color}`,
      borderRadius: 10,
      minWidth: 190,
      maxWidth: 210,
      boxShadow: selected ? `0 0 0 3px ${stageColor}44, 0 8px 24px #0002` : "0 2px 8px #0001",
      fontFamily: "'Noto Sans JP', sans-serif",
      overflow: "hidden",
      transition: "all 0.2s",
      fontSize: 11,
    }}>
      {/* Stage header */}
      <div style={{
        background: stageColor,
        color: "#fff",
        padding: "3px 10px",
        display: "flex",
        justifyContent: "space-between",
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: 0.5,
      }}>
        <span>{FLOW_STAGE_LABELS[data.stageIdx]}</span>
        <span style={{ opacity: 0.8 }}>{data.orderType}</span>
      </div>

      <div style={{ padding: "8px 10px 6px" }}>
        {/* Client */}
        <div style={{ fontWeight: 700, fontSize: 12, color: "#1e293b", marginBottom: 3,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {data.client}
        </div>

        {/* Order No */}
        <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4, fontFamily: "monospace" }}>
          {data.orderNo}
        </div>

        {/* Status badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          background: st.color + "22", color: st.color,
          borderRadius: 20, padding: "2px 7px",
          fontSize: 10, fontWeight: 700, marginBottom: 5,
        }}>
          <span>{st.icon}</span><span>{data.status}</span>
        </div>

        {/* Amount */}
        {data.orderAmount > 0 && (
          <div style={{ color: "#475569", fontSize: 10, marginBottom: 3 }}>
            ¥{Number(data.orderAmount).toLocaleString()}
          </div>
        )}

        {/* Machine / Board info */}
        {data.machineName && (
          <div style={{
            background: stageColor + "15",
            border: `1px solid ${stageColor}44`,
            borderRadius: 4, padding: "2px 6px",
            color: stageColor, fontSize: 10, fontWeight: 600,
          }}>
            🔧 {data.machineName}
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Left}
        style={{ background: stageColor, width: 8, height: 8, border: "2px solid #fff" }} />
      <Handle type="source" position={Position.Right}
        style={{ background: stageColor, width: 8, height: 8, border: "2px solid #fff" }} />
    </div>
  );
}

// ============================================================
// STAGE COLUMN HEADER NODE
// ============================================================
function StageHeaderNode({ data }) {
  return (
    <div style={{
      background: data.color,
      color: "#fff",
      borderRadius: 8,
      padding: "6px 16px",
      fontFamily: "'Noto Sans JP', sans-serif",
      fontWeight: 800,
      fontSize: 12,
      letterSpacing: 1,
      boxShadow: `0 4px 16px ${data.color}66`,
      whiteSpace: "nowrap",
      pointerEvents: "none",
    }}>
      {data.label}
    </div>
  );
}

const nodeTypes = { orderNode: OrderNode, stageHeader: StageHeaderNode };

// ============================================================
// HEADER
// ============================================================
function Header({ apiUrl, onSetUrl, connected, onSync, syncing, lastSync }) {
  const [editing, setEditing] = useState(false);
  const [tmpUrl, setTmpUrl] = useState(apiUrl);

  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, height: 52,
      background: "linear-gradient(90deg, #0f172a 0%, #1e293b 100%)",
      display: "flex", alignItems: "center", padding: "0 16px",
      zIndex: 200, gap: 12, fontFamily: "'Noto Sans JP', sans-serif",
      borderBottom: "1px solid #334155",
    }}>
      <div style={{ color: "#fff", fontWeight: 800, fontSize: 14, letterSpacing: 1, whiteSpace: "nowrap" }}>
        📊 業務フロー ×
      </div>
      <div style={{
        color: "#38bdf8", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap",
        background: "#0ea5e922", border: "1px solid #0ea5e944",
        borderRadius: 6, padding: "2px 10px",
      }}>
        見積管理 VR3
      </div>

      <div style={{ flex: 1 }} />

      {/* API URL設定 */}
      {editing ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            value={tmpUrl}
            onChange={e => setTmpUrl(e.target.value)}
            placeholder="GAS WebアプリURL"
            style={{
              width: 420, padding: "4px 10px", borderRadius: 6,
              border: "1px solid #334155", background: "#0f172a",
              color: "#e2e8f0", fontSize: 11, fontFamily: "monospace",
            }}
          />
          <button onClick={() => { onSetUrl(tmpUrl); setEditing(false); }}
            style={{ padding: "4px 12px", background: "#3b82f6", color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
            保存
          </button>
          <button onClick={() => setEditing(false)}
            style={{ padding: "4px 10px", background: "#334155", color: "#94a3b8",
              border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>
            キャンセル
          </button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)}
          style={{
            padding: "4px 12px", background: "#1e293b",
            border: "1px solid #334155", borderRadius: 6,
            color: "#94a3b8", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap",
          }}>
          🔧 API URL設定
        </button>
      )}

      {/* 接続状態 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        background: connected ? "#10b98122" : "#ef444422",
        border: `1px solid ${connected ? "#10b98144" : "#ef444444"}`,
        borderRadius: 20, padding: "3px 12px",
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: "50%",
          background: connected ? "#10b981" : "#ef4444",
          boxShadow: connected ? "0 0 6px #10b981" : "none",
          animation: connected ? "pulse 2s infinite" : "none",
        }} />
        <span style={{ color: connected ? "#10b981" : "#ef4444", fontSize: 11, fontWeight: 700 }}>
          {connected ? "接続中" : "未接続"}
        </span>
      </div>

      {/* 同期ボタン */}
      <button
        onClick={onSync}
        disabled={syncing}
        style={{
          padding: "5px 14px", background: syncing ? "#334155" : "#3b82f6",
          border: "none", borderRadius: 6, color: "#fff",
          fontSize: 11, fontWeight: 700, cursor: syncing ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
          transition: "all 0.2s",
        }}>
        <span style={{ display: "inline-block", animation: syncing ? "spin 1s linear infinite" : "none" }}>
          🔄
        </span>
        {syncing ? "同期中..." : "VR3から同期"}
      </button>

      <div style={{ color: "#475569", fontSize: 10, whiteSpace: "nowrap" }}>
        {lastSync || "--:--"}
      </div>
    </div>
  );
}

// ============================================================
// DETAIL PANEL (注文詳細 + ステータス変更)
// ============================================================
function DetailPanel({ node, onClose, onStatusChange, updating }) {
  if (!node) return null;
  const d = node.data;
  const stageColor = STAGE_COLORS[d.stageIdx] || "#64748b";

  return (
    <div style={{
      position: "absolute", top: 64, right: 16,
      width: 300, background: "#1e293b",
      borderRadius: 14, boxShadow: "0 16px 48px #000a",
      zIndex: 100, fontFamily: "'Noto Sans JP', sans-serif",
      overflow: "hidden", border: `2px solid ${stageColor}`,
    }}>
      <div style={{ background: stageColor, color: "#fff", padding: "12px 16px",
        display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 2 }}>
            {d.orderType} / {FLOW_STAGE_LABELS[d.stageIdx]}
          </div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{d.client}</div>
          <div style={{ fontSize: 10, opacity: 0.7, fontFamily: "monospace" }}>{d.orderNo}</div>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#fff",
          fontSize: 20, cursor: "pointer", lineHeight: 1,
        }}>×</button>
      </div>

      <div style={{ padding: 14 }}>
        {/* Info grid */}
        <div style={{ background: "#0f172a", borderRadius: 8, padding: 10, marginBottom: 12 }}>
          {[
            ["注文日", d.orderDate],
            ["機種名", d.machineName || "—"],
            ["機種コード", d.modelCode || "—"],
            ["受注金額", d.orderAmount > 0 ? `¥${Number(d.orderAmount).toLocaleString()}` : "—"],
          ].map(([label, val]) => (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between",
              marginBottom: 5, fontSize: 11, color: "#94a3b8",
            }}>
              <span>{label}</span>
              <strong style={{ color: "#e2e8f0", maxWidth: 160,
                textAlign: "right", wordBreak: "break-all" }}>{val}</strong>
            </div>
          ))}
        </div>

        {/* Boards */}
        {d.boards && d.boards.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6, fontWeight: 700 }}>
              🔧 関連基板
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {d.boards.map((b, i) => (
                <span key={i} style={{
                  background: stageColor + "22", color: stageColor,
                  border: `1px solid ${stageColor}44`,
                  borderRadius: 4, padding: "2px 7px", fontSize: 10, fontWeight: 600,
                }}>
                  {b.type}: {b.name || b.id}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ステータス変更 → VR3に反映 */}
        <div>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8, fontWeight: 700 }}>
            ステータス変更（VR3に即時反映）
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {Object.entries(ORDER_STATUS_MAP).map(([status, meta]) => (
              <button
                key={status}
                disabled={updating || d.status === status}
                onClick={() => onStatusChange(d.mgmtId, status)}
                style={{
                  padding: "4px 9px",
                  borderRadius: 20,
                  border: `2px solid ${d.status === status ? meta.color : "#334155"}`,
                  background: d.status === status ? meta.color : "#0f172a",
                  color: d.status === status ? "#fff" : "#64748b",
                  fontSize: 10, fontWeight: 700, cursor: updating ? "not-allowed" : "pointer",
                  opacity: updating && d.status !== status ? 0.5 : 1,
                  transition: "all 0.15s",
                }}>
                {meta.icon} {status}
              </button>
            ))}
          </div>
          {updating && (
            <div style={{ color: "#3b82f6", fontSize: 10, marginTop: 8, textAlign: "center" }}>
              ⏳ VR3スプレッドシートに書き込み中...
            </div>
          )}
        </div>

        {/* VR3ダッシュボードへのリンク */}
        <a
          href={`${GAS_API_URL}?page=bom`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block", marginTop: 12, textAlign: "center",
            padding: "8px", background: "#0ea5e922",
            border: "1px solid #0ea5e944",
            borderRadius: 8, color: "#38bdf8",
            fontWeight: 700, fontSize: 11, textDecoration: "none",
          }}>
          🔗 VR3 BOMダッシュボードで詳細確認
        </a>
      </div>
    </div>
  );
}

// ============================================================
// STATS BAR
// ============================================================
function StatsBar({ orders }) {
  const statusCounts = {};
  let totalAmount = 0;
  orders.forEach(o => {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    totalAmount += Number(o.orderAmount) || 0;
  });

  return (
    <div style={{
      position: "absolute", bottom: 16, left: "50%",
      transform: "translateX(-50%)",
      background: "#1e293b",
      borderRadius: 40, padding: "8px 20px",
      boxShadow: "0 4px 20px #0006",
      display: "flex", alignItems: "center", gap: 14,
      zIndex: 100, fontFamily: "'Noto Sans JP', sans-serif",
      fontSize: 11, border: "1px solid #334155",
      whiteSpace: "nowrap",
    }}>
      {Object.entries(ORDER_STATUS_MAP)
        .filter(([st]) => statusCounts[st] > 0)
        .map(([st, meta]) => (
          <div key={st} style={{ display: "flex", alignItems: "center", gap: 4, color: meta.color }}>
            <span>{meta.icon}</span>
            <span style={{ color: "#94a3b8" }}>{st}</span>
            <span style={{ background: meta.color + "22", borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>
              {statusCounts[st]}
            </span>
          </div>
        ))}
      <div style={{ width: 1, height: 18, background: "#334155" }} />
      <div style={{ color: "#e2e8f0", fontWeight: 700 }}>
        合計 <span style={{ color: "#38bdf8" }}>¥{totalAmount.toLocaleString()}</span>
      </div>
      <div style={{ color: "#64748b", fontSize: 10 }}>
        {orders.length}件
      </div>
    </div>
  );
}

// ============================================================
// MOCK DATA (API未接続時のデモデータ)
// ============================================================
function generateMockOrders() {
  return [
    { mgmtId: "M001", orderNo: "ORD-2025-001", client: "株式会社山田製作所", status: "受注済み",
      orderDate: "2025/05/01", orderAmount: 1850000, modelCode: "MD-001",
      machineName: "精密加工機A", boards: [{ type: "M基板", name: "MB-01" }], orderType: "修理" },
    { mgmtId: "M002", orderNo: "ORD-2025-002", client: "田中電機株式会社", status: "送信済み",
      orderDate: "2025/05/03", orderAmount: 420000, modelCode: "MD-002",
      machineName: "制御盤B", boards: [{ type: "C基板", name: "CB-01" }], orderType: "修理" },
    { mgmtId: "M003", orderNo: "ORD-2025-003", client: "佐藤工業", status: "受領",
      orderDate: "2025/05/05", orderAmount: 780000, modelCode: "MD-003",
      machineName: "サーボモータC", boards: [{ type: "D基板", name: "DB-01" }, { type: "E基板", name: "EB-01" }], orderType: "部品交換" },
    { mgmtId: "M004", orderNo: "ORD-2025-004", client: "グリーンテック株式会社", status: "作成予定",
      orderDate: "2025/05/07", orderAmount: 250000, modelCode: "MD-004",
      machineName: "", boards: [], orderType: "点検" },
    { mgmtId: "M005", orderNo: "ORD-2025-005", client: "鈴木精機", status: "納品済み",
      orderDate: "2025/04/28", orderAmount: 3200000, modelCode: "MD-005",
      machineName: "高速プレスE", boards: [{ type: "M基板", name: "MB-02" }, { type: "S基板", name: "SB-01" }], orderType: "オーバーホール" },
    { mgmtId: "M006", orderNo: "ORD-2025-006", client: "ナカムラ産業", status: "保留",
      orderDate: "2025/05/06", orderAmount: 560000, modelCode: "MD-006",
      machineName: "インバータF", boards: [{ type: "DE基板", name: "DEB-01" }], orderType: "修理" },
    { mgmtId: "M007", orderNo: "ORD-2025-007", client: "東部エンジニアリング", status: "受注済み",
      orderDate: "2025/05/04", orderAmount: 920000, modelCode: "MD-007",
      machineName: "NC旋盤G", boards: [{ type: "M基板", name: "MB-03" }], orderType: "修理" },
    { mgmtId: "M008", orderNo: "ORD-2025-008", client: "西日本メカトロ", status: "送信済み",
      orderDate: "2025/05/08", orderAmount: 340000, modelCode: "MD-002",
      machineName: "制御盤B", boards: [{ type: "C基板", name: "CB-02" }], orderType: "部品交換" },
  ];
}

// ============================================================
// EDGE生成: 同一機種コードの注文を繋ぐ
// ============================================================
function buildEdgesFromOrders(orders, nodeIdMap) {
  const edges = [];
  const byModel = {};
  orders.forEach(o => {
    if (!o.modelCode) return;
    if (!byModel[o.modelCode]) byModel[o.modelCode] = [];
    byModel[o.modelCode].push(o.mgmtId);
  });

  // ステージ順にエッジを張る
  const statusOrder = ["作成予定","送信済み","受領","受注済み","納品済み"];
  orders.slice().sort((a, b) =>
    statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
  ).reduce((prev, curr) => {
    if (prev && prev.modelCode && prev.modelCode === curr.modelCode) {
      const sid = `e-${prev.mgmtId}-${curr.mgmtId}`;
      if (!edges.find(e => e.id === sid)) {
        edges.push({
          id: sid,
          source: `order-${prev.mgmtId}`,
          target: `order-${curr.mgmtId}`,
          style: { stroke: "#334155", strokeWidth: 1.5, strokeDasharray: "4 3" },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#334155" },
        });
      }
    }
    return curr;
  }, null);

  return edges;
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [gasApiUrl, setGasApiUrl] = useState(GAS_API_URL);
  const [orders, setOrders] = useState([]);
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const [usingMock, setUsingMock] = useState(true);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selected, setSelected] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  // ステージヘッダーノードを生成
  function buildStageHeaders() {
    return FLOW_STAGE_LABELS.map((label, i) => ({
      id: `stage-${i}`,
      type: "stageHeader",
      position: { x: i * 220 + 20, y: -50 },
      data: { label, color: STAGE_COLORS[i] },
      draggable: false,
      selectable: false,
    }));
  }

  // ordersからノード・エッジを構築
  function rebuildFlow(orderList) {
    // 同じステージ内でy位置を管理
    const stageCounts = {};
    const builtNodes = orderList.map(order => {
      const st = ORDER_STATUS_MAP[order.status] || ORDER_STATUS_MAP["作成予定"];
      const stageIdx = {
        "作成予定": 0, "送信済み": 1, "受領": 2,
        "受注済み": 3, "保留": 0, "キャンセル": 0,
        "失注": 0, "納品済み": 7,
      }[order.status] ?? 0;
      stageCounts[stageIdx] = (stageCounts[stageIdx] || 0);
      const rowIdx = stageCounts[stageIdx]++;
      return {
        id: `order-${order.mgmtId}`,
        type: "orderNode",
        position: { x: stageIdx * 220 + 20, y: rowIdx * 135 + 20 },
        data: {
          mgmtId: order.mgmtId,
          orderNo: order.orderNo || "—",
          client: order.client || "—",
          status: order.status || "作成予定",
          orderDate: order.orderDate || "",
          orderAmount: order.orderAmount || 0,
          modelCode: order.modelCode || "",
          machineName: order.machineName || "",
          boards: order.boards || [],
          orderType: order.orderType || "",
          stageIdx,
          statusMeta: ORDER_STATUS_MAP[order.status] || ORDER_STATUS_MAP["作成予定"],
        },
      };
    });

    const stageHeaders = buildStageHeaders();
    const builtEdges = buildEdgesFromOrders(orderList, {});
    setNodes([...stageHeaders, ...builtNodes]);
    setEdges(builtEdges);
  }

  // GAS APIから同期
  async function syncFromVR3() {
    setSyncing(true);
    setError("");
    try {
      const result = await GasApi.getOrdersWithBoardInfo();
      if (result.success && result.items && result.items.length > 0) {
        setOrders(result.items);
        rebuildFlow(result.items);
        setConnected(true);
        setUsingMock(false);
        setLastSync(new Date().toLocaleTimeString("ja-JP") + " (VR3)");
      } else {
        // フォールバック: getAll
        const r2 = await GasApi.getAll();
        if (r2.success && r2.items) {
          const mapped = r2.items.map(o => ({
            mgmtId: o.id || o.mgmtId,
            orderNo: o.orderNo,
            client: o.client,
            status: o.status,
            orderDate: o.orderDate,
            orderAmount: o.orderAmount,
            modelCode: o.modelCode || "",
            machineName: "",
            boards: [],
            orderType: o.orderType || "",
          }));
          setOrders(mapped);
          rebuildFlow(mapped);
          setConnected(true);
          setUsingMock(false);
          setLastSync(new Date().toLocaleTimeString("ja-JP") + " (VR3)");
        } else {
          throw new Error(result.error || "データ取得失敗");
        }
      }
    } catch (e) {
      setError(`VR3接続エラー: ${e.message} — デモデータを表示中`);
      setConnected(false);
      loadMockData();
    } finally {
      setSyncing(false);
    }
  }

  function loadMockData() {
    const mock = generateMockOrders();
    setOrders(mock);
    rebuildFlow(mock);
    setUsingMock(true);
    setLastSync(new Date().toLocaleTimeString("ja-JP") + " (デモ)");
  }

  // ステータス更新 → VR3スプレッドシートに反映
  async function handleStatusChange(mgmtId, newStatus) {
    if (!mgmtId) return;
    setUpdating(true);
    setError("");
    try {
      if (!usingMock) {
        const result = await GasApi.updateStatus(mgmtId, newStatus);
        if (!result.success) throw new Error(result.error);
      }
      // ローカル状態を更新
      const updated = orders.map(o =>
        o.mgmtId === mgmtId ? { ...o, status: newStatus } : o
      );
      setOrders(updated);
      rebuildFlow(updated);
      // 選択中ノードも更新
      if (selected && selected.data.mgmtId === mgmtId) {
        setSelected(prev => ({
          ...prev,
          data: {
            ...prev.data,
            status: newStatus,
            statusMeta: ORDER_STATUS_MAP[newStatus],
          }
        }));
      }
      if (!usingMock) {
        setLastSync(new Date().toLocaleTimeString("ja-JP") + " (VR3更新済)");
      }
    } catch (e) {
      setError(`ステータス更新エラー: ${e.message}`);
    } finally {
      setUpdating(false);
    }
  }

  // 初期ロード
  useEffect(() => {
    loadMockData();
  }, []);

  const onNodeClick = useCallback((_, node) => {
    if (node.type === "orderNode") setSelected(node);
  }, []);
  const onPaneClick = useCallback(() => setSelected(null), []);
  const onConnect = useCallback(
    (params) => setEdges(eds => addEdge(params, eds)), [setEdges]
  );

  return (
    <div style={{ width: "100%", height: "100vh", background: "#0f172a", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      `}</style>

      <Header
        apiUrl={gasApiUrl}
        onSetUrl={(url) => { setGasApiUrl(url); }}
        connected={connected}
        onSync={syncFromVR3}
        syncing={syncing}
        lastSync={lastSync}
      />

      {/* エラー表示 */}
      {error && (
        <div style={{
          position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)",
          background: "#7f1d1d", border: "1px solid #ef4444",
          borderRadius: 8, padding: "6px 16px",
          color: "#fca5a5", fontSize: 11, zIndex: 300,
          fontFamily: "'Noto Sans JP', sans-serif",
          maxWidth: "80%", textAlign: "center",
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* デモ表示バナー */}
      {usingMock && !error && (
        <div style={{
          position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)",
          background: "#78350f", border: "1px solid #f59e0b",
          borderRadius: 8, padding: "5px 16px",
          color: "#fcd34d", fontSize: 11, zIndex: 300,
          fontFamily: "'Noto Sans JP', sans-serif",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span>🎭 デモデータ表示中</span>
          <span style={{ color: "#94a3b8" }}>—</span>
          <span>API URLを設定して「VR3から同期」を押すと実データが表示されます</span>
        </div>
      )}

      <div style={{ position: "absolute", top: 52, left: 0, right: 0, bottom: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.2}
          maxZoom={2.5}
          style={{ background: "#0f172a" }}
        >
          <MiniMap
            nodeColor={n => {
              const st = n.data?.status;
              return st ? (ORDER_STATUS_MAP[st]?.color || "#334155") : "#334155";
            }}
            style={{
              background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
            }}
          />
          <Controls style={{ bottom: 56 }} />
          <Background color="#1e293b" gap={24} size={1} />
        </ReactFlow>

        <DetailPanel
          node={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
          updating={updating}
        />

        <StatsBar orders={orders} />
      </div>
    </div>
  );
}
