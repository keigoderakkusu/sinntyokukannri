import { useState, useCallback, useEffect } from "react";
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";

// ===== STATUS CONFIG =====
const STATUS = {
  waiting:    { label: "待機中",   color: "#94a3b8", bg: "#f1f5f9", icon: "⏸" },
  inProgress: { label: "進行中",   color: "#3b82f6", bg: "#eff6ff", icon: "▶" },
  review:     { label: "確認中",   color: "#f59e0b", bg: "#fffbeb", icon: "🔍" },
  done:       { label: "完了",     color: "#10b981", bg: "#ecfdf5", icon: "✓" },
  blocked:    { label: "ブロック", color: "#ef4444", bg: "#fef2f2", icon: "✕" },
};

const DEPARTMENTS = ["営業部", "製造部", "品質管理", "物流部", "経理部"];
const DEPT_COLORS = {
  "営業部":   "#6366f1",
  "製造部":   "#f59e0b",
  "品質管理": "#10b981",
  "物流部":   "#3b82f6",
  "経理部":   "#ec4899",
};

// ===== CUSTOM NODE =====
function ProcessNode({ data, selected }) {
  const st = STATUS[data.status] || STATUS.waiting;
  const deptColor = DEPT_COLORS[data.dept] || "#64748b";

  return (
    <div
      style={{
        background: selected ? "#fff" : st.bg,
        border: `2px solid ${selected ? deptColor : st.color}`,
        borderRadius: 12,
        minWidth: 180,
        boxShadow: selected
          ? `0 0 0 3px ${deptColor}44, 0 8px 24px #0002`
          : "0 2px 8px #0001",
        fontFamily: "'Noto Sans JP', sans-serif",
        overflow: "hidden",
        transition: "all 0.2s ease",
      }}
    >
      {/* Dept header */}
      <div
        style={{
          background: deptColor,
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
          padding: "3px 10px",
          letterSpacing: 1,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{data.dept}</span>
        <span style={{ opacity: 0.8 }}>{data.assignee}</span>
      </div>

      {/* Body */}
      <div style={{ padding: "10px 12px 8px" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b", marginBottom: 6 }}>
          {data.label}
        </div>

        {/* Status badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: st.color + "22",
            color: st.color,
            borderRadius: 20,
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          <span>{st.icon}</span>
          <span>{st.label}</span>
        </div>

        {/* Progress bar */}
        <div style={{ background: "#e2e8f0", borderRadius: 4, height: 4, marginBottom: 6 }}>
          <div
            style={{
              width: `${data.progress}%`,
              height: "100%",
              borderRadius: 4,
              background: st.color,
              transition: "width 0.5s ease",
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}>
          <span>進捗 {data.progress}%</span>
          <span>期限: {data.deadline}</span>
        </div>
      </div>

      <Handle type="target" position={Position.Left} style={{ background: deptColor, width: 10, height: 10 }} />
      <Handle type="source" position={Position.Right} style={{ background: deptColor, width: 10, height: 10 }} />
    </div>
  );
}

const nodeTypes = { process: ProcessNode };

// ===== INITIAL DATA =====
const initialNodes = [
  {
    id: "1",
    type: "process",
    position: { x: 30, y: 60 },
    data: { label: "受注入力", dept: "営業部", assignee: "田中", status: "done", progress: 100, deadline: "5/8" },
  },
  {
    id: "2",
    type: "process",
    position: { x: 270, y: 20 },
    data: { label: "製品設計確認", dept: "製造部", assignee: "佐藤", status: "done", progress: 100, deadline: "5/9" },
  },
  {
    id: "3",
    type: "process",
    position: { x: 270, y: 130 },
    data: { label: "原材料手配", dept: "製造部", assignee: "鈴木", status: "inProgress", progress: 65, deadline: "5/12" },
  },
  {
    id: "4",
    type: "process",
    position: { x: 510, y: 60 },
    data: { label: "製造工程", dept: "製造部", assignee: "高橋", status: "inProgress", progress: 40, deadline: "5/15" },
  },
  {
    id: "5",
    type: "process",
    position: { x: 510, y: 190 },
    data: { label: "品質検査", dept: "品質管理", assignee: "伊藤", status: "waiting", progress: 0, deadline: "5/16" },
  },
  {
    id: "6",
    type: "process",
    position: { x: 750, y: 60 },
    data: { label: "出荷準備", dept: "物流部", assignee: "渡辺", status: "waiting", progress: 0, deadline: "5/17" },
  },
  {
    id: "7",
    type: "process",
    position: { x: 750, y: 190 },
    data: { label: "再検査", dept: "品質管理", assignee: "山田", status: "blocked", progress: 10, deadline: "5/14" },
  },
  {
    id: "8",
    type: "process",
    position: { x: 990, y: 60 },
    data: { label: "配送手配", dept: "物流部", assignee: "中村", status: "waiting", progress: 0, deadline: "5/18" },
  },
  {
    id: "9",
    type: "process",
    position: { x: 990, y: 190 },
    data: { label: "請求書発行", dept: "経理部", assignee: "小林", status: "waiting", progress: 0, deadline: "5/19" },
  },
  {
    id: "10",
    type: "process",
    position: { x: 1230, y: 120 },
    data: { label: "納品完了", dept: "営業部", assignee: "田中", status: "waiting", progress: 0, deadline: "5/20" },
  },
];

const edgeStyle = (color = "#94a3b8") => ({
  stroke: color,
  strokeWidth: 2,
});

const initialEdges = [
  { id: "e1-2", source: "1", target: "2", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#10b981") },
  { id: "e1-3", source: "1", target: "3", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#10b981") },
  { id: "e2-4", source: "2", target: "4", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#10b981") },
  { id: "e3-4", source: "3", target: "4", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#3b82f6") },
  { id: "e4-5", source: "4", target: "5", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#94a3b8") },
  { id: "e5-6", source: "5", target: "6", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#94a3b8") },
  { id: "e5-7", source: "5", target: "7", label: "NG", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#ef4444") },
  { id: "e7-4", source: "7", target: "4", label: "手戻り", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#ef4444"), type: "step" },
  { id: "e6-8", source: "6", target: "8", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#94a3b8") },
  { id: "e6-9", source: "6", target: "9", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#94a3b8") },
  { id: "e8-10", source: "8", target: "10", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#94a3b8") },
  { id: "e9-10", source: "9", target: "10", markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle("#94a3b8") },
];

// ===== DETAIL PANEL =====
function DetailPanel({ node, onClose, onUpdate }) {
  if (!node) return null;
  const d = node.data;
  const st = STATUS[d.status];
  const deptColor = DEPT_COLORS[d.dept] || "#64748b";

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 280,
        background: "#fff",
        borderRadius: 16,
        boxShadow: "0 16px 48px #0003",
        zIndex: 100,
        fontFamily: "'Noto Sans JP', sans-serif",
        overflow: "hidden",
        border: `2px solid ${deptColor}`,
      }}
    >
      <div style={{ background: deptColor, color: "#fff", padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.8 }}>{d.dept} / {d.assignee}</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{d.label}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#fff", fontSize: 18, cursor: "pointer" }}>×</button>
      </div>

      <div style={{ padding: 16 }}>
        {/* Status selector */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, fontWeight: 600 }}>ステータス</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(STATUS).map(([key, s]) => (
              <button
                key={key}
                onClick={() => onUpdate(node.id, { status: key, progress: key === "done" ? 100 : key === "waiting" ? 0 : d.progress })}
                style={{
                  padding: "4px 10px",
                  borderRadius: 20,
                  border: `2px solid ${d.status === key ? s.color : "#e2e8f0"}`,
                  background: d.status === key ? s.color : "#f8fafc",
                  color: d.status === key ? "#fff" : "#64748b",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Progress slider */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, fontWeight: 600 }}>
            進捗 <span style={{ color: deptColor, fontSize: 14 }}>{d.progress}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={d.progress}
            onChange={(e) => onUpdate(node.id, { progress: Number(e.target.value) })}
            style={{ width: "100%", accentColor: deptColor }}
          />
        </div>

        {/* Info */}
        <div style={{ background: "#f8fafc", borderRadius: 8, padding: 10, fontSize: 12, color: "#475569" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span>担当者</span><strong>{d.assignee}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span>部署</span><strong style={{ color: deptColor }}>{d.dept}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>期限</span><strong>{d.deadline}</strong>
          </div>
        </div>

        {/* External system link */}
        <button
          style={{
            marginTop: 12,
            width: "100%",
            padding: "8px",
            background: deptColor + "15",
            border: `1px solid ${deptColor}44`,
            borderRadius: 8,
            color: deptColor,
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          🔗 外部システムで詳細確認
        </button>
      </div>
    </div>
  );
}

// ===== STATS BAR =====
function StatsBar({ nodes }) {
  const counts = Object.keys(STATUS).reduce((a, k) => ({ ...a, [k]: 0 }), {});
  nodes.forEach((n) => { if (n.data?.status) counts[n.data.status]++; });
  const total = nodes.length;
  const avgProgress = total ? Math.round(nodes.reduce((s, n) => s + (n.data?.progress || 0), 0) / total) : 0;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#fff",
        borderRadius: 40,
        padding: "8px 20px",
        boxShadow: "0 4px 20px #0002",
        display: "flex",
        alignItems: "center",
        gap: 16,
        zIndex: 100,
        fontFamily: "'Noto Sans JP', sans-serif",
        fontSize: 12,
        border: "1px solid #e2e8f0",
      }}
    >
      {Object.entries(STATUS).map(([key, s]) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: 4, color: s.color, fontWeight: 600 }}>
          <span>{s.icon}</span>
          <span>{s.label}</span>
          <span style={{ background: s.color + "22", borderRadius: 10, padding: "1px 7px" }}>{counts[key]}</span>
        </div>
      ))}
      <div style={{ width: 1, height: 20, background: "#e2e8f0" }} />
      <div style={{ color: "#1e293b", fontWeight: 700 }}>
        全体進捗 <span style={{ color: "#3b82f6" }}>{avgProgress}%</span>
      </div>
    </div>
  );
}

// ===== HEADER =====
function Header({ lastSync }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 48,
        background: "#0f172a",
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        zIndex: 200,
        gap: 16,
        fontFamily: "'Noto Sans JP', sans-serif",
      }}
    >
      <div style={{ color: "#fff", fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>
        📊 業務フロー進捗管理
      </div>
      <div style={{ flex: 1 }} />
      {DEPARTMENTS.map((d) => (
        <div
          key={d}
          style={{
            background: DEPT_COLORS[d] + "33",
            color: DEPT_COLORS[d],
            border: `1px solid ${DEPT_COLORS[d]}66`,
            borderRadius: 20,
            padding: "2px 10px",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {d}
        </div>
      ))}
      <div style={{ color: "#64748b", fontSize: 10, marginLeft: 8 }}>
        最終同期: {lastSync}
      </div>
    </div>
  );
}

// ===== MAIN APP =====
export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selected, setSelected] = useState(null);
  const [lastSync, setLastSync] = useState("--:--:--");

  // Simulate real-time sync
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setLastSync(now.toLocaleTimeString("ja-JP"));
      // Simulate small progress update on inProgress nodes
      setNodes((nds) =>
        nds.map((n) => {
          if (n.data.status === "inProgress" && n.data.progress < 99) {
            return { ...n, data: { ...n.data, progress: Math.min(99, n.data.progress + 0.5) } };
          }
          return n;
        })
      );
    }, 3000);
    return () => clearInterval(interval);
  }, [setNodes]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle() }, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_, node) => {
    setSelected(node);
  }, []);

  const onPaneClick = useCallback(() => setSelected(null), []);

  const handleUpdate = useCallback((id, changes) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...changes } } : n))
    );
    setSelected((prev) => prev && prev.id === id ? { ...prev, data: { ...prev.data, ...changes } } : prev);
  }, [setNodes]);

  return (
    <div style={{ width: "100%", height: "100vh", background: "#f8fafc", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <Header lastSync={lastSync} />
      <div style={{ position: "absolute", top: 48, left: 0, right: 0, bottom: 0 }}>
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
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={2}
        >
          <MiniMap
            nodeColor={(n) => {
              const st = STATUS[n.data?.status];
              return st ? st.color : "#94a3b8";
            }}
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}
          />
          <Controls style={{ bottom: 60 }} />
          <Background color="#cbd5e1" gap={20} size={1} />
        </ReactFlow>

        <DetailPanel
          node={selected}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
        />

        <StatsBar nodes={nodes} />
      </div>
    </div>
  );
}
