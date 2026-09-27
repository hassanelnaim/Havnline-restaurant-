"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { generatePairingCode, unpairDevice } from "@/lib/integrations/printer-app";

export interface GeneratePairingCodeResult {
  success: boolean;
  code?: string;
  expiresAt?: string;
  error?: string;
}

export async function generatePrinterAppCodeAction(): Promise<GeneratePairingCodeResult> {
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not signed in." };

  try {
    const { code, expiresAt } = await generatePairingCode(businessId);
    return { success: true, code, expiresAt };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not generate a pairing code." };
  }
}

export async function unpairPrinterAppAction(): Promise<{ success: boolean; error?: string }> {
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not signed in." };

  await unpairDevice(businessId);
  revalidatePath("/dashboard/integrations");
  return { success: true };
}
