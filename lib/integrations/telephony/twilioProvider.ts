import twilio from "twilio";
import type { VoiceId } from "@/lib/database/types";
import { getSiteUrl } from "@/lib/env";

interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

function getMasterCredentials(): TwilioCredentials | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

function getClient(creds?: TwilioCredentials | null) {
  const resolved = creds || getMasterCredentials();
  if (!resolved) return null;
  return twilio(resolved.accountSid, resolved.authToken);
}

export function isTwilioConfigured(): boolean {
  return Boolean(getMasterCredentials());
}

export async function createSubAccount(
  businessName: string
): Promise<{ success: boolean; accountSid?: string; authToken?: string; reason?: string }> {
  const masterClient = getClient();
  if (!masterClient) return { success: false, reason: "Twilio is not configured." };

  try {
    const subAccount = await masterClient.api.v2010.accounts.create({
      friendlyName: `HavnLine — ${businessName}`.slice(0, 64),
    });
    return { success: true, accountSid: subAccount.sid, authToken: subAccount.authToken };
  } catch (err) {
    console.error("Twilio sub-account creation failed:", err);
    return { success: false, reason: err instanceof Error ? err.message : "Unknown error" };
  }
}

const VOICE_MAP: Record<VoiceId, string> = {
  alex_professional: "Polly.Matthew-Neural",
  sarah_warm: "Polly.Joanna-Neural",
  james_calm: "Polly.Stephen-Neural",
  emma_friendly: "Polly.Kendra-Neural",
  custom: "Polly.Matthew-Neural",
};

export function resolveTwilioVoice(voiceId: VoiceId | null | undefined): string {
  return (voiceId && VOICE_MAP[voiceId]) || "Polly.Matthew-Neural";
}

export interface ProvisionNumberResult {
  success: boolean;
  phoneNumber?: string;
  reason?: string;
}

// The Nomorobo Spam Score Voice Add-on's catalog SID — same for every
// Twilio account, confirmed live in the Twilio Console Marketplace
// (Explore Add-ons -> Nomorobo Spam Score). Installing it costs
// $0.0035/call; the voice webhook (isCallFlaggedAsSpam in
// app/api/webhooks/twilio/voice/route.ts) already knows how to read its
// result once it's installed+enabled here, so no other code needs to
// change when a new restaurant gets this automatically.
const NOMOROBO_SPAM_SCORE_ADDON_SID = "XB06d5274893cc9af4198667d2f7d74d09";
const NOMOROBO_UNIQUE_NAME = "nomorobo_spamscore";

/**
 * Installs the Nomorobo Spam Score add-on on a restaurant's Twilio
 * sub-account and enables it on inbound voice calls, so every new
 * restaurant gets spam/scam-call detection automatically instead of
 * someone doing this by hand in the Twilio Console per restaurant (as
 * was done for the pilot restaurant). Best-effort: any failure here is
 * logged and swallowed rather than thrown, since a restaurant should
 * still get a working phone number even if this optional add-on can't
 * be installed (e.g. add-on unavailable in that Twilio region, or it's
 * already installed on this sub-account from a previous provisioning
 * attempt).
 */
async function installSpamScoreAddOn(client: ReturnType<typeof twilio>): Promise<void> {
  try {
    const existing = await client.marketplace.v1.installedAddOns.list();
    let installed = existing.find((a) => a.uniqueName === NOMOROBO_UNIQUE_NAME);

    if (!installed) {
      installed = await client.marketplace.v1.installedAddOns.create({
        availableAddOnSid: NOMOROBO_SPAM_SCORE_ADDON_SID,
        acceptTermsOfService: true,
        uniqueName: NOMOROBO_UNIQUE_NAME,
      });
    }

    const extensions = await installed.extensions().list();
    const voiceExtension = extensions.find((e) => e.productName === "Incoming Voice Call");
    if (voiceExtension && !voiceExtension.enabled) {
      await voiceExtension.update({ enabled: true });
    }
  } catch (err) {
    console.error("Nomorobo Spam Score add-on install/enable failed (non-fatal):", err);
  }
}

export async function provisionNumber(
  subAccountCreds: TwilioCredentials,
  areaCode?: string
): Promise<ProvisionNumberResult> {
  const client = getClient(subAccountCreds);
  if (!client) return { success: false, reason: "Twilio is not configured." };

  if (!process.env.NEXT_PUBLIC_SITE_URL) return { success: false, reason: "NEXT_PUBLIC_SITE_URL is not set." };
  const siteUrl = getSiteUrl();

  try {
    const available = await client.availablePhoneNumbers("US").local.list({
      areaCode: areaCode ? parseInt(areaCode, 10) : undefined,
      limit: 1,
    });

    if (available.length === 0) {
      return { success: false, reason: "No numbers available for that area code." };
    }

    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      voiceUrl: `${siteUrl}/api/webhooks/twilio/voice`,
      voiceMethod: "POST",
      statusCallback: `${siteUrl}/api/webhooks/twilio/status`,
      statusCallbackMethod: "POST",
    });

    // Best-effort — never blocks handing back the purchased number.
    await installSpamScoreAddOn(client);

    return { success: true, phoneNumber: purchased.phoneNumber };
  } catch (err) {
    console.error("Twilio number provisioning failed:", err);
    return { success: false, reason: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function sendSms(
  subAccountCreds: TwilioCredentials | null,
  to: string,
  from: string,
  body: string
): Promise<{ sent: boolean; reason?: string }> {
  const client = getClient(subAccountCreds);
  if (!client) {
    console.log(`[twilio-sms-stub] to=${to} body="${body}"`);
    return { sent: false, reason: "Twilio not configured (logged instead)." };
  }
  try {
    await client.messages.create({ to, from, body });
    return { sent: true };
  } catch (err) {
    console.error("Twilio SMS send failed:", err);
    return { sent: false, reason: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function releaseNumber(
  subAccountCreds: TwilioCredentials | null,
  phoneNumber: string
): Promise<{ success: boolean; reason?: string }> {
  const client = getClient(subAccountCreds);
  if (!client) return { success: false, reason: "Twilio is not configured." };

  try {
    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
    if (numbers.length === 0) {
      return { success: false, reason: "Number not found on this sub-account." };
    }
    await client.incomingPhoneNumbers(numbers[0].sid).remove();
    return { success: true };
  } catch (err) {
    console.error("Twilio number release failed:", err);
    return { success: false, reason: err instanceof Error ? err.message : "Unknown error" };
  }
}

export function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
  authToken?: string | null
): boolean {
  const token = authToken || process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) {
    console.error("Twilio signature validation: missing token or signature.", {
      hasToken: Boolean(token),
      hasSignature: Boolean(signature),
      url,
    });
    return false;
  }
  const valid = twilio.validateRequest(token, signature, url, params);
  if (!valid) {
    const fingerprint = token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-4)} (len ${token.length})` : "too short";
    console.error("Twilio signature validation FAILED.", {
      url,
      usedSubAccountToken: Boolean(authToken),
      signatureHeaderPresent: Boolean(signature),
      tokenFingerprint: fingerprint,
      paramKeys: Object.keys(params),
    });
  }
  return valid;
}