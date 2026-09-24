import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata = { title: "Terms of Service — HavnLine" };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/"><Logo /></Link>
          <div className="flex items-center gap-4 text-[13px] font-medium">
            <Link href="/privacy" className="text-text-muted hover:text-text">Privacy Policy</Link>
            <Link href="/sms-terms" className="text-text-muted hover:text-text">SMS Terms</Link>
            <Link href="/" className="text-text-muted hover:text-text">Back to home</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-[30px] font-semibold text-ink">Terms of Service</h1>
        <p className="mt-2 text-[13px] text-text-muted">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="mt-4 rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-[12.5px] leading-relaxed text-brand-dark">
          This is a starting template covering what HavnLine actually does — it is not a substitute for review by
          a qualified attorney. Have a lawyer review and customize this before relying on it for a public launch.
        </div>

        <section className="mt-8 space-y-5 text-[14px] leading-relaxed text-text">
          <p>These Terms of Service ("Terms") govern your use of HavnLine (the "Service"), an AI order-taking platform that answers phone calls, answers questions, and places restaurant orders on behalf of the business that subscribes to it. By creating an account or using the Service, you agree to these Terms.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">1. Your account</h2>
          <p>You must provide accurate information when creating an account and keep your login credentials secure. You're responsible for all activity that happens under your account.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">2. Subscription &amp; billing</h2>
          <p>The Service is offered as a monthly subscription, billed through our payment processor (Stripe). New subscriptions may include a free trial period; unless you cancel before the trial ends, you will be automatically charged. Cancel anytime through Billing — no partial-period refunds.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">3. What the AI does — and its limits</h2>
          <p>Your AI order-taker acts based on the information you provide. You're responsible for keeping your menu accurate. Review calls, orders, and escalations regularly rather than treating the AI as infallible.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">4. Call recording &amp; monitoring notice</h2>
          <p>The Service records, transcribes, and stores phone conversations. <strong>You are responsible for complying with call recording and monitoring laws in your jurisdiction.</strong></p>
          <h2 className="font-display text-[18px] font-semibold text-ink">5. SMS messaging</h2>
          <p>With consent, customers who place an order receive a one-time SMS confirmation. Reply STOP to opt out, HELP for assistance.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">6. Acceptable use</h2>
          <p>No illegal use, spam, impersonation, or reverse-engineering.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">7. Third-party services</h2>
          <p>HavnLine relies on Twilio, Anthropic, ElevenLabs, SpotOn, Stripe, and Supabase.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">8. Disclaimer &amp; limitation of liability</h2>
          <p>The Service is provided "as is." Liability is limited to amounts paid in the preceding three months.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">9. Termination</h2>
          <p>Cancel anytime. We may suspend accounts that violate these Terms.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">10. Changes</h2>
          <p>We may update these Terms; continued use means acceptance.</p>
          <h2 className="font-display text-[18px] font-semibold text-ink">11. Contact us</h2>
          <p>Questions? <a href="mailto:havnlinesupport@gmail.com" className="font-medium text-brand hover:underline">havnlinesupport@gmail.com</a></p>
        </section>
      </main>
    </div>
  );
}
