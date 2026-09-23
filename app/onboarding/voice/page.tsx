"use client";
import { useRouter } from "next/navigation";
import { useOnboarding } from "@/lib/onboarding/context";
import { StepShell } from "@/components/onboarding/step-shell";
import { ElevenLabsVoiceBrowser } from "@/components/voice/elevenlabs-voice-browser";

export default function VoiceStep() {
  const router = useRouter();
  const { draft, update } = useOnboarding();

  return (
    <StepShell title="Choose a voice" description="Browse real voices and pick how your order-taker sounds on the phone. You can change this anytime." backHref="/onboarding/ai-receptionist" onContinue={() => router.push("/onboarding/spoton")}>
      <ElevenLabsVoiceBrowser selectedVoiceRef={draft.customVoiceRef} onSelect={(id, name) => update({ customVoiceRef: id, customVoiceName: name, voiceId: "custom" })} />
    </StepShell>
  );
}
