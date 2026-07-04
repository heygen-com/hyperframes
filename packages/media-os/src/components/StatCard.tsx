import { cardStyle } from "./styles";

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={cardStyle}>
      <div style={{ color: "#64748b", fontSize: "14px" }}>{label}</div>
      <div style={{ fontSize: "28px", fontWeight: 700 }}>{value}</div>
    </div>
  );
}
