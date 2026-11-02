import type { AiResponsibilities } from "@/lib/database/types";

/**
 * Every job the order-taker does. They used to be switches (in onboarding
 * and on the AI page), but each is part of taking an order: without the
 * caller's name and number there's no payment link, without hand-offs the
 * greeting's promise of a team member is broken, and with orders "off" a
 * restaurant could go online without connecting Stripe. So they're always
 * on, whatever an older row in ai_receptionists says.
 */
export const ALL_RESPONSIBILITIES: AiResponsibilities = {
  answer_questions: true,
  take_orders: true,
  modify_orders: true,
  collect_customer_info: true,
  escalate_to_human: true,
};
