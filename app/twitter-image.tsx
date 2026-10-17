import { ImageResponse } from "next/og";

// The picture shown when a HavnLine link is shared by text, email or social
// media. Drawn in code so it always matches the brand; no image file to keep.
export const runtime = "edge";
export const alt = "HavnLine — the AI that answers your restaurant's phone";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0B1220", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 40, fontWeight: 700 }}>H</div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: "white" }}>
            Havn<span style={{ color: "#60A5FA" }}>Line</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 700, color: "white", lineHeight: 1.05 }}>The phone rings.</div>
          <div style={{ fontSize: 76, fontWeight: 700, color: "#60A5FA", lineHeight: 1.05 }}>Nobody has to stop.</div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#B8C0D0" }}>An AI that answers your restaurant&apos;s phone, takes the order, and sends it to your kitchen.</div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {["Answers 24/7", "Off your real menu", "Straight to your kitchen"].map((t) => (
            <div key={t} style={{ display: "flex", padding: "10px 22px", borderRadius: 999, background: "rgba(37,99,235,0.25)", color: "#DCE6FF", fontSize: 24 }}>{t}</div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
