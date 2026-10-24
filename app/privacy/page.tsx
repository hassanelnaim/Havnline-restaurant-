import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata = { title: "Privacy Policy — HavnLine" };

// Fixed on purpose: it must say when the policy last changed.
const LAST_UPDATED = "October 24, 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/"><Logo /></Link>
          <div className="flex items-center gap-4 text-[13px] font-medium">
            <Link href="/terms" className="text-text-muted hover:text-text">Terms of Service</Link>
            <Link href="/sms-terms" className="text-text-muted hover:text-text">SMS Terms</Link>
            <Link href="/" className="text-text-muted hover:text-text">Back to home</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-[30px] font-semibold text-ink">Privacy Policy</h1>
        <p className="mt-2 text-[13px] text-text-muted">Last updated: {LAST_UPDATED}</p>

        <div className="mt-4 rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-[12.5px] leading-relaxed text-brand-dark">
          This is a working draft covering what HavnLine actually does. It is not a substitute for review by
          a qualified attorney.
        </div>

        <section className="mt-8 space-y-5 text-[14px] leading-relaxed text-text">
          <p>HavnLine runs AI order lines that answer phone calls for restaurants. This policy explains what information HavnLine collects, how it&apos;s used, who it&apos;s shared with, and how long it&apos;s kept, both for restaurants that use HavnLine and for people who call them.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">1. If you called a restaurant that uses HavnLine</h2>
          <p>When you call, you&apos;re told at the start that you&apos;re speaking with an AI order line run by HavnLine and that the call is transcribed. HavnLine answers on behalf of that restaurant. To take your order or answer your question, we process:</p>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><strong>What you say:</strong> your speech is converted to text so the AI can understand it. We do not keep audio recordings.</li>
            <li><strong>Your phone number,</strong> from caller ID, and the name you give for the order.</li>
            <li><strong>Your order</strong> and any notes, such as an allergy you mention.</li>
          </ul>
          <p>This information is used only to serve that restaurant: to take and deliver your order to its kitchen, text you the payment link you agreed to, and let the restaurant see its calls and orders. It is never shared with other restaurants. Your card details go straight to Stripe on its secure payment page; HavnLine and the restaurant never see them.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">2. Information from restaurants</h2>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><strong>Account information:</strong> name, email, and login details.</li>
            <li><strong>Business information:</strong> name, address, hours, menu, prices, and the knowledge you give the AI.</li>
            <li><strong>Billing:</strong> handled by Stripe; we store only what we need to know your subscription status.</li>
          </ul>

          <h2 className="font-display text-[18px] font-semibold text-ink">3. What we never do</h2>
          <ul className="ml-5 list-disc space-y-1.5">
            <li>We do not sell personal information or share it for advertising.</li>
            <li>We do not use call transcripts or orders to train AI models.</li>
            <li>We do not use callers&apos; phone numbers for marketing, and we don&apos;t let restaurants use HavnLine to send marketing texts.</li>
          </ul>

          <h2 className="font-display text-[18px] font-semibold text-ink">4. Text messages and consent</h2>
          <p>Callers agree during the call to receive a text with their payment link; we send it only to the number they&apos;re calling from unless they ask for a different one and it&apos;s read back to them. They also get one confirmation once it&apos;s paid. Reply STOP to opt out or HELP for help.</p>
          <p className="rounded-lg border border-border bg-paper px-4 py-3 font-medium">
            No mobile information — including text messaging originator opt-in data and consent — will be shared
            with any third parties or affiliates for marketing or promotional purposes. This information is used
            solely to deliver the messages the customer consented to and for no other purpose.
          </p>

          <h2 className="font-display text-[18px] font-semibold text-ink">5. Who we share it with</h2>
          <p>Only the service providers that run HavnLine, each receiving only what its job needs:</p>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><strong>Twilio:</strong> phone calls, speech-to-text, and text messages.</li>
            <li><strong>Anthropic:</strong> the AI that understands callers and takes orders.</li>
            <li><strong>ElevenLabs:</strong> turns the AI&apos;s replies into speech.</li>
            <li><strong>Stripe:</strong> payments and subscriptions.</li>
            <li><strong>Supabase:</strong> our database. <strong>Vercel:</strong> hosting. <strong>Resend:</strong> email.</li>
          </ul>
          <p>We may also disclose information if the law requires it, or to protect callers, restaurants, or HavnLine from fraud or harm.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">6. How long we keep it</h2>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><strong>Call transcripts:</strong> deleted automatically 90 days after the call. A record that the call happened (date, length, outcome) stays with the restaurant&apos;s history.</li>
            <li><strong>Orders:</strong> kept as the restaurant&apos;s sales records while its account is active, then deleted when the account is.</li>
            <li><strong>Restaurant accounts:</strong> kept while active; deleted on request or when the account is closed.</li>
          </ul>

          <h2 className="font-display text-[18px] font-semibold text-ink">7. Security</h2>
          <p>Each restaurant&apos;s data is kept separate by database access rules, sensitive credentials are encrypted, and access is limited to what the Service needs. No system is perfectly secure; if a breach affects your information, we&apos;ll notify you as the law requires.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">8. Your choices and rights</h2>
          <p>You can ask us what information we have about you, or ask us to correct or delete it, by emailing us. Callers can also ask the restaurant they called. Depending on where you live (for example, California), you may have additional rights, and we won&apos;t treat you differently for using them.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">9. Children</h2>
          <p>HavnLine is not directed at children under 13, and we don&apos;t knowingly collect their information.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">10. Cookies</h2>
          <p>We use a small session cookie (via Supabase) to keep you signed in — this is strictly necessary for the Service to work and isn&apos;t optional. If you accept cookies when asked, we also load Tawk.to to power live chat support, which sets its own cookies; if you decline, live chat stays off and no additional cookies are set. You can change this choice at any time by clearing your browser&apos;s site data for this domain.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">11. Changes</h2>
          <p>We&apos;ll update the date above when this policy changes, and email restaurants about material changes.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">12. Contact us</h2>
          <p><a href="mailto:havnlinesupport@gmail.com" className="font-medium text-brand hover:underline">havnlinesupport@gmail.com</a></p>
        </section>
      </main>
    </div>
  );
}
