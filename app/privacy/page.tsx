import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata = { title: "Privacy Policy — HavnLine" };

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
        <p className="mt-2 text-[13px] text-text-muted">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="mt-4 rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-[12.5px] leading-relaxed text-brand-dark">
          This is a starting template covering what HavnLine actually does — it is not a substitute for review by
          a qualified attorney.
        </div>

        <section className="mt-8 space-y-5 text-[14px] leading-relaxed text-text">
          <p>This Privacy Policy explains what information HavnLine collects, how it's used, and who it's shared with.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">1. Information we collect</h2>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><strong>Account information:</strong> name and email.</li>
            <li><strong>Business information:</strong> name, address, hours, menu, knowledge base.</li>
            <li><strong>Call and customer data:</strong> phone numbers, transcripts, orders.</li>
            <li><strong>Payment information:</strong> handled entirely by Stripe.</li>
          </ul>
          <h2 className="font-display text-[18px] font-semibold text-ink">2. SMS messaging &amp; consent</h2>
          <p>Customers consent verbally, over the phone, at the moment they provide their phone number to place an order. No numbers are collected any other way. Reply STOP to opt out, HELP for assistance.</p>
          <p className="rounded-lg border border-border bg-paper px-4 py-3 font-medium">
            No mobile information — including text messaging originator opt-in data and consent — will be shared
            with any third parties or affiliates for marketing or promotional purposes. This information is used
            solely to deliver the order confirmation the customer consented to and for no other purpose.
          </p>
          <h2 className="font-display text-[18px] font-semibold text-ink">3. How we use this information</h2>
          <p>To operate the Service. We do not sell your data.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">4. Who we share it with</h2>
          <p>Twilio, Anthropic, ElevenLabs, SpotOn (if connected), Stripe, and Supabase — minimum necessary data only. Mobile opt-in/consent data is never shared for marketing purposes.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">5. Data isolation between businesses</h2>
          <p>Each business's data is isolated via database-level access controls.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">6. Data retention</h2>
          <p>Retained while your account is active; deletion available on request.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">7. Your rights</h2>
          <p>Access, correct, or delete your information anytime.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">8. Children's privacy</h2>
          <p>Not directed at children under 13.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">9. Changes</h2>
          <p>We'll update the date above when this changes.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">10. Contact us</h2>
          <p><a href="mailto:havnlinesupport@gmail.com" className="font-medium text-brand hover:underline">havnlinesupport@gmail.com</a></p>
        </section>
      </main>
    </div>
  );
}
