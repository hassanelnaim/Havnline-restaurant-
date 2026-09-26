import type { VoiceId } from "@/lib/database/types";

export interface VoiceOption {
  id: VoiceId;
  name: string;
  genderPresentation: "male" | "female";
  description: string;
  tags: string[];
}

export const VOICE_CATALOG: VoiceOption[] = [
  { id: "alex_professional", name: "Alex", genderPresentation: "male", description: "Confident and polished — a strong first impression for your restaurant.", tags: ["Professional", "Confident"] },
  { id: "sarah_warm", name: "Sarah", genderPresentation: "female", description: "Friendly and warm, great for restaurants that want a personal touch.", tags: ["Friendly", "Warm"] },
  { id: "james_calm", name: "James", genderPresentation: "male", description: "Calm and even-keeled, reassuring during a busy dinner rush.", tags: ["Calm", "Professional"] },
  { id: "emma_friendly", name: "Emma", genderPresentation: "female", description: "Energetic and upbeat, a lively voice taking the order.", tags: ["Energetic", "Friendly"] },
];
