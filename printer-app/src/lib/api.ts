import { API_BASE_URL } from "../config";

// Thin client for /api/printer-app/* on the HavnLine backend. Every
// call after pairing sends the device_token as a Bearer token — this
// app never logs in as the restaurant owner, it only ever proves it's
// this one paired tablet. See lib/integrations/printer-app.ts and
// app/api/printer-app/* in the main HavnLine repo for the server side
// of every one of these.

// Every call below goes through this instead of a bare fetch+.json().
// A plain `fetch(...).then(r => r.json())` THROWS on a network drop,
// a timeout, or a non-JSON response (an HTML error page from a proxy,
// a 502) — and every caller in this app (OrdersScreen/DashboardScreen's
// polling, the print-job poller) awaits these without its own
// try/catch, so an uncaught throw here used to just vanish: the
// screen's state never updated, no error ever appeared, and a kitchen
// order that briefly failed to fetch looked exactly like one that was
// never placed. Catching it here means every call site gets back a
// real { success: false, error } it can actually show, instead of a
// silent no-op that looks identical to "nothing happened."
async function safeFetchJson<T extends { success: boolean; error?: string }>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { success: false, error: "Couldn't reach HavnLine — check this tablet's internet connection." } as T;
  }
  try {
    return await res.json();
  } catch (err) {
    return { success: false, error: `HavnLine returned an unexpected response (status ${res.status}).` } as T;
  }
}

export interface PairResult {
  success: boolean;
  deviceToken?: string;
  businessName?: string;
  error?: string;
}

export async function pairWithCode(code: string): Promise<PairResult> {
  return safeFetchJson<PairResult>(`${API_BASE_URL}/api/printer-app/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export interface SimpleResult {
  success: boolean;
  error?: string;
}

export async function reportPrinterIp(deviceToken: string, printerIp: string): Promise<SimpleResult> {
  return safeFetchJson<SimpleResult>(`${API_BASE_URL}/api/printer-app/printer-ip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ printerIp }),
  });
}

export interface PrintJob {
  id: string;
  ticket_text: string;
  created_at: string;
}

export interface PendingOrdersResult {
  success: boolean;
  jobs?: PrintJob[];
  error?: string;
}

export async function fetchPendingOrders(deviceToken: string): Promise<PendingOrdersResult> {
  return safeFetchJson<PendingOrdersResult>(`${API_BASE_URL}/api/printer-app/orders`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
}

export async function ackOrder(deviceToken: string, jobId: string, status: "printed" | "failed", error?: string): Promise<SimpleResult> {
  return safeFetchJson<SimpleResult>(`${API_BASE_URL}/api/printer-app/orders/${jobId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ status, error }),
  });
}

// -- Today's Orders (Phase 2 of the tablet redesign) ------------------------
// A read-only view of the day's real orders, separate from the print-job
// queue above (PrintJob/fetchPendingOrders/ackOrder) — this is for staff to
// look up an order or check its status, not for the automatic print flow.

export interface TodayOrderModifier {
  modifier_name: string;
  price_delta_cents: number;
}

export interface TodayOrderItem {
  id: string;
  item_name: string;
  unit_price_cents: number;
  quantity: number;
  notes: string | null;
  modifiers: TodayOrderModifier[];
}

export type OrderStatus = "confirmed" | "submitted" | "failed" | "cancelled";
export type OrderPaymentStatus = "not_required" | "awaiting_payment" | "paid" | "refunded" | "partially_refunded" | "failed";

export interface TodayOrder {
  id: string;
  status: OrderStatus;
  payment_status: OrderPaymentStatus;
  customer_name: string | null;
  phone: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_refunded_cents: number;
  special_instructions: string | null;
  submit_error: string | null;
  created_at: string;
  items: TodayOrderItem[];
}

export interface TodayOrdersResult {
  success: boolean;
  orders?: TodayOrder[];
  /** Today's totals, computed server-side from the same orders — shown as a stat row above the list. */
  summary?: DashboardDay;
  error?: string;
}

export async function fetchTodayOrders(deviceToken: string): Promise<TodayOrdersResult> {
  return safeFetchJson<TodayOrdersResult>(`${API_BASE_URL}/api/printer-app/today-orders`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
}

// -- Money actions (Phase 3 of the tablet redesign) --------------------------
// Refund/discount, PIN-gated. Two calls: verifyMoneyPin trades a
// correct 4-digit PIN for a short-lived token, then submitMoneyAction
// spends that token on one actual refund/discount. Item edits (a
// later phase) won't need any of this — only real money movement does.

export interface VerifyPinResult {
  success: boolean;
  token?: string;
  expiresAt?: number;
  error?: string;
}

export async function verifyMoneyPin(deviceToken: string, pin: string): Promise<VerifyPinResult> {
  return safeFetchJson<VerifyPinResult>(`${API_BASE_URL}/api/printer-app/verify-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ pin }),
  });
}

export type MoneyActionType = "refund" | "discount";

export interface MoneyActionResult {
  success: boolean;
  error?: string;
  refundedCents?: number;
  fullyRefunded?: boolean;
  /** The server sets this when the money-action token was missing/expired — the caller should re-prompt for the PIN rather than show this as a generic error. */
  needsPin?: boolean;
}

export async function submitMoneyAction(
  deviceToken: string,
  moneyActionToken: string,
  orderId: string,
  input: { amountCents?: number; reason: string; actionType: MoneyActionType }
): Promise<MoneyActionResult> {
  return safeFetchJson<MoneyActionResult>(`${API_BASE_URL}/api/printer-app/today-orders/${orderId}/refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deviceToken}`,
      "X-Money-Action-Token": moneyActionToken,
    },
    body: JSON.stringify(input),
  });
}

// -- Add items (Phase 4 of the tablet redesign) ------------------------------
// Adding a menu item to an already-placed order, comped (free) or
// charged via a QR code the customer scans with their own phone. No
// PIN involved — unlike refund/discount above, nothing already-
// collected is being moved: a comp never charges anyone, and a QR
// charge is new money the customer pays themselves.

export interface MenuModifier {
  id: string;
  name: string;
  price_delta_cents: number;
}

export interface MenuModifierGroup {
  id: string;
  name: string;
  is_required: boolean;
  modifiers: MenuModifier[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  // Resolved server-side from the item's category_id — null for an
  // item with no category assigned. Used purely for the Add Item
  // screen's category tabs (see AddItemModal); the dashboard's own
  // menu management page groups by category_id directly instead.
  category_name: string | null;
  modifier_groups: MenuModifierGroup[];
}

export interface MenuResult {
  success: boolean;
  menu?: MenuItem[];
  error?: string;
}

export async function fetchMenu(deviceToken: string): Promise<MenuResult> {
  return safeFetchJson<MenuResult>(`${API_BASE_URL}/api/printer-app/menu`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
}

export type AddItemMode = "comp" | "charge";

export interface AddItemInput {
  menuItemId: string;
  quantity: number;
  modifierIds: string[];
  notes?: string;
  mode: AddItemMode;
}

/** "Add a Special" — a hand-typed name + amount for something that isn't on the menu at all. */
export interface AddSpecialInput {
  special: { name: string; amountCents: number };
  quantity: number;
  notes?: string;
  mode: AddItemMode;
}

export interface AddItemResult {
  success: boolean;
  error?: string;
  /** The mode the server actually used — a "charge" request on a $0 item comes back "comp" instead, since there's nothing to collect. */
  mode?: AddItemMode;
  item?: string;
  quantity?: number;
  /** Set when mode is "charge" — id of the pending order_addendum_charges row to poll with pollAddendumCharge. */
  addendumId?: string;
  amountCents?: number;
  /** A data:image/png;base64,... URI, ready for <Image source={{ uri: qrDataUrl }} /> — generated server-side so this app never needs its own QR-rendering dependency. */
  qrDataUrl?: string;
  checkoutUrl?: string;
}

export async function submitItemAddition(deviceToken: string, orderId: string, input: AddItemInput): Promise<AddItemResult> {
  return safeFetchJson<AddItemResult>(`${API_BASE_URL}/api/printer-app/today-orders/${orderId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify(input),
  });
}

/** Same endpoint and response shape as submitItemAddition — just a special's name/amount instead of a real menuItemId. */
export async function submitSpecialAddition(deviceToken: string, orderId: string, input: AddSpecialInput): Promise<AddItemResult> {
  return safeFetchJson<AddItemResult>(`${API_BASE_URL}/api/printer-app/today-orders/${orderId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify(input),
  });
}

export type AddendumChargeStatus = "awaiting_payment" | "paid" | "expired" | "failed";

export interface AddendumChargeStatusResult {
  success: boolean;
  status?: AddendumChargeStatus;
  amountCents?: number;
  error?: string;
}

/** Polled every few seconds while the QR step is on screen — see AddItemModal. */
export async function pollAddendumCharge(deviceToken: string, orderId: string, chargeId: string): Promise<AddendumChargeStatusResult> {
  return safeFetchJson<AddendumChargeStatusResult>(`${API_BASE_URL}/api/printer-app/today-orders/${orderId}/addendum-charges/${chargeId}`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
}

// -- Dashboard (Phase 7 of the tablet redesign) ------------------------------
// Today's and yesterday's sales — the same sales math the website's
// End of Day report uses. Anything further back goes through
// fetchDaySummary (the calendar picker below) rather than this
// endpoint growing into a long scrollable history.

export interface DashboardDay {
  dateKey: string;
  orderCount: number;
  cancelledCount: number;
  grossCents: number;
  netCents: number;
  taxCents: number;
  refundedCents: number;
}

export interface DashboardResult {
  success: boolean;
  days?: DashboardDay[];
  error?: string;
}

export async function fetchDashboard(deviceToken: string): Promise<DashboardResult> {
  return safeFetchJson<DashboardResult>(`${API_BASE_URL}/api/printer-app/dashboard`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
}

export interface DaySummaryResult {
  success: boolean;
  summary?: DashboardDay;
  error?: string;
}

/** One arbitrary day's numbers — the Dashboard tab's calendar picker, fetched on demand. dateKey is "YYYY-MM-DD". */
export async function fetchDaySummary(deviceToken: string, dateKey: string): Promise<DaySummaryResult> {
  return safeFetchJson<DaySummaryResult>(`${API_BASE_URL}/api/printer-app/day-summary?date=${encodeURIComponent(dateKey)}`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
}
