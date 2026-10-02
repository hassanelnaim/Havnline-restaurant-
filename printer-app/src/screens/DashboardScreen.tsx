import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet, ActivityIndicator } from "react-native";
import { fetchDashboard, DashboardDay } from "../lib/api";

interface Props {
  deviceToken: string;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * dateKey is a plain "YYYY-MM-DD" calendar date in the BUSINESS's
 * timezone, not an instant — parsed and read back using UTC getters
 * (not local ones) so the label never shifts by a day depending on
 * what timezone this tablet itself happens to be in.
 */
function formatDayLabel(dateKey: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Yesterday";
  const d = new Date(`${dateKey}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Dashboard — Phase 7 of the tablet redesign: a quick "how's today
 * going, and how does it compare" view for staff/the owner, without
 * having to pull out a laptop and open the website's End of Day
 * report. Today's card leads, same shape as every day below it so
 * there's one visual pattern to learn, not a special "today" layout.
 */
export function DashboardScreen({ deviceToken }: Props) {
  const [days, setDays] = useState<DashboardDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    const result = await fetchDashboard(deviceToken);
    if (!mountedRef.current) return;
    if (result.success) {
      setDays(result.days || []);
      setError(null);
    } else {
      setError(result.error || "Couldn't reach HavnLine.");
    }
    setRefreshing(false);
  }, [deviceToken]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.subtitle}>Today's sales and the week behind it.</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {days === null ? (
        <ActivityIndicator color="#2563EB" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={days}
          keyExtractor={(d) => d.dateKey}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#60A5FA" />}
          renderItem={({ item, index }) => <DayCard day={item} label={formatDayLabel(item.dateKey, index)} isToday={index === 0} />}
        />
      )}
    </View>
  );
}

function DayCard({ day, label, isToday }: { day: DashboardDay; label: string; isToday: boolean }) {
  return (
    <View style={[styles.card, isToday && styles.cardToday]}>
      <Text style={[styles.cardLabel, isToday && styles.cardLabelToday]}>{label}</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220", padding: 20 },
  header: { marginBottom: 16, marginTop: 8 },
  title: { fontSize: 22, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 13, color: "#B8C0D0", marginTop: 2 },
  error: { color: "#F87171", fontSize: 12.5, marginBottom: 10 },
  card: { backgroundColor: "#131C30", borderRadius: 14, borderWidth: 1, borderColor: "#25324A", padding: 16, marginBottom: 12 },
  cardToday: { borderColor: "#2563EB", backgroundColor: "#111E36" },
  cardLabel: { color: "#B8C0D0", fontSize: 13, fontWeight: "700", marginBottom: 12 },
  cardLabelToday: { color: "#60A5FA" },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  stat: { flex: 1 },
  statLabel: { color: "#8A93A6", fontSize: 11, fontWeight: "600" },
  statValue: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 3 },
  statValueEmphasis: { color: "#22C55E" },
  statValueWarn: { color: "#F87171" },
});
