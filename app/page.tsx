import Link from "next/link";
import {
  ArrowRight, Phone, PhoneIncoming, MessageSquareText, DoorOpen, ChefHat, UserRound,
  Mic2, ClipboardList, Check, Globe, UtensilsCrossed, Pizza, Coffee, Beef, Soup, Star, Printer, PhoneOutgoing,
  Utensils, Truck, Croissant, Sandwich, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { getApprovedReviews } from "@/lib/data/reviews";
import { MONTHLY_PRICE_DISPLAY, DEFAULT_PLATFORM_FEE_PERCENT_DISPLAY } from "@/lib/billing/constants";
import { HeroPhone } from "@/components/landing/hero-phone";
import { DemoCall } from "@/components/landing/demo-call";
import { SavingsCalculator } from "@/components/landing/savings-calculator";
import { MobileCta } from "@/components/landing/mobile-cta";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: Phone, title: "Answers every call while you're open", detail: "Picks up right away during your hours, even in the dinner rush or when three lines ring at once. No hold music, no voicemail. After closing, callers simply hear when you open next." },
  { icon: ClipboardList, title: "Takes the full order", detail: "Asks about sizes, toppings and anything to leave off, keeps track of every item, then reads the whole order back with the total before placing it." },
  { icon: Globe, title: "Learns your menu in minutes", detail: "Import it from your website, a photo, or pasted text. Prices, add-ons and day-or-time specials come along." },
  { icon: MessageSquareText, title: "Collects payment by text", detail: "With the caller's OK, it texts the total and a secure payment link. The order prints in your kitchen the moment it's paid, so there are no unpaid pickups." },
  { icon: Mic2, title: "Sounds like a real person", detail: "A natural voice you pick, short conversational replies, and never a \u201cpress 1 for…\u201d menu." },
  { icon: PhoneOutgoing, title: "Hands off when it should", detail: "Refunds, complaints or anything it isn't sure about get passed to your phone or logged for a callback. It never guesses." },
];

const DISRUPTIONS = [
  { icon: DoorOpen, who: "Your host", cost: "Leaves the door to grab the phone — the walk-in party waiting to be seated just gets ignored." },
  { icon: UserRound, who: "Your server", cost: "Steps away mid-table to take a phone order — the table in front of them notices, every time." },
  { icon: ChefHat, who: "Your cook", cost: "Comes off the line to grab a handwritten order — and the ticket already in front of them slows down." },
];

const CUISINE_TYPES = [
  { icon: Pizza, label: "Pizzerias" },
  { icon: Beef, label: "Burger Joints" },
  { icon: Soup, label: "Casual Dining" },
  { icon: Coffee, label: "Cafes" },
  { icon: Utensils, label: "Diners" },
  { icon: Truck, label: "Food Trucks" },
  { icon: Croissant, label: "Bakeries" },
  { icon: Sandwich, label: "Delis" },
];

const STEPS = [
  { label: "Tell us about your restaurant", detail: "Hours, address, and a photo or link to your menu — we build the rest." },
  { label: "Pick a voice and set the rules", detail: "Choose a personality, what it's allowed to do, and any house rules for orders." },
  { label: "Connect payments and go live", detail: "Connect Stripe so callers pay by text, then forward your line or use a new number. Phone orders start once carriers approve your texting registration, usually within a few days." },
];

const FAQS = [
  { q: "Will it sound like a robot?", a: "No — it uses natural voices that sound like a person, not an old-school phone tree, and keeps its replies short and conversational." },
  { q: "What if it gets an order wrong?", a: "It only orders off what you've actually loaded into your menu — it can't invent an item, a size, or a price. If it's ever unsure what a caller means, it asks instead of guessing." },
  { q: "Does it work with my POS?", a: "It prints phone orders straight to your kitchen printer with our tablet app — no POS integration needed, and no per-item mapping to set up first." },
  { q: "What if a customer asks for something off-menu or gets upset?", a: "It hands off to you instead of guessing. It never invents prices, items, or policies it wasn't given." },
  { q: "Do I need to be technical to set this up?", a: "No setup scripts or prompt-writing. You tell us about your restaurant and menu, pick a voice, connect payments, and forward your line. Setup takes an afternoon; phone orders turn on once the phone carriers approve your texting registration, which usually takes a few days." },
  { q: "Do I need a new phone number?", a: "No. Forward your existing restaurant line, or use a new one we provide." },
  { q: "What happens after my free trial?", a: "You're billed automatically unless you cancel first. There's no contract — cancel anytime from Billing in your dashboard." },
  { q: "Can I control what it says?", a: "Yes — personality, voice, and ordering rules are all yours to set. No prompt-writing needed." },
];

export default async function LandingPage() {
  const reviews = await getApprovedReviews();
  return (
    <div className="min-h-screen bg-paper">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-ink focus:shadow-popover">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-border/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-3">
          <a href="#how" className="hidden px-2 text-[13px] font-medium text-text-muted hover:text-ink md:inline">How it works</a>
          <a href="#pricing" className="hidden px-2 text-[13px] font-medium text-text-muted hover:text-ink md:inline">Pricing</a>
          <a href="#faq" className="hidden px-2 text-[13px] font-medium text-text-muted hover:text-ink md:inline">FAQ</a>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button variant="brand" size="sm" asChild>
            <Link href="/signup">Get started <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        </nav>
        </div>
      </header>

      <main id="main-content">
        {/* 1. Hero — the problem, the promise, a button, and the product in one picture. */}
        <section className="relative overflow-hidden bg-ink">
          <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full bg-brand/25 blur-3xl" />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-20">
            <div className="text-center lg:text-left">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11.5px] font-medium text-[#B8C0D0]">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-ring" />
                An AI that answers your restaurant&apos;s phone
              </span>
              <h1 className="mt-5 font-display text-[36px] font-semibold leading-[1.08] text-white sm:text-[52px]">
                The phone rings.<br />
                <span className="text-brand-light">Nobody has to stop.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-[#B8C0D0] lg:mx-0">
                HavnLine picks up your restaurant&apos;s calls, takes the order off your real menu, and sends it straight to your kitchen — so your host, servers and cooks never have to drop what they&apos;re doing.
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Button variant="brand" size="lg" className="w-full sm:w-auto" asChild>
                  <Link href="/signup">Start your free trial <ArrowRight className="h-4 w-4" /></Link>
                </Button>
                <a href="#how" className="inline-flex items-center gap-1.5 px-3 py-2 text-[14px] font-medium text-white/85 hover:text-white">
                  See how it works <ChevronDown className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-3 text-[12px] text-[#8A93A6]">7 days free, then {MONTHLY_PRICE_DISPLAY}/month + {DEFAULT_PLATFORM_FEE_PERCENT_DISPLAY} per paid order. Cancel anytime.</p>
            </div>
            <HeroPhone />
          </div>

          {/* Who stops for the phone today — one compact strip instead of three tall cards. */}
          <div className="relative border-t border-white/10 bg-white/[0.03]">
            <div className="mx-auto grid max-w-6xl gap-4 px-6 py-6 sm:grid-cols-3">
              {DISRUPTIONS.map((d) => (
                <div key={d.who} className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-brand-light"><d.icon className="h-4 w-4" /></span>
                  <div>
                    <div className="text-[13px] font-semibold text-white">Without HavnLine, {d.who.toLowerCase()}…</div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[#8A93A6]">{d.cost}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 2. The fix — what stays the same, what changes. */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand">The fix</p>
              <h2 className="mt-2.5 max-w-lg font-display text-[28px] font-semibold leading-[1.15] text-ink sm:text-[32px]">
                Same number. Same ringing phone. A different person answers.
              </h2>
              <p className="mt-4 max-w-md text-[14px] leading-relaxed text-text-muted">
                Keep your existing number. When it rings, HavnLine takes the call off your real menu, every time — and your team stays exactly where they&apos;re needed.
              </p>
            </div>
            <ul className="space-y-3">
              {["Your host stays at the door", "Your servers stay with their tables", "Your cooks stay on the line", "Every order lands in the kitchen, written down right"].map((item) => (
                <li key={item} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-[14px] font-medium text-ink shadow-card">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-dark"><Check className="h-4 w-4" /></span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 3. How orders are taken — the conversation and where it lands, shown together as one loop. */}
        <section id="how" className="scroll-mt-16 border-y border-border bg-card py-16">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-xl text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand">Hear it for yourself</p>
              <h2 className="mt-2.5 font-display text-[26px] font-semibold text-ink">A real call, start to finish</h2>
              <p className="mx-auto mt-2 max-w-lg text-[13px] text-text-muted">Recorded on the caller&apos;s phone, ordering off a real coney island menu. No script. Press play and follow along, then see the ticket it sends to the kitchen.</p>
            </div>

            <div className="mt-8">
              <DemoCall />
            </div>

            <ul className="mx-auto mt-8 grid max-w-2xl gap-2.5 sm:grid-cols-2">
              {["Pairs with a tablet in your kitchen in minutes", "No POS account or item mapping required", "Prints to your kitchen printer automatically", "Shows up on your Orders dashboard either way"].map((item) => (
                <li key={item} className="flex items-center gap-2 text-[13px] text-text">
                  <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 4. Who it's for — one row, not a tree. */}
        <section className="mx-auto max-w-6xl px-6 py-14 text-center">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand">Built for restaurants</p>
          <h2 className="mt-2.5 font-display text-[24px] font-semibold text-ink">If you take phone orders, this is for you.</h2>
          <div className="mt-7 flex flex-wrap justify-center gap-2.5">
            {CUISINE_TYPES.map((c) => (
              <span key={c.label} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[13.5px] font-medium text-ink shadow-sm">
                <c.icon className="h-4 w-4 text-brand" /> {c.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-4 py-2 text-[13.5px] font-medium text-brand-dark">
              <UtensilsCrossed className="h-4 w-4" /> …and any restaurant that takes calls
            </span>
          </div>
        </section>

        {/* What it actually does — supplementary capabilities not already shown above. */}
        <section className="border-y border-border bg-card py-14">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand">What it actually does</p>
              <h2 className="mt-2.5 font-display text-[26px] font-semibold leading-tight text-ink">A great order-taker — without the payroll.</h2>
            </div>
            <div className="mt-7 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="group rounded-2xl border border-border bg-paper p-5 transition-colors hover:border-brand/40 hover:bg-brand-50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <div className="mt-4 font-display text-[15px] font-semibold text-ink">{f.title}</div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{f.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. Steps — functional, no re-selling. */}
        <section className="mx-auto max-w-6xl px-6 py-14">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand">Live in three steps</p>
            <h2 className="mt-2.5 font-display text-[24px] font-semibold text-ink">Set up in an afternoon.</h2>
          </div>
          <div className="mt-7 grid gap-3.5 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.label} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-[13px] font-semibold text-white">{i + 1}</div>
                <div className="mt-3 font-display text-[14px] font-semibold text-ink">{step.label}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">{step.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* What it saves — the visitor's own numbers, nothing invented. */}
        <section className="border-t border-border bg-card py-16">
          <div className="mx-auto max-w-5xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand">Do the math</p>
              <h2 className="mt-2.5 font-display text-[26px] font-semibold text-ink">Your phone, by the numbers</h2>
              <p className="mx-auto mt-2 max-w-lg text-[13px] text-text-muted">How much time and attention the phone takes from your team. Move the sliders to match your restaurant.</p>
            </div>
            <div className="mt-8">
              <SavingsCalculator />
            </div>
          </div>
        </section>

        {/* 6. Reviews — real submissions only, checked before appearing here. Honest empty state kept live. */}
        <section className="border-y border-border bg-card py-14">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-4xl text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand">From real restaurant owners</p>
              <h2 className="mt-2.5 font-display text-[26px] font-semibold text-ink">What it's actually like to use HavnLine</h2>
            </div>

            {reviews.length === 0 ? (
              <div className="mx-auto mt-7 max-w-md rounded-2xl border border-dashed border-border bg-paper p-8 text-center">
                <p className="text-[13.5px] text-text-muted">We're still early — no reviews yet. If you're using HavnLine, we'd genuinely love to hear from you.</p>
                <Button variant="outline" size="sm" className="mt-4" asChild>
                  <Link href="/review">Leave the first review</Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {reviews.slice(0, 6).map((review) => (
                    <div key={review.id} className="rounded-2xl border border-border bg-paper p-5">
                      <div className="flex gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`h-3.5 w-3.5 ${i < review.rating ? "fill-yellow-400 text-yellow-400" : "text-border"}`} />
                        ))}
                      </div>
                      <p className="mt-3 text-[13.5px] leading-relaxed text-text">&ldquo;{review.review_text}&rdquo;</p>
                      <div className="mt-3 text-[12px] font-medium text-text-muted">{review.reviewer_name} · {review.business_name}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 text-center">
                  <Link href="/review" className="text-[12.5px] font-medium text-brand hover:underline">Using HavnLine? Leave your own review</Link>
                </div>
              </>
            )}
          </div>
        </section>

        {/* 7. Pricing — moved ahead of FAQ so the price lands before objections are addressed. */}
        <section id="pricing" className="scroll-mt-16 py-16">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand">Pricing</p>
              <h2 className="mt-2.5 font-display text-[26px] font-semibold text-ink">One plan. Everything included.</h2>
            </div>
            <div className="mx-auto mt-6 max-w-md rounded-2xl border-2 border-brand bg-card p-7 text-center shadow-card">
              <div className="flex items-baseline justify-center gap-1.5">
                <span className="font-display text-[38px] font-semibold text-ink">{MONTHLY_PRICE_DISPLAY}</span>
                <span className="text-[13px] text-text-muted">/month</span>
                <span className="ml-1 font-display text-[22px] font-semibold text-brand-dark">+ {DEFAULT_PLATFORM_FEE_PERCENT_DISPLAY}</span>
                <span className="text-[13px] text-text-muted">per paid order</span>
              </div>
              <p className="mt-1 text-[12px] text-text-muted">7 days free, then billed monthly. Cancel anytime.</p>
              <ul className="mx-auto mt-5 inline-block space-y-2 text-left">
                {["Unlimited calls answered", "Real phone order-taking off your menu", "Sends straight to your kitchen printer", "Payment links and receipts by text", "Custom AI voice & personality", "Escalation to you when it matters"].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[13px] text-text">
                    <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-5 rounded-xl bg-paper px-4 py-3 text-left text-[12.5px] text-text-muted">
                <div className="font-semibold text-ink">How the {DEFAULT_PLATFORM_FEE_PERCENT_DISPLAY} works</div>
                <div className="mt-1 flex justify-between"><span>A $25.00 phone order</span><span className="font-semibold text-ink">you pay $0.75</span></div>
                <p className="mt-1.5 text-[11.5px] text-text-faint">Only on orders customers actually pay for, only after your free trial, and taken out automatically — no separate bill. No contract: cancel anytime from Billing.</p>
              </div>
              <Button variant="brand" size="lg" className="mt-6 w-full" asChild>
                <Link href="/signup">Start your free trial <ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </section>

        {/* 8. FAQ — mops up remaining objections, now including ones raised by the harder problem-first opening. The width/padding used to sit directly on this <section>, so its bg-card band and top border only ever spanned 3xl instead of the full width every other banded section gets — moved onto a nested div, same pattern as the other border-y/bg-card sections above. */}
        <section id="faq" className="scroll-mt-16 border-t border-border bg-card py-16">
          <div className="mx-auto max-w-3xl px-6">
            <div className="text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand">Questions</p>
              <h2 className="mt-2.5 font-display text-[26px] font-semibold text-ink">Before you get started</h2>
            </div>
            <div className="mt-7 divide-y divide-border-soft">
              {FAQS.map((item) => (
                <div key={item.q} className="py-4">
                  <div className="font-display text-[14px] font-semibold text-ink">{item.q}</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 9. Closing CTA — bookends the problem section at the top. */}
        <section className="bg-ink py-14">
          <div className="mx-auto max-w-6xl px-6 text-center">
            <h2 className="font-display text-[26px] font-semibold text-white sm:text-[32px]">The phone will keep ringing. Just no one has to stop for it.</h2>
            <p className="mx-auto mt-2.5 max-w-md text-[13px] text-[#8A93A6]">Set up your AI order-taker in an afternoon. First 7 days are free.</p>
            <div className="mt-7">
              <Button variant="brand" size="lg" asChild>
                <Link href="/signup">Start your free trial <ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <MobileCta />

      <footer className="border-t border-border pb-28 pt-8 sm:pb-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-[11.5px] text-text-faint sm:flex-row">
          <span>© {new Date().getFullYear()} HavnLine</span>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-text">Terms</Link>
            <Link href="/privacy" className="hover:text-text">Privacy</Link>
            <Link href="/sms-terms" className="hover:text-text">SMS Terms</Link>
            <span>Never miss an order.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
