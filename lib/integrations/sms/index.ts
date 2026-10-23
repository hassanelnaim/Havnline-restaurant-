import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms as twilioSendSms, isTwilioConfigured } from "@/lib/integrations/telephony/twilioProvider";

export interface SmsClientLike {
  send(businessId: string, to: string, message: string, options?: { statusCallback?: string }): Promise<{ sent: boolean; sid?: string; reason?: string }>;
}

class TwilioBackedSmsClient implements SmsClientLike {
  async send(businessId: string, to: string, message: string, options: { statusCallback?: string } = {}) {
    if (!isTwilioConfigured()) {
      console.log(`[sms-stub] business=${businessId} to=${to} message="${message}"`);
      return { sent: false, reason: "Twilio not configured." };
    }

    const admin = createAdminClient();
    const { data } = await admin
      .from("integrations")
      .select("metadata")
      .eq("business_id", businessId)
      .eq("provider", "twilio")
      .eq("status", "connected")
      .maybeSingle();

    const meta = data?.metadata as Record<string, unknown> | null;
    const fromNumber = meta?.phone_number as string | undefined;
    const subAccountSid = meta?.subaccount_sid as string | undefined;
    const subAccountAuthToken = meta?.subaccount_auth_token as string | undefined;

    if (!fromNumber) {
      return { sent: false, reason: "No HavnLine phone number provisioned for this business yet." };
    }

    const creds = subAccountSid && subAccountAuthToken ? { accountSid: subAccountSid, authToken: subAccountAuthToken } : null;
    return twilioSendSms(creds, to, fromNumber, message, options);
  }
}

export const smsClient: SmsClientLike = new TwilioBackedSmsClient();
