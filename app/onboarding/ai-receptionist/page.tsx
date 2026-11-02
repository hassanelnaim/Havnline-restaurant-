import { redirect } from "next/navigation";

// This step (switches for what the order-taker handles) was removed: every
// job is always on (lib/ai/responsibilities.ts). Old links go to the next step.
export default function AiReceptionistStep() {
  redirect("/onboarding/voice");
}
