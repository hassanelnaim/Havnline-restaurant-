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
