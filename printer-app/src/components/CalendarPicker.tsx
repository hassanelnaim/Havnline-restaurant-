import { useState } from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}
function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}

/**
 * A click-a-day month grid for the tablet's Dashboard tab — replaces
 * what used to be a long scrollable list of the last several days.
 * Self-contained, no date library: the only real math here ("which
 * weekday is day 1" and "how many days in this month") is one-liners
 * with the built-in Date object.
 */
export function CalendarPicker({
  maxDateKey,
  selectedDateKey,
  onSelect,
}: {
  maxDateKey: string;
  selectedDateKey: string | null;
  onSelect: (dateKey: string) => void;
}) {
  const max = parseDateKey(maxDateKey);
  const initial = selectedDateKey ? parseDateKey(selectedDateKey) : max;
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const atMaxMonth = viewYear === max.year && viewMonth === max.month;

  function goPrevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); } else { setViewMonth((m) => m - 1); }
  }
  function goNextMonth() {
    if (atMaxMonth) return;
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); } else { setViewMonth((m) => m + 1); }
  }

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks so every row has 7 cells.
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View style={styles.container}>
      <View style={styles.monthHeader}>
        <TouchableOpacity style={styles.navButton} onPress={goPrevMonth}>
          <Text style={styles.navButtonText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <TouchableOpacity style={[styles.navButton, atMaxMonth && styles.navButtonDisabled]} onPress={goNextMonth} disabled={atMaxMonth}>
          <Text style={[styles.navButtonText, atMaxMonth && styles.navButtonTextDisabled]}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((w, i) => (
          <Text key={i} style={styles.weekdayLabel}>{w}</Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={`blank-${i}`} style={styles.dayCell} />;
          const dateKey = toDateKey(viewYear, viewMonth, day);
          const isFuture = dateKey > maxDateKey;
          const isSelected = dateKey === selectedDateKey;
          return (
            <View key={dateKey} style={styles.dayCell}>
              <TouchableOpacity
                disabled={isFuture}
                onPress={() => onSelect(dateKey)}
                style={[styles.dayButton, isSelected && styles.dayButtonSelected]}
              >
                <Text style={[styles.dayText, isSelected && styles.dayTextSelected, isFuture && styles.dayTextDisabled]}>{day}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#131C30", borderRadius: 14, borderWidth: 1, borderColor: "#25324A", padding: 14 },
  monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthLabel: { color: "#fff", fontSize: 14, fontWeight: "700" },
  navButton: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: "#25324A", alignItems: "center", justifyContent: "center" },
  navButtonDisabled: { opacity: 0.3 },
  navButtonText: { color: "#B8C0D0", fontSize: 18, fontWeight: "700" },
  navButtonTextDisabled: { color: "#5B6472" },
  weekdayRow: { flexDirection: "row", marginTop: 12 },
  weekdayLabel: { flex: 1, textAlign: "center", color: "#5B6472", fontSize: 11, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  dayCell: { width: "14.2857%", aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  dayButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  dayButtonSelected: { backgroundColor: "#2563EB" },
  dayText: { color: "#E2E8F0", fontSize: 13, fontWeight: "600" },
  dayTextSelected: { color: "#fff" },
  dayTextDisabled: { color: "#3A4458" },
});
