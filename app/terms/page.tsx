import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { TERMS_VERSION } from "@/lib/legal/versions";

export const metadata = { title: "Terms of Service — HavnLine" };

// Fixed on purpose: it must say when the terms last changed, not today's
// date. Change it in lib/legal/versions.ts whenever this page changes.
const LAST_UPDATED = TERMS_VERSION;
// Where HavnLine is organized. Confirm with your lawyer.
const GOVERNING_STATE = "Michigan";

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
        <p className="mt-2 text-[13px] text-text-muted">Last updated: {LAST_UPDATED}</p>


        <section className="mt-8 space-y-5 text-[14px] leading-relaxed text-text">
          <p>These Terms of Service (&quot;Terms&quot;) are an agreement between HavnLine (&quot;HavnLine,&quot; &quot;we,&quot; &quot;us&quot;) and the business that signs up for it (&quot;you,&quot; the &quot;Restaurant&quot;). They govern your use of HavnLine (the &quot;Service&quot;), an AI order line that answers your restaurant&apos;s phone calls, answers questions, and takes orders on your behalf. By creating an account or using the Service, you agree to these Terms. <strong>Section 13 requires disputes to be resolved by individual arbitration and waives class actions; please read it.</strong></p>

          <h2 className="font-display text-[18px] font-semibold text-ink">1. Your account</h2>
          <p>You must provide accurate information when creating an account and keep your login credentials secure. You&apos;re responsible for all activity under your account, including by anyone you give access to.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">2. Subscription &amp; billing</h2>
          <p>The Service is a monthly subscription billed through our payment processor, Stripe. New subscriptions may include a free trial; unless you cancel before it ends, you will be charged automatically. You can cancel anytime from Billing. Fees already paid are not refunded for partial periods.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">3. What the AI does, and its limits</h2>
          <p>The AI works from the menu, prices, hours, and other information you give it, and it can mishear callers or make mistakes like any phone order-taker. You&apos;re responsible for keeping that information accurate and current, and for reviewing orders, calls, and escalations. The Service is a tool to help your staff, not a guarantee that every order will be taken correctly.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">4. Orders, payments, and food: you are the seller</h2>
          <p>Every order taken through the Service is a sale between your restaurant and your customer. You are the seller and the merchant of record: customers pay you directly, through your own connected Stripe account, and HavnLine never holds their money. HavnLine is a technology provider and is not a party to any sale. Our only share is the platform fee agreed with you, which Stripe deducts from each payment.</p>
          <p>You alone are responsible for the food and everything about it: preparation, quality, safety, ingredients and allergen information, prices, taxes, fulfillment, refunds, and customer complaints. Disputes and chargebacks are between you, your customer, and Stripe; you are responsible for responding to them.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">5. Allergies and dietary needs</h2>
          <p>The AI is instructed never to tell a caller that an item is safe for an allergy or free of any ingredient. When a caller mentions an allergy, it notes it on the order and the kitchen ticket and tells the caller to confirm with your staff. Only your staff can know what is in your food and how it is prepared; you are responsible for any allergen information you give the AI and for handling allergy requests safely.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">6. Calls, transcripts, and caller privacy</h2>
          <p>Every call answered by the Service begins with an announcement that the caller has reached an automated (AI) ordering assistant provided by HavnLine and that calls are transcribed. You agree not to remove, shorten, or obscure that announcement. The Service converts calls to text to understand callers; it does not keep audio recordings. Transcripts are deleted automatically 90 days after the call.</p>
          <p>HavnLine processes call and customer data only as your service provider, to run the Service for you. We do not sell it, use it for advertising, or use it to train AI models. You are responsible for any additional notices or consents that laws where you operate may require, and for telling us if you need them.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">7. Text messages</h2>
          <p>The Service sends texts only to a caller who agreed during the call: the payment link for their order, a confirmation once it&apos;s paid, and a notice if it&apos;s refunded. Every text says how to opt out (reply STOP) and get help (reply HELP). You may not use the Service to send marketing texts. See our <Link href="/sms-terms" className="font-medium text-brand hover:underline">SMS Terms</Link>.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">8. Acceptable use</h2>
          <p>You may not use the Service for anything illegal, to send spam, to impersonate anyone, to collect callers&apos; information for purposes unrelated to their orders, or to reverse-engineer or overload the Service.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">9. Third-party services</h2>
          <p>The Service relies on outside providers, including Twilio (phone calls and texts), Anthropic (the AI), ElevenLabs (the voice), Stripe (payments), Supabase (the database), Vercel (hosting), and Resend (email). We are not responsible for their outages or errors, though we work to keep the Service running when one has a problem.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">10. Indemnification</h2>
          <p>You will defend, indemnify, and hold harmless HavnLine and its owners and contractors from claims, losses, and costs (including reasonable attorneys&apos; fees) arising from your food, menu, prices, or allergen information; your sales, refunds, and customer service; your violation of these Terms; or your violation of any law or anyone&apos;s rights.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">11. Disclaimer</h2>
          <p>The Service is provided &quot;as is&quot; and &quot;as available,&quot; without warranties of any kind, express or implied, including fitness for a particular purpose and non-infringement. We don&apos;t promise the Service will be uninterrupted or error-free, or that the AI will understand every caller correctly.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">12. Limitation of liability</h2>
          <p>To the fullest extent the law allows, HavnLine is not liable for lost profits, lost sales, lost data, or any indirect, incidental, special, consequential, or punitive damages. HavnLine&apos;s total liability for any claim relating to the Service is limited to the subscription fees you paid in the three months before the event that gave rise to the claim.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">13. Dispute resolution, arbitration, and class action waiver</h2>
          <p><strong>Talk to us first.</strong> Before filing any claim, you agree to email us a description of the dispute and give us 30 days to try to resolve it informally.</p>
          <p><strong>Binding individual arbitration.</strong> Any dispute that isn&apos;t resolved informally will be decided by binding arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules, by a single arbitrator, instead of in court. Either party may instead bring an individual claim in small claims court if it qualifies. Either party may ask a court to stop misuse of its intellectual property or confidential information.</p>
          <p><strong>No class actions.</strong> Claims may be brought only individually, not as a plaintiff or class member in any class, collective, or representative proceeding, and the arbitrator may not combine claims of more than one party. <strong>You and HavnLine each give up the right to a jury trial.</strong></p>
          <p><strong>Opting out.</strong> You may opt out of this section within 30 days of first accepting these Terms by emailing us from your account&apos;s email address with the subject &quot;Arbitration opt-out.&quot;</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">14. Governing law</h2>
          <p>These Terms are governed by the laws of the State of {GOVERNING_STATE}, without regard to its conflict-of-law rules, and by the Federal Arbitration Act for Section 13. Any court proceeding allowed under these Terms will be brought in the state or federal courts located in {GOVERNING_STATE}.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">15. Termination</h2>
          <p>You can cancel anytime. We may suspend or end your access if you violate these Terms or if your use puts callers, the Service, or other customers at risk. Sections 4, 5, 10, 11, 12, 13, and 14 continue to apply after your account ends.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">16. Changes</h2>
          <p>We may update these Terms. For material changes we&apos;ll email you before they take effect; continuing to use the Service after that means you accept them.</p>

          <h2 className="font-display text-[18px] font-semibold text-ink">17. Contact us</h2>
          <p>Questions? <a href="mailto:havnlinesupport@gmail.com" className="font-medium text-brand hover:underline">havnlinesupport@gmail.com</a></p>
        </section>
      </main>
    </div>
  );
}
