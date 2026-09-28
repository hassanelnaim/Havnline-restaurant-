// Restaurant sub-types only — HavnLine is restaurant-specific, not a
// generic "AI receptionist for any business" product. Shared between
// onboarding (where it's first picked) and Settings (where it can be
// changed later) so there's one list to keep in sync, and by
// lib/ai/systemPrompt.ts, which tells the AI which of these the
// business actually is.
export const RESTAURANT_TYPES = ["Quick Service", "Fast Casual", "Casual Dining", "Fine Dining", "Cafe & Bakery", "Bar & Grill", "Food Truck", "Pizzeria", "Other"];
