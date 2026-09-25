import { getAiReceptionist, getVoiceConfig } from "@/lib/data/ai-receptionist";
import { getBusinessHours } from "@/lib/data/business";
import { AiEmployeeClient } from "@/components/dashboard/ai-employee-client";

export const dynamic = "force-dynamic";

export default async function AiEmployeePage() {
  const [ai, voice, hours] = await Promise.all([getAiReceptionist(), getVoiceConfig(), getBusinessHours()]);

  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold text-ink">AI Employee</h1>
      <p className="mt-1 text-[13.5px] text-text-muted">The control center for your AI order-taker — status, voice, personality, and rules.</p>
      <div className="mt-6"><AiEmployeeClient ai={ai} voice={voice} hours={hours} /></div>
    </div>
  );
}
