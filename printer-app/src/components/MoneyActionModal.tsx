import { useState } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { verifyMoneyPin, submitMoneyAction, MoneyActionType, MoneyActionResult } from "../lib/api";

export interface MoneyActionToken {
  token: string;
  expiresAt: number;
}

interface Props {
  deviceToken: string;
  orderId: string;
  actionType: MoneyActionType;
  /** total_cents - amount_refunded_cents — the most this action can move. */
  maxRefundableCents: number;
  moneyActionToken: MoneyActionToken | null;
  onTokenAcquired: (token: MoneyActionToken) => void;
  onClose: () => void;
  onSuccess: (result: MoneyActionResult) => void;
}

type Step = "pin" | "amount";

function centsToDollarsString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Refund/discount, PIN-gated (Phase 3 of the tablet redesign). Always
 * mounted fresh by the caller (not toggled via a `visible` prop) so
 * its starting step is re-derived correctly every time it opens — see
 * how OrdersScreen only renders this when an action is actually
 * pending, rather than rendering it once and flipping visibility.
 *
 * Two steps: PIN entry (skipped if the tablet already has an
 * unexpired money-action token from a recent verification — the
 * 5-minute unlock window, see lib/security/moneyActionToken.ts on the
 * backend), then amount + reason. A discount always needs an amount;
 * a refund defaults to the full remaining balance but can be edited
 * down to a partial refund.
 */
export function MoneyActionModal({ deviceToken, orderId, actionType, maxRefundableCents, moneyActionToken, onTokenAcquired, onClose, onSuccess }: Props) {
  const tokenValid = !!moneyActionToken && moneyActionToken.expiresAt > Date.now();
  const [step, setStep] = useState<Step>(tokenValid ? "amount" : "pin");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [amount, setAmount] = useState(actionType === "refund" ? centsToDollarsString(maxRefundableCents) : "");
  const [reason, setReason] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleVerifyPin() {
    if (!/^\d{4}$/.test(pin)) {
      setPinError("Enter the 4-digit PIN.");
      return;
    }
    setVerifying(true);
    setPinError(null);
    const result = await verifyMoneyPin(deviceToken, pin);
    setVerifying(false);
    if (!result.success || !result.token || !result.expiresAt) {
      setPinError(result.error || "Incorrect PIN.");
      setPin("");
      return;
    }
    onTokenAcquired({ token: result.token, expiresAt: result.expiresAt });
    setPin("");
    setStep("amount");
  }

  async function handleSubmit() {
    const dollars = parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setSubmitError("Enter a valid amount.");
      return;
    }
    const amountCents = Math.round(dollars * 100);
    if (amountCents > maxRefundableCents) {
      setSubmitError(`Can't exceed $${centsToDollarsString(maxRefundableCents)} remaining on this order.`);
      return;
    }

    // The token could have expired in the time it took to type an
    // amount in — fall back to asking for the PIN again rather than
    // sending a request that's just going to be rejected.
    if (!moneyActionToken || moneyActionToken.expiresAt <= Date.now()) {
      setStep("pin");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    const isFullRefund = actionType === "refund" && amountCents >= maxRefundableCents;
    const result = await submitMoneyAction(deviceToken, moneyActionToken.token, orderId, {
      amountCents: isFullRefund ? undefined : amountCents,
      reason: reason.trim(),
      actionType,
    });
    setSubmitting(false);

    if (!result.success) {
      if (result.needsPin) {
        setStep("pin");
        return;
      }
      setSubmitError(result.error || "Something went wrong.");
      return;
    }
    onSuccess(result);
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {step === "pin" ? (
            <>
              <Text style={styles.title}>Enter PIN</Text>
              <Text style={styles.subtitle}>Required to {actionType === "refund" ? "issue a refund" : "apply a discount"}.</Text>
              <TextInput
                style={styles.pinInput}
                value={pin}
                onChangeText={(t) => setPin(t.replace(/\D/g, "").slice(0, 4))}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
                placeholder="----"
                placeholderTextColor="#5B6472"
                autoFocus
              />
              {pinError && <Text style={styles.error}>{pinError}</Text>}
              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={handleVerifyPin} disabled={verifying || pin.length !== 4}>
                  {verifying ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Continue</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>{actionType === "refund" ? "Issue refund" : "Apply discount"}</Text>
              <Text style={styles.subtitle}>Up to ${centsToDollarsString(maxRefundableCents)} remaining on this order.</Text>

              <Text style={styles.label}>Amount ($)</Text>
              <TextInput style={styles.amountInput} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#5B6472" />

              <Text style={styles.label}>Reason (optional)</Text>
              <TextInput
                style={styles.reasonInput}
                value={reason}
                onChangeText={setReason}
                placeholder={actionType === "refund" ? "e.g. Order was wrong" : "e.g. Manager comp"}
                placeholderTextColor="#5B6472"
                multiline
              />

              {submitError && <Text style={styles.error}>{submitError}</Text>}
              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={handleSubmit} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>{actionType === "refund" ? "Refund" : "Apply discount"}</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#131C30", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, borderWidth: 1, borderColor: "#25324A", borderBottomWidth: 0 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  subtitle: { color: "#B8C0D0", fontSize: 13, marginTop: 4, marginBottom: 16 },
  label: { color: "#8A93A6", fontSize: 12.5, fontWeight: "600", marginTop: 10, marginBottom: 6 },
  pinInput: {
    backgroundColor: "#0B1220",
    borderWidth: 1,
    borderColor: "#25324A",
    borderRadius: 10,
    paddingVertical: 14,
    fontSize: 26,
    letterSpacing: 10,
    textAlign: "center",
    color: "#fff",
  },
  amountInput: { backgroundColor: "#0B1220", borderWidth: 1, borderColor: "#25324A", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, color: "#fff" },
  reasonInput: {
    backgroundColor: "#0B1220",
    borderWidth: 1,
    borderColor: "#25324A",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: "#fff",
    minHeight: 60,
    textAlignVertical: "top",
  },
  error: { color: "#F87171", fontSize: 12.5, marginTop: 10 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelButton: { flex: 1, alignItems: "center", paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: "#25324A" },
  cancelText: { color: "#B8C0D0", fontWeight: "600" },
  confirmButton: { flex: 1, alignItems: "center", paddingVertical: 13, borderRadius: 10, backgroundColor: "#2563EB" },
  confirmText: { color: "#fff", fontWeight: "700" },
});
