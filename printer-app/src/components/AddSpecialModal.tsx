import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, Image, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { submitSpecialAddition, pollAddendumCharge } from "../lib/api";
import { ADDENDUM_POLL_INTERVAL_MS } from "../config";

interface Props {
  deviceToken: string;
  orderId: string;
  onClose: () => void;
  /** Called once the special is actually on the order — a successful comp, or a QR charge that's been paid — so the caller can refresh the order behind this modal. */
  onItemAdded: () => void;
}

type Step = "enter" | "qr" | "done";

function centsToDollarsString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Add a Special — charging or comping something that isn't on the
 * menu at all (a one-off catering tray, a split-bill adjustment,
 * "today's manager's special" nobody added as a real menu item).
 * Deliberately a separate, simpler modal from AddItemModal rather than
 * a mode bolted onto it — there's no menu to fetch, no modifiers, no
 * search/category tabs, just a name and an amount — so reusing that
 * modal's "pick" step would mean carrying all of that unused state
 * through a flow that doesn't need any of it.
 *
 * Same server endpoint and same comp/charge-via-QR mechanics as a
 * regular item addition (see POST /api/printer-app/today-orders/[id]/items
 * and its special-vs-menuItemId branch) — only how the thing being
 * added is described differs.
 */
export function AddSpecialModal({ deviceToken, orderId, onClose, onItemAdded }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("enter");

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [enterError, setEnterError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"comp" | "charge" | null>(null);

  const [qr, setQr] = useState<{ addendumId: string; qrDataUrl: string; amountCents: number } | null>(null);
  const [chargeStatus, setChargeStatus] = useState<"awaiting_payment" | "paid" | "expired" | "failed">("awaiting_payment");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function amountCentsOrNull(): number | null {
    const dollars = parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) return null;
    return Math.round(dollars * 100);
  }

  async function handleSubmit(mode: "comp" | "charge") {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setEnterError("Enter a name for this special.");
      return;
    }
    const amountCents = amountCentsOrNull();
    if (amountCents === null) {
      setEnterError("Enter an amount greater than $0.");
      return;
    }

    setSubmitting(mode);
    setEnterError(null);
    const result = await submitSpecialAddition(deviceToken, orderId, {
      special: { name: trimmedName, amountCents },
      quantity,
      notes: notes.trim() || undefined,
      mode,
    });
    setSubmitting(null);

    if (!result.success) {
      setEnterError(result.error || "Couldn't add that special.");
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
    // on a $0 amount was auto-downgraded server-side since there was
    // nothing to collect (shouldn't normally happen given the >$0
    // check above, but mirrors AddItemModal's handling either way).
    setDoneMessage(`${trimmedName} added, no charge.`);
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
        setDoneMessage(`${name.trim() || "Special"} paid and sent to the kitchen.`);
        onItemAdded();
      }
    }, ADDENDUM_POLL_INTERVAL_MS);
  }

  function retryAfterExpiry() {
    if (pollRef.current) clearInterval(pollRef.current);
    setQr(null);
    setChargeStatus("awaiting_payment");
    setEnterError(null);
    setStep("enter");
  }

  const amountCents = amountCentsOrNull();
  const estimateCents = (amountCents || 0) * quantity;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingBottom: 20 + insets.bottom }]}>
        {step === "enter" && (
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <Text style={styles.title}>Add a special</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.closeText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.subtitleLeft}>For anything not on the menu — a one-off item, a catering tray, a manager's special.</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.textInput} value={name} onChangeText={setName} placeholder="e.g. Catering tray" placeholderTextColor="#5B6472" />

            <Text style={styles.label}>Amount ($ each)</Text>
            <TextInput style={styles.textInput} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#5B6472" />

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

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput style={styles.notesInput} value={notes} onChangeText={setNotes} placeholder="e.g. for the Garcia party" placeholderTextColor="#5B6472" multiline />

            <View style={styles.estimateRow}>
              <Text style={styles.estimateLabel}>Total</Text>
              <Text style={styles.estimateValue}>${centsToDollarsString(estimateCents)}</Text>
            </View>

            {enterError && <Text style={styles.error}>{enterError}</Text>}

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.compButton} onPress={() => handleSubmit("comp")} disabled={submitting !== null}>
                {submitting === "comp" ? <ActivityIndicator color="#fff" /> : <Text style={styles.compButtonText}>Comp (free)</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.chargeButton} onPress={() => handleSubmit("charge")} disabled={submitting !== null}>
                {submitting === "charge" ? <ActivityIndicator color="#fff" /> : <Text style={styles.chargeButtonText}>Charge ${centsToDollarsString(estimateCents)}</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}

        {step === "qr" && qr && (
          <View style={styles.qrScreen}>
            <Text style={styles.title}>Scan to pay</Text>
            <Text style={styles.subtitle}>${centsToDollarsString(qr.amountCents)} for {name.trim()}</Text>
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  title: { color: "#fff", fontSize: 20, fontWeight: "700" },
  subtitle: { color: "#B8C0D0", fontSize: 14, marginTop: 4, marginBottom: 10, textAlign: "center" },
  subtitleLeft: { color: "#B8C0D0", fontSize: 13, marginBottom: 18 },
  closeText: { color: "#60A5FA", fontSize: 14, fontWeight: "600" },
  error: { color: "#F87171", fontSize: 12.5, marginTop: 10, marginBottom: 6 },
  label: { color: "#8A93A6", fontSize: 12.5, fontWeight: "600", marginTop: 14, marginBottom: 8 },
  textInput: {
    backgroundColor: "#131C30",
    borderWidth: 1,
    borderColor: "#25324A",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#fff",
  },
  quantityRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepperButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#334155", alignItems: "center", justifyContent: "center" },
  stepperButtonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  stepperValue: { color: "#fff", fontSize: 17, fontWeight: "700", minWidth: 24, textAlign: "center" },
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
