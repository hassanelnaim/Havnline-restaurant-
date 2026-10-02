import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, FlatList, RefreshControl, StyleSheet, ActivityIndicator } from "react-native";
import { fetchTodayOrders, TodayOrder, MoneyActionType } from "../lib/api";
import { MoneyActionModal, MoneyActionToken } from "../components/MoneyActionModal";
import { AddItemModal } from "../components/AddItemModal";
import { AddSpecialModal } from "../components/AddSpecialModal";
import { ORDERS_REFRESH_INTERVAL_MS } from "../config";

interface Props {
  deviceToken: string;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** One combined read of status + payment_status + submit_error into what a kitchen tablet actually needs to show, in priority order. */
function statusLabel(order: TodayOrder): { text: string; color: string } {
  if (order.status === "cancelled") return { text: "Cancelled", color: "#9AA3B2" };
  if (order.status === "failed" || order.submit_error) return { text: "Didn't reach kitchen", color: "#F87171" };
  if (order.payment_status === "refunded") return { text: "Refunded", color: "#A78BFA" };
  if (order.payment_status === "partially_refunded") return { text: "Partially refunded", color: "#A78BFA" };
  if (order.payment_status === "awaiting_payment") return { text: "Awaiting payment", color: "#FBBF24" };
  if (order.status === "submitted") return { text: "Sent to kitchen", color: "#22C55E" };
  return { text: "Confirmed", color: "#60A5FA" };
}

/**
 * Today's Orders — Phase 2 of the tablet redesign (the list + detail
 * screens), Phase 3 (the PIN-gated Refund/Discount buttons in
 * OrderDetail below, via MoneyActionModal), and Phase 4 (the "Add
 * item" button, via AddItemModal — comped or charged via a QR code,
 * deliberately NOT PIN-gated, since nothing already-collected moves
 * either way). Polls in the background on ORDERS_REFRESH_INTERVAL_MS
 * so an order placed a minute ago shows up without staff having to
 * pull to refresh, but pull-to-refresh still works for "I need this
 * right now."
 */
export function OrdersScreen({ deviceToken }: Props) {
  const [orders, setOrders] = useState<TodayOrder[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  // Lives here, not in OrderDetail, so re-selecting a different order
  // (or going back to the list and into another order) within the
  // same 5-minute unlock window doesn't re-prompt for the PIN.
  const [moneyActionToken, setMoneyActionToken] = useState<MoneyActionToken | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setRefreshing(true);
      const result = await fetchTodayOrders(deviceToken);
      if (!mountedRef.current) return;
      if (result.success) {
        setOrders(result.orders || []);
        setError(null);
      } else {
        setError(result.error || "Couldn't reach HavnLine.");
      }
      setRefreshing(false);
    },
    [deviceToken]
  );

  useEffect(() => {
    mountedRef.current = true;
    load();
    const interval = setInterval(() => load({ silent: true }), ORDERS_REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  const selectedOrder = orders?.find((o) => o.id === selectedId) || null;
  if (selectedOrder) {
    return (
      <OrderDetail
        order={selectedOrder}
        deviceToken={deviceToken}
        moneyActionToken={moneyActionToken}
        onTokenAcquired={setMoneyActionToken}
        onOrderChanged={() => load({ silent: true })}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Today's orders</Text>
        <Text style={styles.subtitle}>{orders ? `${orders.length} order${orders.length === 1 ? "" : "s"} today` : "Loading…"}</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {orders === null ? (
        <ActivityIndicator color="#2563EB" style={{ marginTop: 40 }} />
      ) : orders.length === 0 ? (
        <Text style={styles.empty}>No orders yet today.</Text>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} tintColor="#60A5FA" />}
          renderItem={({ item }) => {
            const status = statusLabel(item);
            const itemCount = item.items.reduce((sum, i) => sum + i.quantity, 0);
            return (
              <TouchableOpacity style={styles.row} onPress={() => setSelectedId(item.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{item.customer_name || "Phone order"}</Text>
                  <Text style={styles.rowMeta}>
                    {formatTime(item.created_at)} · {itemCount} item{itemCount === 1 ? "" : "s"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.rowTotal}>{formatCents(item.total_cents)}</Text>
                  <Text style={[styles.rowStatus, { color: status.color }]}>{status.text}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

interface OrderDetailProps {
  order: TodayOrder;
  deviceToken: string;
  moneyActionToken: MoneyActionToken | null;
  onTokenAcquired: (token: MoneyActionToken) => void;
  onOrderChanged: () => void;
  onBack: () => void;
}

function OrderDetail({ order, deviceToken, moneyActionToken, onTokenAcquired, onOrderChanged, onBack }: OrderDetailProps) {
  const status = statusLabel(order);
  const [pendingAction, setPendingAction] = useState<MoneyActionType | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [addingSpecial, setAddingSpecial] = useState(false);

  const remainingCents = order.total_cents - order.amount_refunded_cents;
  const canMoveMoney = remainingCents > 0 && order.status !== "cancelled" && (order.payment_status === "paid" || order.payment_status === "partially_refunded");
  const canAddItems = order.status !== "cancelled";

  function handleActionSuccess(actionType: MoneyActionType) {
    setPendingAction(null);
    setActionMessage(actionType === "refund" ? "Refund issued." : "Discount applied.");
    onOrderChanged();
    setTimeout(() => setActionMessage(null), 3500);
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>‹ Today's orders</Text>
      </TouchableOpacity>

      <View style={styles.detailHeader}>
        <Text style={styles.title}>{order.customer_name || "Phone order"}</Text>
        <Text style={styles.subtitle}>
          {formatTime(order.created_at)}
          {order.phone ? ` · ${order.phone}` : ""}
        </Text>
        <Text style={[styles.detailStatus, { color: status.color }]}>{status.text}</Text>
      </View>

      {canMoveMoney && (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionButton} onPress={() => setPendingAction("discount")}>
            <Text style={styles.actionButtonText}>Discount</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, styles.actionButtonDanger]} onPress={() => setPendingAction("refund")}>
            <Text style={styles.actionButtonText}>Refund</Text>
          </TouchableOpacity>
        </View>
      )}
      {canAddItems && (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.addItemButton} onPress={() => setAddingItem(true)}>
            <Text style={styles.actionButtonText}>+ Add item</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addSpecialButton} onPress={() => setAddingSpecial(true)}>
            <Text style={styles.actionButtonText}>+ Add a special</Text>
          </TouchableOpacity>
        </View>
      )}
      {actionMessage && <Text style={styles.actionSuccess}>{actionMessage}</Text>}

      <FlatList
        data={order.items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>
                {item.quantity}x {item.item_name}
              </Text>
              {item.modifiers.map((m, i) => (
                <Text key={i} style={styles.itemModifier}>
                  + {m.modifier_name}
                </Text>
              ))}
              {item.notes && <Text style={styles.itemNotes}>Note: {item.notes}</Text>}
            </View>
            <Text style={styles.itemPrice}>{formatCents(item.unit_price_cents * item.quantity)}</Text>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.totals}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{formatCents(order.subtotal_cents)}</Text>
            </View>
            {order.tax_cents > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Tax</Text>
                <Text style={styles.totalsValue}>{formatCents(order.tax_cents)}</Text>
              </View>
            )}
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabelBold}>Total</Text>
              <Text style={styles.totalsValueBold}>{formatCents(order.total_cents)}</Text>
            </View>
            {order.amount_refunded_cents > 0 && (
              <View style={styles.totalsRow}>
                <Text style={[styles.totalsLabel, { color: "#A78BFA" }]}>Refunded</Text>
                <Text style={[styles.totalsValue, { color: "#A78BFA" }]}>{formatCents(order.amount_refunded_cents)}</Text>
              </View>
            )}
            {order.special_instructions && (
              <View style={styles.notesBox}>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{order.special_instructions}</Text>
              </View>
            )}
          </View>
        }
      />

      {pendingAction && (
        <MoneyActionModal
          deviceToken={deviceToken}
          orderId={order.id}
          actionType={pendingAction}
          maxRefundableCents={remainingCents}
          moneyActionToken={moneyActionToken}
          onTokenAcquired={onTokenAcquired}
          onClose={() => setPendingAction(null)}
          onSuccess={() => handleActionSuccess(pendingAction)}
        />
      )}

      {addingItem && (
        <AddItemModal
          deviceToken={deviceToken}
          orderId={order.id}
          onClose={() => setAddingItem(false)}
          onItemAdded={onOrderChanged}
        />
      )}

      {addingSpecial && (
        <AddSpecialModal
          deviceToken={deviceToken}
          orderId={order.id}
          onClose={() => setAddingSpecial(false)}
          onItemAdded={onOrderChanged}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220", padding: 20 },
  header: { marginBottom: 16, marginTop: 8 },
  title: { fontSize: 22, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 13, color: "#B8C0D0", marginTop: 2 },
  error: { color: "#F87171", fontSize: 12.5, marginBottom: 10 },
  empty: { color: "#5B6472", fontSize: 13.5, marginTop: 40, textAlign: "center" },
  row: { flexDirection: "row", backgroundColor: "#131C30", borderRadius: 12, borderWidth: 1, borderColor: "#25324A", padding: 14, marginBottom: 10, alignItems: "center" },
  rowName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  rowMeta: { color: "#8A93A6", fontSize: 12.5, marginTop: 3 },
  rowTotal: { color: "#fff", fontSize: 15, fontWeight: "700" },
  rowStatus: { fontSize: 11.5, fontWeight: "600", marginTop: 3 },
  backButton: { marginBottom: 12, marginTop: 4 },
  backText: { color: "#60A5FA", fontSize: 14, fontWeight: "600" },
  detailHeader: { marginBottom: 16 },
  detailStatus: { fontSize: 13, fontWeight: "700", marginTop: 8 },
  actionRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  actionButton: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#334155" },
  actionButtonDanger: { backgroundColor: "#3F1D1D", borderColor: "#5C2626" },
  actionButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  addItemButton: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, backgroundColor: "#14532D", borderWidth: 1, borderColor: "#22C55E" },
  addSpecialButton: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#60A5FA" },
  actionSuccess: { color: "#22C55E", fontSize: 12.5, fontWeight: "600", marginBottom: 10 },
  itemRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#131C30", paddingVertical: 12, alignItems: "flex-start" },
  itemName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  itemModifier: { color: "#B8C0D0", fontSize: 13, marginTop: 2, marginLeft: 8 },
  itemNotes: { color: "#FBBF24", fontSize: 12.5, marginTop: 3, marginLeft: 8, fontStyle: "italic" },
  itemPrice: { color: "#B8C0D0", fontSize: 14, marginLeft: 10 },
  totals: { marginTop: 14, borderTopWidth: 1, borderTopColor: "#25324A", paddingTop: 14, paddingBottom: 8 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  totalsLabel: { color: "#B8C0D0", fontSize: 13.5 },
  totalsValue: { color: "#B8C0D0", fontSize: 13.5 },
  totalsLabelBold: { color: "#fff", fontSize: 15, fontWeight: "700" },
  totalsValueBold: { color: "#fff", fontSize: 15, fontWeight: "700" },
  notesBox: { marginTop: 12, backgroundColor: "#131C30", borderRadius: 10, padding: 12 },
  notesLabel: { color: "#8A93A6", fontSize: 11.5, fontWeight: "600", marginBottom: 4 },
  notesText: { color: "#fff", fontSize: 13.5 },
});
