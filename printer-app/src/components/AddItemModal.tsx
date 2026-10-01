import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, FlatList, Image, StyleSheet, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchMenu, submitItemAddition, pollAddendumCharge, MenuItem, MenuModifier } from "../lib/api";
import { ADDENDUM_POLL_INTERVAL_MS } from "../config";

interface Props {
  deviceToken: string;
  orderId: string;
  onClose: () => void;
  /** Called once an item is actually on the order — a successful comp, or a QR charge that's been paid — so the caller can refresh the order behind this modal. */
  onItemAdded: () => void;
}

type Step = "pick" | "configure" | "qr" | "done";

function centsToDollarsString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Add Item — Phase 4 of the tablet redesign. Four steps: pick a menu
 * item, configure quantity/modifiers/notes, then either comp it
 * (inserted immediately) or charge it (a QR the customer scans with
 * their own phone, polled here until paid). Always mounted fresh by
 * the caller, same as MoneyActionModal, so its state never carries
 * over from a previous item.
 */
export function AddItemModal({ deviceToken, orderId, onClose, onItemAdded }: Props) {
  // Full-screen Modal, so its own Comp/Charge buttons and the Cancel
  // links can land right at the device's bottom edge — same reasoning
  // as MoneyActionModal.
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("pick");

  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);

  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [configureError, setConfigureError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"comp" | "charge" | null>(null);

  const [qr, setQr] = useState<{ addendumId: string; qrDataUrl: string; amountCents: number } | null>(null);
  const [chargeStatus, setChargeStatus] = useState<"awaiting_payment" | "paid" | "expired" | "failed">("awaiting_payment");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchMenu(deviceToken).then((result) => {
      if (result.success) setMenu(result.menu || []);
      else setMenuError(result.error || "Couldn't load the menu.");
    });
  }, [deviceToken]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function pickItem(item: MenuItem) {
    setSelectedItem(item);
    setQuantity(1);
    setSelectedModifierIds([]);
    setNotes("");
    setConfigureError(null);
    setStep("configure");
  }

  function toggleModifier(modifierId: string) {
    setSelectedModifierIds((prev) => (prev.includes(modifierId) ? prev.filter((id) => id !== modifierId) : [...prev, modifierId]));
  }

  function missingRequiredGroups(): string[] {
    if (!selectedItem) return [];
    return selectedItem.modifier_groups
      .filter((g) => g.is_required && !g.modifiers.some((m) => selectedModifierIds.includes(m.id)))
      .map((g) => g.name);
  }

  function estimatedUnitCents(): number {
    if (!selectedItem) return 0;
    const modifierTotal = selectedItem.modifier_groups
      .flatMap((g) => g.modifiers)
      .filter((m) => selectedModifierIds.includes(m.id))
      .reduce((sum, m) => sum + m.price_delta_cents, 0);
    return selectedItem.price_cents + modifierTotal;
  }

  async function handleSubmit(mode: "comp" | "charge") {
    if (!selectedItem) return;
    const missing = missingRequiredGroups();
    if (missing.length > 0) {
      setConfigureError(`Choose an option for: ${missing.join(", ")}.`);
      return;
    }

    setSubmitting(mode);
    setConfigureError(null);
    const result = await submitItemAddition(deviceToken, orderId, {
      menuItemId: selectedItem.id,
      quantity,
      modifierIds: selectedModifierIds,
      notes: notes.trim() || undefined,
      mode,
    });
    setSubmitting(null);

    if (!result.success) {
      setConfigureError(result.error || "Couldn't add that item.");
      return;
    }

    if (result.mode === "charge" && result.addendumId && result.qrDataUrl) {
      setQr({ addendumId: result.addendumId, qrDataUrl: result.qrDataUrl, amountCents: result.amountCents || 0 });
      setChargeStatus("awaiting_payment");
      setStep("qr");
      startPolling(result.addendumId);
      return;
    }

    // mode came back "comp" — either staff chose Comp, or a "charge"
    // on a $0 item was auto-downgraded server-side (see the items
    // route) since there was nothing to collect.
    setDoneMessage(`${selectedItem.name} added, no charge.`);
    setStep("done");
    onItemAdded();
  }

  function startPolling(addendumId: string) {
    pollRef.current = setInterval(async () => {
      const result = await pollAddendumCharge(deviceToken, orderId, addendumId);
      if (!result.success || !result.status) return;
      if (result.status === "awaiting_payment") return;

      if (pollRef.current) clearInterval(pollRef.current);
      setChargeStatus(result.status);
      if (result.status === "paid") {
        setDoneMessage(`${selectedItem?.name || "Item"} paid and sent to the kitchen.`);
        onItemAdded();
      }
    }, ADDENDUM_POLL_INTERVAL_MS);
  }

  function retryAfterExpiry() {
    if (pollRef.current) clearInterval(pollRef.current);
    setQr(null);
    setChargeStatus("awaiting_payment");
    setConfigureError(null);
    setStep("configure");
  }

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingBottom: 20 + insets.bottom }]}>
        {step === "pick" && (
          <>
            <View style={styles.header}>
              <Text style={styles.title}>Add item</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.closeText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            {menuError && <Text style={styles.error}>{menuError}</Text>}
            {menu === null ? (
              <ActivityIndicator color="#2563EB" style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={menu}
                keyExtractor={(m) => m.id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.menuRow} onPress={() => pickItem(item)}>
                    <Text style={styles.menuItemName}>{item.name}</Text>
                    <Text style={styles.menuItemPrice}>${centsToDollarsString(item.price_cents)}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </>
        )}

        {step === "configure" && selectedItem && (
          <>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => setStep("pick")}>
                <Text style={styles.closeText}>‹ Back</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.closeText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={selectedItem.modifier_groups}
              keyExtractor={(g) => g.id}
              ListHeaderComponent={
                <>
                  <Text style={styles.title}>{selectedItem.name}</Text>
                  <View style={styles.quantityRow}>
                    <Text style={styles.label}>Quantity</Text>
                    <View style={styles.stepper}>
                      <TouchableOpacity style={styles.stepperButton} onPress={() => setQuantity((q) => Math.max(1, q - 1))}>
                        <Text style={styles.stepperButtonText}>–</Text>
                      </TouchableOpacity>
                      <Text style={styles.stepperValue}>{quantity}</Text>
                      <TouchableOpacity style={styles.stepperButton} onPress={() => setQuantity((q) => Math.min(20, q + 1))}>
                        <Text style={styles.stepperButtonText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              }
              renderItem={({ item: group }) => (
                <View style={styles.modifierGroup}>
                  <Text style={styles.label}>
                    {group.name}
                    {group.is_required ? " (required)" : ""}
                  </Text>
                  <View style={styles.chipRow}>
                    {group.modifiers.map((m: MenuModifier) => {
                      const selected = selectedModifierIds.includes(m.id);
                      return (
                        <TouchableOpacity key={m.id} style={[styles.chip, selected && styles.chipSelected]} onPress={() => toggleModifier(m.id)}>
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                            {m.name}
                            {m.price_delta_cents !== 0 ? ` (+$${centsToDollarsString(m.price_delta_cents)})` : ""}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
              ListFooterComponent={
                <>
                  <Text style={styles.label}>Notes (optional)</Text>
                  <TextInput style={styles.notesInput} value={notes} onChangeText={setNotes} placeholder="e.g. no onions" placeholderTextColor="#5B6472" multiline />

                  <View style={styles.estimateRow}>
                    <Text style={styles.estimateLabel}>Estimated total</Text>
                    <Text style={styles.estimateValue}>${centsToDollarsString(estimatedUnitCents() * quantity)}</Text>
                  </View>

                  {configureError && <Text style={styles.error}>{configureError}</Text>}

                  <View style={styles.buttonRow}>
                    <TouchableOpacity style={styles.compButton} onPress={() => handleSubmit("comp")} disabled={submitting !== null}>
                      {submitting === "comp" ? <ActivityIndicator color="#fff" /> : <Text style={styles.compButtonText}>Comp (free)</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.chargeButton} onPress={() => handleSubmit("charge")} disabled={submitting !== null}>
                      {submitting === "charge" ? <ActivityIndicator color="#fff" /> : <Text style={styles.chargeButtonText}>Charge ${centsToDollarsString(estimatedUnitCents() * quantity)}</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              }
            />
          </>
        )}

        {step === "qr" && qr && (
          <View style={styles.qrScreen}>
            <Text style={styles.title}>Scan to pay</Text>
            <Text style={styles.subtitle}>${centsToDollarsString(qr.amountCents)} for {selectedItem?.name}</Text>
            <Image source={{ uri: qr.qrDataUrl }} style={styles.qrImage} resizeMode="contain" />
            {chargeStatus === "awaiting_payment" && (
              <>
                <ActivityIndicator color="#60A5FA" style={{ marginTop: 16 }} />
                <Text style={styles.waitingText}>Waiting for the customer to pay…</Text>
              </>
            )}
            {chargeStatus === "paid" && <Text style={styles.paidText}>Paid — sending to the kitchen.</Text>}
            {(chargeStatus === "expired" || chargeStatus === "failed") && (
              <>
                <Text style={styles.error}>This QR code expired before it was paid.</Text>
                <TouchableOpacity style={styles.retryButton} onPress={retryAfterExpiry}>
                  <Text style={styles.retryButtonText}>Try again</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity onPress={onClose} style={{ marginTop: 20 }}>
              <Text style={styles.closeText}>{chargeStatus === "paid" ? "Done" : "Close"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "done" && (
          <View style={styles.qrScreen}>
            <Text style={styles.paidText}>{doneMessage}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={onClose}>
              <Text style={styles.retryButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B1220", padding: 20, paddingTop: 50 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  title: { color: "#fff", fontSize: 20, fontWeight: "700" },
  subtitle: { color: "#B8C0D0", fontSize: 14, marginTop: 4, marginBottom: 10, textAlign: "center" },
  closeText: { color: "#60A5FA", fontSize: 14, fontWeight: "600" },
  error: { color: "#F87171", fontSize: 12.5, marginTop: 10, marginBottom: 6 },
  menuRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#131C30",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#25324A",
    padding: 14,
    marginBottom: 10,
  },
  menuItemName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  menuItemPrice: { color: "#B8C0D0", fontSize: 14 },
  label: { color: "#8A93A6", fontSize: 12.5, fontWeight: "600", marginTop: 14, marginBottom: 8 },
  quantityRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepperButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#334155", alignItems: "center", justifyContent: "center" },
  stepperButtonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  stepperValue: { color: "#fff", fontSize: 17, fontWeight: "700", minWidth: 24, textAlign: "center" },
  modifierGroup: { marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: "#25324A", backgroundColor: "#131C30" },
  chipSelected: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  chipText: { color: "#B8C0D0", fontSize: 13 },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  notesInput: {
    backgroundColor: "#131C30",
    borderWidth: 1,
    borderColor: "#25324A",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: "#fff",
    minHeight: 50,
    textAlignVertical: "top",
  },
  estimateRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: "#25324A" },
  estimateLabel: { color: "#B8C0D0", fontSize: 14 },
  estimateValue: { color: "#fff", fontSize: 16, fontWeight: "700" },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 30 },
  compButton: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 10, backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#334155" },
  compButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  chargeButton: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 10, backgroundColor: "#2563EB" },
  chargeButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  qrScreen: { flex: 1, alignItems: "center", justifyContent: "center" },
  qrImage: { width: 260, height: 260, backgroundColor: "#fff", borderRadius: 12, marginTop: 10 },
  waitingText: { color: "#B8C0D0", fontSize: 13.5, marginTop: 10 },
  paidText: { color: "#22C55E", fontSize: 16, fontWeight: "700", marginTop: 10, textAlign: "center" },
  retryButton: { marginTop: 18, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, backgroundColor: "#2563EB" },
  retryButtonText: { color: "#fff", fontWeight: "700" },
});
