import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import type { DashboardDay } from "../lib/api";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * One day's stat card — shared by the Dashboard tab (Today, Yesterday,
 * and whatever's picked from the calendar) and the Orders tab (a
 * compact header above today's order list), so both screens show the
 * exact same numbers in the exact same shape.
 */
export function DaySummaryCard({
  label,
  day,
  isToday,
  onPrint,
  printing,
}: {
  label: string;
  day: DashboardDay;
  isToday?: boolean;
  /** Omit to hide the print button entirely (the Orders tab's compact header doesn't show one). */
  onPrint?: () => void;
  printing?: boolean;
}) {
  return (
    <View style={[styles.card, isToday && styles.cardToday]}>
      <View style={styles.headerRow}>
        <Text style={[styles.cardLabel, isToday && styles.cardLabelToday]}>{label}</Text>
        {onPrint && (
          <TouchableOpacity style={styles.printButton} onPress={onPrint} disabled={printing}>
            <Text style={styles.printButtonText}>{printing ? "Printing…" : "Print"}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.statRow}>
        <Stat label="Orders" value={String(day.orderCount)} />
        <Stat label="Gross sales" value={formatCents(day.grossCents)} emphasize />
        <Stat label="Net sales" value={formatCents(day.netCents)} />
      </View>
      <View style={styles.statRow}>
        <Stat label="Sales tax" value={formatCents(day.taxCents)} />
        <Stat label="Refunded" value={formatCents(day.refundedCents)} warn={day.refundedCents > 0} />
        <Stat label="Cancelled" value={String(day.cancelledCount)} />
      </View>
    </View>
  );
}

function Stat({ label, value, emphasize, warn }: { label: string; value: string; emphasize?: boolean; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, emphasize && styles.statValueEmphasis, warn && styles.statValueWarn]}>{value}</Text>
    </View>
  );
}

/** Plain-text ESC/POS-friendly ticket for printTicket() — same data a DaySummaryCard shows, formatted for a receipt-width printer. */
export function buildDaySummaryTicket(businessName: string, label: string, day: DashboardDay): string {
  const line = (l: string, v: string) => `${l.padEnd(16, " ")}${v}`;
  return [
    businessName.toUpperCase(),
    `${label.toUpperCase()} — SALES SUMMARY`,
    "--------------------------------",
    line("Orders", String(day.orderCount)),
    line("Gross sales", formatCents(day.grossCents)),
    line("Net sales", formatCents(day.netCents)),
    line("Sales tax", formatCents(day.taxCents)),
    line("Refunded", formatCents(day.refundedCents)),
    line("Cancelled", String(day.cancelledCount)),
    "--------------------------------",
    new Date().toLocaleString(),
  ].join("\n");
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#131C30", borderRadius: 14, borderWidth: 1, borderColor: "#25324A", padding: 16, marginBottom: 12 },
  cardToday: { borderColor: "#2563EB", backgroundColor: "#111E36" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  cardLabel: { color: "#B8C0D0", fontSize: 13, fontWeight: "700" },
  cardLabelToday: { color: "#60A5FA" },
  printButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#334155" },
  printButtonText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  stat: { flex: 1 },
  statLabel: { color: "#8A93A6", fontSize: 11, fontWeight: "600" },
  statValue: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 3 },
  statValueEmphasis: { color: "#22C55E" },
  statValueWarn: { color: "#F87171" },
});
