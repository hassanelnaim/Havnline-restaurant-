import type { AiResponsibilities, Personality } from "@/lib/database/types";

interface GenerateInstructionsInput {
  business: { name: string; description: string };
  receptionistName: string;
  personality: Personality;
  responsibilities: AiResponsibilities;
  menuItemCount: number;
  hours: { weekday: string; is_open: boolean; open_time: string | null; close_time: string | null }[];
}

export function generateInstructions(input: GenerateInstructionsInput): string {
  const enabledCount = Object.values(input.responsibilities).filter(Boolean).length;
  return `${input.receptionistName} is the AI phone order-taker for ${input.business.name}, configured with a ${input.personality} tone, ${enabledCount} enabled responsibilities, and ${input.menuItemCount} menu item${input.menuItemCount === 1 ? "" : "s"} on file. Full behavior is generated dynamically per call from real-time business data (menu, hours, promotions, knowledge base) — this summary is for reference only.`;
}
