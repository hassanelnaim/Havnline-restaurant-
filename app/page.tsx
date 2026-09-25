import Link from "next/link";
import {
  ArrowRight, Phone, MessageSquareText, DoorOpen, ChefHat, UserRound,
  Mic2, ClipboardList, Check, Globe, UtensilsCrossed, Pizza, Coffee, Beef, Soup, Star, Printer, PhoneOutgoing,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { getApprovedReviews } from "@/lib/data/reviews";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: Phone, title: "Answers every call, day or night", detail: "Picks up 24/7 and takes real phone orders, even during your dinner rush." },
  { icon: ClipboardList, title: "Takes the full order", detail: "Walks callers through your real menu — sizes, add-ons, substitutions and all." },
  { icon: Globe, title: "Learns your menu in minutes", detail: "Paste your website or a photo of your menu — items and prices import automatically." },
  { icon: MessageSquareText, title: "Texts a confirmation automatically", detail: "Every order gets a real SMS with the total, no extra step for you." },
  { icon: Mic2, title: "Sounds like a real person", detail: "Natural voices, not a robotic phone tree." },
  { icon: PhoneOutgoing, title: "Hands off when it should", detail: "Complicated requests or upset callers get escalated to you — it never guesses." },
];

const DISRUPTIONS = [
  { icon: DoorOpen, who: "Your host", cost: "Leaves the door to grab the phone — the walk-in party waiting to be seated just gets ignored." },
  { icon: UserRound, who: "Your server", cost: "Steps away mid-table to take a phone order — the table in front of them notices, every time." },
  { icon: ChefHat, who: "Your cook", cost: "Comes off the line to grab a handwritten order — and the ticket already in front of them slows down." },
];

const CUISINES = [
  { icon: Pizza, label: "Pizzerias" },
  { icon: Beef, label: "Burger Joints" },
  { icon: Soup, label: "Casual Dining" },
  { icon: Coffee, label: "Cafes" },
  { icon: UtensilsCrossed, label: "Any Restaurant" },
];

const STEPS = [
  { label: "Tell us about your restaurant", detail: "Hours, address, and a photo or link to your menu — we build the rest." },
  { label: "Pick a voice and set the rules", detail: "Choose a personality, what it's allowed to do, and any house rules for orders." },
  { label: "Forward your line and go live", detail: "Keep your existing number or get a new one. Flip it on whenever you're ready." },
];

const FAQS = [
  { q: "Will it sound like a robot?", a: "No — natural voices, not an old-school phone tree. Most callers don't realize they're not talking to a person until you tell them." },
  { q: "Does it work with my POS?", a: "It connects directly to SpotOn today, sending phone orders straight to your kitchen printer like any other order. More POS integrations are on the way." },
  { q: "What if a customer asks for something off-menu or gets upset?", a: "It hands off to you instead of guessing. It never invents prices, items, or policies it wasn't given." },
  { q: "Do I need a new phone number?", a: "No. Forward your existing restaurant line, or use a new one we provide." },
  { q: "What happens after my free trial?", a: "You're billed automatically unless you cancel first. No surprise commitment." },
  { q: "Can I control what it says?", a: "Yes — personality, voice, and ordering rules are all yours to set. No prompt-writing needed." },
];

export default async function LandingPage() {
  const reviews = await getApprovedReviews();
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <nav className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button variant="brand" size="sm" asChild>
            <Link href="/signup">Get started <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-14 pt-8">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-ring" />
                Now taking phone orders for restaurants
              </span>
              <h1 className="mt-5 max-w-xl font-display text-[34px] font-semibold leading-[1.1] text-ink sm:text-[48px]">
                The phone rings. The whole restaurant pauses.
              </h1>
              <p className="mt-4 max-w-md text-[14px] leading-relaxed text-text-muted">
                Your host leaves the door. Your server leaves a table. Your cook leaves the line. HavnLine takes
                the call instead — off your real menu, straight to your kitchen printer — so nobody has to stop.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button variant="brand" size="lg" asChild>
                  <Link href="/signup">Start your free trial <ArrowRight className="h-4 w-4" /></Link>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link href="/login">I have an account</Link>
                </Button>
              </div>
              <p className="mt-3 text-[11.5px] text-text-faint">7 days free, then $199/month. Cancel anytime.</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                <ClipboardList className="h-3.5 w-3.5" /> Table 6 — 7:12 PM, mid-order
              </div>
              <div className="mt-3 rounded-xl border border-dashed border-border bg-paper p-4 font-mono text-[12.5px] leading-relaxed text-text">
                <div className="flex items-start gap-2 text-danger">
                  <span>✕</span>
                  <span>Phone rings. Sarah excuses herself to take the call — Table 6 waits.</span>
                </div>
                <div className="my-2.5 border-t border-dashed border-border" />
                <div className="flex items-start gap-2 text-brand-dark">
                  <span>✓</span>
                  <span>HavnLine picks up instead. Sarah stays at Table 6 the whole time.</span>
                </div>
              </div>
              <p className="mt-3 text-[11.5px] text-text-faint">Same table, same moment — the only thing that changes is who answers.</p>
            </div>
          </div>
        </section>

        <section className="bg-ink py-14">
          <div className="mx-auto max-w-5xl px-6">
            <div className="text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[#8A93A6]">It's not about missed calls</p>
              <h2 className="mx-auto mt-2.5 max-w-2xl font-display text-[28px] font-semibold leading-[1.2] text-white sm:text-[32px]">
                Your phone always gets answered. The question is who has to stop what they&apos;re doing to do it.
              </h2>
            </div>
            <div className="mt-9 grid gap-5 sm:grid-cols-3">
              {DISRUPTIONS.map((d) => (
                <div key={d.who} className="rounded-2xl border border-[#25324A] bg-[#131C30] p-5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-brand-light">
                    <d.icon className="h-4 w-4" />
                  </div>
                  <div className="mt-3 font-display text-[14px] font-semibold text-white">{d.who}</div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#B8C0D0]">{d.cost}</p>
                </div>
              ))}
            </div>
            <p className="mx-auto mt-7 max-w-md text-center text-[13px] leading-relaxed text-[#B8C0D0]">
              HavnLine takes the call instead — so the answer to &ldquo;who stops working&rdquo; is nobody.
            </p>
          </div>
        </section>

        {/* Sample call — the most concrete proof for a restaurant owner: what an actual order sounds like. */}
        <section className="mx-auto max-w-4xl px-6 py-14">
          <div className="text-center">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">Hear it for yourself</p>
            <h2 className="mt-2.5 font-display text-[26px] font-semibold text-ink">What an actual order sounds like</h2>
            <p className="mx-auto mt-2 max-w-lg text-[13px] text-text-muted">A real exchange, start to finish — off a real menu, no scripts.</p>
          </div>
          <div className="mx-auto mt-7 max-w-xl space-y-2.5 rounded-2xl border border-border bg-card p-5 shadow-card">
            {[
              { from: "caller", text: "Hey, can I get a large pepperoni pizza and an order of garlic knots?" },
              { from: "ai", text: "You got it — one large pepperoni, one garlic knots. Anything to drink, or any other sides?" },
              { from: "caller", text: "Yeah, add a 2-liter Coke." },
              { from: "ai", text: "Perfect. So that's a large pepperoni, garlic knots, and a 2-liter Coke — comes to $28.75 for pickup. Sound right?" },
              { from: "caller", text: "Yep, that's it." },
              { from: "ai", text: "Great, can I grab your name and a number for the confirmation text?" },
            ].map((line, i) => (
              <div key={i} className={`flex ${line.from === "ai" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${line.from === "ai" ? "bg-brand-soft text-brand-dark" : "bg-paper text-text"}`}>
                  {line.text}
                </div>
              </div>
            ))}
            <div className="!mt-4 flex items-center justify-center gap-1.5 border-t border-border-soft pt-4 text-[11.5px] font-medium text-brand">
              <Printer className="h-3.5 w-3.5" /> Order sent to the kitchen printer, confirmation texted to the customer
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-card py-14">
          <div className="mx-auto max-w-5xl px-6 text-center">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">Built for restaurants</p>
            <h2 className="mt-2.5 font-display text-[22px] font-semibold text-ink">If you take phone orders, this is for you.</h2>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {CUISINES.map((ind) => (
                <div key={ind.label} className="flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-paper px-4 py-6">
                  <ind.icon className="h-7 w-7 text-brand" />
                  <span className="text-[14px] font-semibold text-ink">{ind.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* POS / kitchen integration — the real differentiator over a generic phone answering service. */}
        <section className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">Straight to the kitchen</p>
              <h2 className="mt-2.5 font-display text-[26px] font-semibold leading-tight text-ink">
                Not just a call answered — an order in your kitchen.
              </h2>
              <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-text-muted">
                HavnLine connects directly to SpotOn. A phone order prints in your kitchen exactly like a
                walk-in or online order — no one at the front has to relay it by hand.
              </p>
              <ul className="mt-5 space-y-2.5">
                {["Connects to your existing SpotOn account", "Order total calculated with your real tax and pricing", "Prints to your kitchen printer automatically", "Shows up on your Orders dashboard either way"].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[13px] text-text">
                    <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                <Printer className="h-3.5 w-3.5" /> Kitchen ticket
              </div>
              <div className="mt-3 rounded-xl border border-dashed border-border bg-paper p-4 font-mono text-[12.5px] leading-relaxed text-text">
                <div className="flex justify-between text-text-faint"><span>ORDER #1042</span><span>PICKUP</span></div>
                <div className="mt-2 border-t border-border-soft pt-2">
                  1x Large Pepperoni Pizza<br />
                  1x Garlic Knots<br />
                  1x 2-Liter Coke
                </div>
                <div className="mt-2 flex justify-between border-t border-border-soft pt-2 font-semibold">
                  <span>Total</span><span>$28.75</span>
                </div>
              </div>
              <p className="mt-3 text-[11.5px] text-text-faint">Same format your kitchen already reads — nothing new for your staff to learn.</p>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-card py-14">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">What it actually does</p>
              <h2 className="mt-2.5 font-display text-[26px] font-semibold leading-tight text-ink">A great order-taker — without the payroll.</h2>
            </div>
            <div className="mt-7 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-2xl border border-border bg-paper p-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand-dark">
                    <f.icon className="h-4 w-4" />
                  </div>
                  <div className="mt-3 font-display text-[14px] font-semibold text-ink">{f.title}</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">{f.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-14">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">Live in three steps</p>
          </div>
          <div className="mt-5 grid gap-3.5 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.label} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-paper font-mono text-[11.5px] font-medium text-text-muted">{i + 1}</div>
                <div className="mt-3 font-display text-[14px] font-semibold text-ink">{step.label}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">{step.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Reviews — real submissions only, checked before appearing here. Section adapts gracefully with zero reviews yet. */}
        <section className="border-y border-border bg-card py-14">
          <div className="mx-auto max-w-4xl px-6">
            <div className="text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">From real restaurant owners</p>
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

        <section className="mx-auto max-w-3xl px-6 py-14">
          <div className="text-center">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">Questions</p>
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
        </section>

        <section className="border-t border-border bg-card py-14">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">Pricing</p>
              <h2 className="mt-2.5 font-display text-[26px] font-semibold text-ink">One plan. Everything included.</h2>
            </div>
            <div className="mx-auto mt-6 max-w-md rounded-2xl border-2 border-brand bg-paper p-7 text-center shadow-card">
              <div className="flex items-baseline justify-center gap-1.5">
                <span className="font-display text-[38px] font-semibold text-ink">$199</span>
                <span className="text-[13px] text-text-muted">/month</span>
              </div>
              <p className="mt-1 text-[12px] text-text-muted">7 days free, then billed monthly. Cancel anytime.</p>
              <ul className="mx-auto mt-5 inline-block space-y-2 text-left">
                {["Unlimited calls answered", "Real phone order-taking off your menu", "Sends straight to your kitchen printer", "Automatic SMS order confirmations", "Custom AI voice & personality", "Escalation to you when it matters"].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[13px] text-text">
                    <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button variant="brand" size="lg" className="mt-6 w-full" asChild>
                <Link href="/signup">Start your free trial <ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="bg-ink py-14">
          <div className="mx-auto max-w-6xl px-6 text-center">
            <h2 className="font-display text-[26px] font-semibold text-white sm:text-[32px]">Give your staff their floor back.</h2>
            <p className="mx-auto mt-2.5 max-w-md text-[13px] text-[#8A93A6]">Set up your AI order-taker in minutes. First 7 days are free.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 text-[11.5px] text-text-faint">
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
