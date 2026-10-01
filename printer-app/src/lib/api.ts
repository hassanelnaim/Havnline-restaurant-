import { API_BASE_URL } from "../config";

// Thin client for /api/printer-app/* on the HavnLine backend. Every
// call after pairing sends the device_token as a Bearer token — this
// app never logs in as the restaurant owner, it only ever proves it's
// this one paired tablet. See lib/integrations/printer-app.ts and
// app/api/printer-app/* in the main HavnLine repo for the server side
// of every one of these.

export interface PairResult {
  success: boolean;
  deviceToken?: string;
  businessName?: string;
  error?: string;
}

export async function pairWithCode(code: string): Promise<PairResult> {
  const res = await fetch(`${API_BASE_URL}/api/printer-app/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return res.json();
}

export interface SimpleResult {
  success: boolean;
  error?: string;
}

export async function reportPrinterIp(deviceToken: string, printerIp: string): Promise<SimpleResult> {
  const res = await fetch(`${API_BASE_URL}/api/printer-app/printer-ip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ printerIp }),
  });
  return res.json();
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
  const res = await fetch(`${API_BASE_URL}/api/printer-app/orders`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  return res.json();
}

export async function ackOrder(deviceToken: string, jobId: string, status: "printed" | "failed", error?: string): Promise<SimpleResult> {
  const res = await fetch(`${API_BASE_URL}/api/printer-app/orders/${jobId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ status, error }),
  });
  return res.json();
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
  error?: string;
}

export async function fetchTodayOrders(deviceToken: string): Promise<TodayOrdersResult> {
  const res = await fetch(`${API_BASE_URL}/api/printer-app/today-orders`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  return res.json();
}
