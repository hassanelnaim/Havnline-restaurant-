"use client";

import * as React from "react";
import type { AiResponsibilities, Personality, VoiceId, Weekday } from "@/lib/database/types";

export interface OnboardingHoursDraft {
  weekday: Weekday;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

export interface OnboardingModifierOptionDraft {
  id: string;
  name: string;
  priceDelta: string;
}

export interface OnboardingModifierGroupDraft {
  id: string;
  name: string;
  required: boolean;
  options: OnboardingModifierOptionDraft[];
}

export interface OnboardingMenuItemDraft {
  id: string;
  name: string;
  description: string;
  price: string;
  category: string;
  modifierGroups: OnboardingModifierGroupDraft[];
}

export interface OnboardingDraft {
  businessId: string | null;
  businessName: string;
  businessType: string;
  address: string;
  phone: string;
  website: string;
  description: string;
  timezone: string;

  hours: OnboardingHoursDraft[];

  menuItems: OnboardingMenuItemDraft[];

  receptionistName: string;
  personality: Personality;
  responsibilities: AiResponsibilities;

  voiceId: VoiceId;
  customVoiceRef: string | null;
  customVoiceName: string | null;

  // Set once the owner completes the SpotOn OAuth connect flow on the
  // spoton onboarding step. Not collected as form input — it's filled
  // in by the callback route after a real connection succeeds.
  spotonConnected: boolean;
}

const WEEKDAYS: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export const DEFAULT_RESPONSIBILITIES: AiResponsibilities = {
  answer_questions: true,
  take_orders: true,
  modify_orders: true,
  collect_customer_info: true,
  escalate_to_human: true,
};

// Best-effort guess at the signer-upper's own timezone, used only to
// pre-select a sensible default in the dropdown — never trusted as the
// final value. The business owner can always change it; this just saves
// most people a click.
function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

const defaultDraft: OnboardingDraft = {
  businessId: null,
  businessName: "",
  businessType: "",
  address: "",
  phone: "",
  website: "",
  description: "",
  timezone: "America/New_York",
  hours: WEEKDAYS.map((weekday, i) => ({
    weekday,
    isOpen: i < 6,
    openTime: "09:00",
    closeTime: "17:00",
  })),
  menuItems: [],
  receptionistName: "Alex",
  personality: "professional",
  responsibilities: DEFAULT_RESPONSIBILITIES,
  voiceId: "alex_professional",
  customVoiceRef: null,
  customVoiceName: null,
  spotonConnected: false,
};

interface OnboardingContextValue {
  draft: OnboardingDraft;
  update: (patch: Partial<OnboardingDraft>) => void;
}

const OnboardingContext = React.createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = React.useState<OnboardingDraft>(defaultDraft);

  // Runs once, client-side only (so it never affects server rendering),
  // to swap the hardcoded "America/New_York" default for the actual
  // timezone the signer-upper's own browser reports — still just a
  // pre-fill, still fully editable on the business-info step.
  React.useEffect(() => {
    const detected = detectBrowserTimezone();
    setDraft((prev) => (prev.timezone === defaultDraft.timezone ? { ...prev, timezone: detected } : prev));
  }, []);

  const update = React.useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  return <OnboardingContext.Provider value={{ draft, update }}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = React.useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}
