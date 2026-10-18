"use client";
import { useMemo, useState, useTransition } from "react";
import { Store, UserRound, Clock, CalendarX2, Receipt, Bell, KeyRound, Check, Loader2, AlertCircle, CheckCircle2, ChevronDown, Copy, X, Plus, LogOut } from "lucide-react";
import type { DbBusiness, DbBusinessClosure, DbBusinessHours } from "@/lib/database/types";
import type { UserProfile } from "@/lib/data/profile";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/app/actions/auth";
import {
  updateBusinessProfileAction,
  updateBusinessHoursAction,
  updateNotificationPreferencesAction,
  setMoneyPinAction,
  addClosureAction,
  removeClosureAction,
} from "@/app/actions/business";
import { updateProfileNameAction, updateEmailAction, updatePasswordAction } from "@/app/actions/profile";
import { RESTAURANT_TYPES } from "@/lib/restaurant-types";
import { upcomingHolidays } from "@/lib/business/holidays";

const WEEKDAY_LABELS: Record<string, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
const WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "3132434921" -> "(313) 243-4921" as it's typed; anything that isn't a US number is left alone. */
function formatUsPhone(raw: string): string {
  if (/[a-z]/i.test(raw) || raw.trim().startsWith("+") && !raw.trim().startsWith("+1")) return raw;
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length > 10) return raw;
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** "2026-11-26" -> "Thu, Nov 26" */
function shortDate(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function nextDay(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Closure = Pick<DbBusinessClosure, "id" | "closed_on" | "note">;

/** Consecutive days with the same note shown as one entry ("Dec 24 – Dec 26"). */
function groupClosures(closures: Closure[]): { ids: string[]; start: string; end: string; note: string | null }[] {
  const sorted = [...closures].sort((a, b) => a.closed_on.localeCompare(b.closed_on));
  const groups: { ids: string[]; start: string; end: string; note: string | null }[] = [];
  for (const c of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.note === c.note && nextDay(last.end) === c.closed_on) {
      last.ids.push(c.id);
      last.end = c.closed_on;
    } else {
      groups.push({ ids: [c.id], start: c.closed_on, end: c.closed_on, note: c.note });
    }
  }
  return groups;
}

function Section({ icon: Icon, title, description, children, aside }: { icon: typeof Store; title: string; description?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-dark"><Icon className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-text-muted">{description}</p>}
        </div>
        {aside && <div className="basis-full pl-12 sm:basis-auto sm:pl-0">{aside}</div>}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Saved({ show, text = "Saved" }: { show: boolean; text?: string }) {
  if (!show) return null;
  return <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success"><Check className="h-3.5 w-3.5" /> {text}</span>;
}

export function SettingsClient({
  business,
  profile,
  hours,
  moneyPinSet,
  closures: initialClosures,
  today,
  initialTab,
}: {
  business: DbBusiness;
  profile: UserProfile;
  hours: DbBusinessHours[];
  moneyPinSet: boolean;
  closures: DbBusinessClosure[];
  today: string;
  initialTab: "restaurant" | "account";
}) {
  const [isPending, startTransition] = useTransition();

  // ── Restaurant: profile + hours share one save bar ──
  const initialProfile = {
    name: business.name,
    businessType: business.business_type || "",
    description: business.description || "",
    address: business.address || "",
    addressCity: business.address_city || "",
    addressState: business.address_state || "",
    addressZip: business.address_zip || "",
    phone: formatUsPhone(business.phone || ""),
    escalationPhone: formatUsPhone(business.escalation_phone || ""),
  };
  const initialHours = WEEKDAY_ORDER.map((weekday) => {
    const h = hours.find((x) => x.weekday === weekday);
    return { weekday, isOpen: h?.is_open ?? false, openTime: h?.open_time?.slice(0, 5) || "11:00", closeTime: h?.close_time?.slice(0, 5) || "21:00" };
  });
  const [baseline, setBaseline] = useState({ profile: initialProfile, hours: initialHours });
  const [profileDraft, setProfileDraft] = useState(initialProfile);
  const [hoursDraft, setHoursDraft] = useState(initialHours);
  const [restaurantSaved, setRestaurantSaved] = useState(false);
  const [restaurantError, setRestaurantError] = useState<string | null>(null);

  const profileDirty = JSON.stringify(profileDraft) !== JSON.stringify(baseline.profile);
  const hoursDirty = JSON.stringify(hoursDraft) !== JSON.stringify(baseline.hours);
  const dirty = profileDirty || hoursDirty;

  const setField = (patch: Partial<typeof profileDraft>) => { setProfileDraft((p) => ({ ...p, ...patch })); setRestaurantSaved(false); };
  const setDay = (i: number, patch: Partial<(typeof hoursDraft)[number]>) => { setHoursDraft((h) => h.map((d, j) => (j === i ? { ...d, ...patch } : d))); setRestaurantSaved(false); };
  function copyMondayToAll() {
    const mon = hoursDraft[0];
    setHoursDraft((h) => h.map((d) => ({ ...d, isOpen: mon.isOpen, openTime: mon.openTime, closeTime: mon.closeTime })));
    setRestaurantSaved(false);
  }

  // Sales tax is looked up from the full address, so all four parts matter.
  const missingAddress = [
    !profileDraft.address.trim() && "street address",
    !profileDraft.addressCity.trim() && "city",
    !/^[A-Za-z]{2}$/.test(profileDraft.addressState.trim()) && "state",
    !/^\d{5}(-\d{4})?$/.test(profileDraft.addressZip.trim()) && "ZIP",
  ].filter(Boolean) as string[];
  const addressComplete = missingAddress.length === 0;
  const needs = (bad: boolean) => (bad ? "border-amber-400 bg-amber-50/60 focus-visible:ring-amber-400" : "");

  function saveRestaurant() {
    setRestaurantError(null);
    startTransition(async () => {
      if (profileDirty) {
        const p = profileDraft;
        const result = await updateBusinessProfileAction({
          name: p.name,
          description: p.description,
          address: p.address,
          addressCity: p.addressCity,
          addressState: p.addressState,
          addressZip: p.addressZip,
          phone: p.phone,
          businessType: p.businessType,
          ...(p.escalationPhone !== baseline.profile.escalationPhone ? { escalationPhone: p.escalationPhone } : {}),
        });
        if (!result.success) { setRestaurantError(result.error || "Could not save your restaurant details."); return; }
      }
      if (hoursDirty) {
        const result = await updateBusinessHoursAction(hoursDraft);
        if (!result.success) { setRestaurantError(result.error || "Could not save your hours."); return; }
      }
      setBaseline({ profile: profileDraft, hours: hoursDraft });
      setRestaurantSaved(true);
      setTimeout(() => setRestaurantSaved(false), 2500);
    });
  }

  function discardRestaurant() {
    setProfileDraft(baseline.profile);
    setHoursDraft(baseline.hours);
    setRestaurantError(null);
  }

  // ── Holiday closures: saved the moment they're added or removed ──
  const [closures, setClosures] = useState<Closure[]>(initialClosures);
  const [closureStart, setClosureStart] = useState("");
  const [closureEnd, setClosureEnd] = useState("");
  const [multiDay, setMultiDay] = useState(false);
  const [closureNote, setClosureNote] = useState("");
  const [closureError, setClosureError] = useState<string | null>(null);
  const [closureBusy, setClosureBusy] = useState<string | null>(null);
  const grouped = useMemo(() => groupClosures(closures), [closures]);
  const closedSet = useMemo(() => new Set(closures.map((c) => c.closed_on)), [closures]);
  const suggestions = useMemo(() => upcomingHolidays(today, 8).filter((h) => !closedSet.has(h.date)).slice(0, 4), [today, closedSet]);

  function mergeClosures(added: Closure[]) {
    setClosures((prev) => [...prev.filter((c) => !added.some((a) => a.closed_on === c.closed_on)), ...added]);
  }

  function addClosure(startDate: string, endDate: string | undefined, note: string, busyKey: string, after?: () => void) {
    setClosureError(null);
    setClosureBusy(busyKey);
    startTransition(async () => {
      const result = await addClosureAction({ startDate, endDate, note });
      setClosureBusy(null);
      if (!result.success) { setClosureError(result.error || "Could not save that closure."); return; }
      mergeClosures(result.added || []);
      after?.();
    });
  }

  function removeClosure(ids: string[], busyKey: string) {
    setClosureError(null);
    setClosureBusy(busyKey);
    startTransition(async () => {
      const result = await removeClosureAction(ids);
      setClosureBusy(null);
      if (!result.success) { setClosureError(result.error || "Could not remove that closure."); return; }
      setClosures((prev) => prev.filter((c) => !ids.includes(c.id)));
    });
  }

  // ── Account ──
  const [fullName, setFullName] = useState(profile.fullName);
  const [savedName, setSavedName] = useState(profile.fullName);
  const [email, setEmail] = useState(profile.email);
  const [newPassword, setNewPassword] = useState("");
  const [accountMsg, setAccountMsg] = useState<{ field: "name" | "email" | "password"; ok: boolean; text: string } | null>(null);

  function saveAccount(field: "name" | "email" | "password") {
    setAccountMsg(null);
    startTransition(async () => {
      const result = field === "name" ? await updateProfileNameAction(fullName) : field === "email" ? await updateEmailAction(email) : await updatePasswordAction(newPassword);
      if (!result.success) { setAccountMsg({ field, ok: false, text: result.error || "Could not save." }); return; }
      if (field === "name") setSavedName(fullName);
      if (field === "password") setNewPassword("");
      setAccountMsg({ field, ok: true, text: field === "email" ? "Check your new email for a confirmation link." : field === "password" ? "Password updated" : "Saved" });
    });
  }

  const [notify, setNotify] = useState({
    calls: business.notification_preferences?.calls ?? false,
    escalations: business.notification_preferences?.escalations ?? true,
    digest: business.notification_preferences?.digest ?? false,
  });
  const [notifySaved, setNotifySaved] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);

  function toggleNotify(key: keyof typeof notify, value: boolean) {
    const previous = notify;
    const next = { ...notify, [key]: value };
    setNotify(next);
    setNotifyError(null);
    startTransition(async () => {
      const result = await updateNotificationPreferencesAction(next);
      if (!result.success) { setNotify(previous); setNotifyError(result.error || "Could not save."); return; }
      setNotifySaved(true);
      setTimeout(() => setNotifySaved(false), 1500);
    });
  }

  const [pinIsSet, setPinIsSet] = useState(moneyPinSet);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSaved, setPinSaved] = useState(false);

  function savePin() {
    setPinError(null);
    if (!/^\d{4}$/.test(pin)) { setPinError("The PIN must be exactly 4 digits."); return; }
    if (pin !== confirmPin) { setPinError("The two PINs don't match."); return; }
    startTransition(async () => {
      const result = await setMoneyPinAction({ pin, confirmPin });
      if (!result.success) { setPinError(result.error || "Could not save that PIN."); return; }
      setPinIsSet(true);
      setPin("");
      setConfirmPin("");
      setPinSaved(true);
      setTimeout(() => setPinSaved(false), 2000);
    });
  }

  const [tab, setTab] = useState(initialTab);
  const p = profileDraft;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
      <TabsList>
        <TabsTrigger value="restaurant"><Store className="h-3.5 w-3.5" /> Restaurant</TabsTrigger>
        <TabsTrigger value="account"><UserRound className="h-3.5 w-3.5" /> Your account</TabsTrigger>
      </TabsList>

      {/* ───────────── Restaurant ───────────── */}
      <TabsContent value="restaurant" className="mt-5 space-y-5">
        <Section icon={Store} title="Restaurant details" description="Your AI uses these on every call.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="biz-name">Restaurant name</Label>
              <Input id="biz-name" className="mt-1.5" value={p.name} onChange={(e) => setField({ name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="biz-type">Restaurant type</Label>
              <select
                id="biz-type"
                value={p.businessType}
                onChange={(e) => setField({ businessType: e.target.value })}
                className="mt-1.5 flex h-10 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="">Select a type…</option>
                {RESTAURANT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <p className="mt-1 text-[11.5px] text-text-faint">Shapes how your AI talks, e.g. more formal for fine dining.</p>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="biz-desc">Description</Label>
              <Textarea id="biz-desc" className="mt-1.5" rows={2} value={p.description} onChange={(e) => setField({ description: e.target.value })} placeholder="e.g. Family-owned coney island serving Detroit since 1985" />
            </div>
          </div>

          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-ink">Address</h3>
              {addressComplete ? (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Sales tax is set from this address</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-amber-700"><AlertCircle className="h-3.5 w-3.5" /> Needed for sales tax</span>
              )}
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-6">
                <Label htmlFor="addr" className="sr-only">Street address</Label>
                <Input id="addr" placeholder="Street address" value={p.address} onChange={(e) => setField({ address: e.target.value })} className={needs(!p.address.trim())} />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="city" className="text-[12px] text-text-muted">City</Label>
                <Input id="city" className={cn("mt-1", needs(!p.addressCity.trim()))} value={p.addressCity} onChange={(e) => setField({ addressCity: e.target.value })} />
              </div>
              <div className="sm:col-span-1">
                <Label htmlFor="state" className="text-[12px] text-text-muted">State</Label>
                <Input id="state" className={cn("mt-1 uppercase", needs(!/^[A-Za-z]{2}$/.test(p.addressState.trim())))} maxLength={2} placeholder="MI" value={p.addressState} onChange={(e) => setField({ addressState: e.target.value.toUpperCase() })} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="zip" className="text-[12px] text-text-muted">ZIP</Label>
                <Input id="zip" className={cn("mt-1", needs(!/^\d{5}(-\d{4})?$/.test(p.addressZip.trim())))} inputMode="numeric" maxLength={10} value={p.addressZip} onChange={(e) => setField({ addressZip: e.target.value })} />
              </div>
            </div>
            {!addressComplete && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                Add your {missingAddress.join(", ").replace(/, ([^,]*)$/, " and $1")}. Sales tax on each order is looked up from your full address. Without it, orders may be charged no tax at all.
              </p>
            )}
            <details className="group mt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
                <Receipt className="h-3.5 w-3.5" /> How sales tax works <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 space-y-2 rounded-lg border border-border bg-paper px-4 py-3 text-[12.5px] leading-relaxed text-text-muted">
                <p>Each order&apos;s tax is calculated live from your address (state, county and city combined), so you never have to keep a rate up to date. It appears on the total your AI reads back, the kitchen ticket, and the Orders page&apos;s &ldquo;Sales tax collected&rdquo; total, which is the figure you file with your state.</p>
                <p>One-time setup in Stripe: turn on Stripe Tax and add a registration for your state at{" "}
                  <a href="https://dashboard.stripe.com/settings/tax" target="_blank" rel="noreferrer" className="font-medium text-brand-dark underline">dashboard.stripe.com/settings/tax</a>. Without a registration Stripe returns $0 tax.
                </p>
              </div>
            </details>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="phone">Main phone</Label>
              <Input id="phone" className="mt-1.5" inputMode="tel" value={p.phone} onChange={(e) => setField({ phone: formatUsPhone(e.target.value) })} placeholder="(313) 555-0100" />
              <p className="mt-1 text-[11.5px] text-text-faint">Your restaurant&apos;s own line. Your HavnLine number is in Integrations.</p>
            </div>
            <div>
              <Label htmlFor="esc-phone">Escalation phone <span className="font-normal text-text-faint">(optional)</span></Label>
              <Input id="esc-phone" className="mt-1.5" inputMode="tel" value={p.escalationPhone} onChange={(e) => setField({ escalationPhone: formatUsPhone(e.target.value) })} placeholder="Leave blank to use your main phone" />
              <p className="mt-1 text-[11.5px] text-text-faint">Rung when your AI needs a person during open hours.</p>
            </div>
          </div>
        </Section>

        <Section
          icon={Clock}
          title="Hours"
          description="Your AI only takes orders during these hours."
          aside={
            <button type="button" onClick={copyMondayToAll} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-muted hover:text-ink">
              <Copy className="h-3.5 w-3.5" /> Copy Monday to all days
            </button>
          }
        >
          <div className="divide-y divide-border-soft rounded-xl border border-border">
            {hoursDraft.map((day, i) => (
              <div key={day.weekday} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="flex w-36 items-center gap-2.5">
                  <Switch checked={day.isOpen} onCheckedChange={(checked) => setDay(i, { isOpen: checked })} aria-label={`Open on ${WEEKDAY_LABELS[day.weekday]}`} />
                  <span className="text-[13.5px] font-medium text-text">{WEEKDAY_LABELS[day.weekday]}</span>
                </div>
                {day.isOpen ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input type="time" className="w-[7.5rem] sm:w-32" value={day.openTime} onChange={(e) => setDay(i, { openTime: e.target.value })} aria-label={`${WEEKDAY_LABELS[day.weekday]} opening time`} />
                    <span className="text-[12.5px] text-text-faint">to</span>
                    <Input type="time" className="w-[7.5rem] sm:w-32" value={day.closeTime} onChange={(e) => setDay(i, { closeTime: e.target.value })} aria-label={`${WEEKDAY_LABELS[day.weekday]} closing time`} />
                    {day.openTime === day.closeTime && <span className="hidden text-[12px] font-medium text-brand sm:inline">Open 24 hours</span>}
                  </div>
                ) : (
                  <span className="flex-1 text-[13px] text-text-faint">Closed</span>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section icon={CalendarX2} title="Holiday closures" description="Days you're closed even though you'd normally be open. Your AI tells callers you're closed, and when you'll reopen. Saved as soon as you add one.">
          {suggestions.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Quick add</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestions.map((h) => (
                  <button
                    key={h.date}
                    type="button"
                    disabled={closureBusy !== null}
                    onClick={() => addClosure(h.date, undefined, h.name, `h-${h.date}`)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] text-text hover:border-brand hover:text-brand-dark disabled:opacity-50"
                  >
                    {closureBusy === `h-${h.date}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    {h.name} <span className="text-text-faint">{shortDate(h.date)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={cn("rounded-xl border border-border bg-paper px-4 py-3", suggestions.length > 0 && "mt-4")}>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="closure-start" className="text-[12px] text-text-muted">{multiDay ? "First day" : "Date"}</Label>
                <Input id="closure-start" type="date" min={today} className="mt-1 w-44" value={closureStart} onChange={(e) => { setClosureStart(e.target.value); if (closureEnd && closureEnd < e.target.value) setClosureEnd(e.target.value); }} />
              </div>
              {multiDay && (
                <div>
                  <Label htmlFor="closure-end" className="text-[12px] text-text-muted">Last day</Label>
                  <Input id="closure-end" type="date" min={closureStart || today} className="mt-1 w-44" value={closureEnd} onChange={(e) => setClosureEnd(e.target.value)} />
                </div>
              )}
              <div className="min-w-[180px] flex-1">
                <Label htmlFor="closure-note" className="text-[12px] text-text-muted">Reason <span className="text-text-faint">(optional, your AI may mention it)</span></Label>
                <Input id="closure-note" className="mt-1" maxLength={80} placeholder="e.g. Family vacation" value={closureNote} onChange={(e) => setClosureNote(e.target.value)} />
              </div>
              <Button
                size="sm"
                variant="brand"
                disabled={!closureStart || (multiDay && !closureEnd) || closureBusy !== null}
                onClick={() => addClosure(closureStart, multiDay ? closureEnd : undefined, closureNote, "form", () => { setClosureStart(""); setClosureEnd(""); setClosureNote(""); setMultiDay(false); })}
              >
                {closureBusy === "form" ? "Adding…" : "Add closure"}
              </Button>
            </div>
            <label className="mt-2.5 inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-text-muted">
              <Switch checked={multiDay} onCheckedChange={(v) => { setMultiDay(v); if (!v) setClosureEnd(""); }} />
              More than one day
            </label>
          </div>
          {closureError && <p className="mt-2 text-[12.5px] text-danger">{closureError}</p>}

          <div className="mt-4">
            {grouped.length === 0 ? (
              <p className="text-[12.5px] text-text-faint">No closures coming up.</p>
            ) : (
              <ul className="divide-y divide-border-soft rounded-xl border border-border">
                {grouped.map((g) => {
                  const key = g.ids.join(",");
                  const count = g.ids.length;
                  return (
                    <li key={key} className="flex items-center gap-3 px-4 py-2.5">
                      <CalendarX2 className="h-4 w-4 shrink-0 text-text-faint" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-ink">
                          {g.start === g.end ? shortDate(g.start) : `${shortDate(g.start)} – ${shortDate(g.end)}`}
                          {count > 1 && <span className="ml-1.5 font-normal text-text-faint">({count} days)</span>}
                        </div>
                        {g.note && <div className="truncate text-[12px] text-text-muted">{g.note}</div>}
                      </div>
                      <button
                        type="button"
                        aria-label="Remove closure"
                        disabled={closureBusy !== null}
                        onClick={() => removeClosure(g.ids, key)}
                        className="rounded-md p-1.5 text-text-faint hover:bg-paper hover:text-danger disabled:opacity-50"
                      >
                        {closureBusy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Section>
      </TabsContent>

      {/* ───────────── Account ───────────── */}
      <TabsContent value="account" className="mt-5 space-y-5">
        <Section icon={UserRound} title="Login" description="Your own sign-in. Doesn't change anything your customers see.">
          <div className="space-y-4">
            <div>
              <Label htmlFor="full-name">Your name</Label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Input id="full-name" className="max-w-sm" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                <Button variant="outline" size="sm" onClick={() => saveAccount("name")} disabled={isPending || !fullName.trim() || fullName === savedName}>Save</Button>
                {accountMsg?.field === "name" && (accountMsg.ok ? <Saved show /> : <span className="text-[12px] text-danger">{accountMsg.text}</span>)}
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Input id="email" type="email" className="max-w-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Button variant="outline" size="sm" onClick={() => saveAccount("email")} disabled={isPending || email === profile.email}>Change email</Button>
              </div>
              {accountMsg?.field === "email" && <p className={cn("mt-1.5 text-[12px]", accountMsg.ok ? "text-success" : "text-danger")}>{accountMsg.text}</p>}
            </div>
            <div>
              <Label htmlFor="new-password">New password</Label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Input id="new-password" type="password" className="max-w-sm" placeholder="At least 8 characters" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <Button variant="outline" size="sm" onClick={() => saveAccount("password")} disabled={isPending || newPassword.length === 0}>Update password</Button>
                {accountMsg?.field === "password" && (accountMsg.ok ? <Saved show text={accountMsg.text} /> : <span className="text-[12px] text-danger">{accountMsg.text}</span>)}
              </div>
            </div>
          </div>
        </Section>

        <Section icon={Bell} title="Email notifications" description="Changes save right away." aside={<Saved show={notifySaved} />}>
          <div className="divide-y divide-border-soft">
            {([
              { key: "escalations", label: "When your AI needs you", desc: "A caller needs a person, like a complaint or refund." },
              { key: "calls", label: "Every call", desc: "An email after each call, with a link to the transcript." },
              { key: "digest", label: "Weekly summary", desc: "Calls, orders and sales for the week, every Monday." },
            ] as const).map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div>
                  <div className="text-[13.5px] font-medium text-text">{row.label}</div>
                  <div className="text-[12px] text-text-muted">{row.desc}</div>
                </div>
                <Switch checked={notify[row.key]} onCheckedChange={(v) => toggleNotify(row.key, v)} aria-label={row.label} />
              </div>
            ))}
          </div>
          {notifyError && <p className="mt-2 text-[12.5px] text-danger">{notifyError}</p>}
        </Section>

        <Section
          icon={KeyRound}
          title="Tablet money PIN"
          description="Staff enter this on the kitchen tablet before giving a refund or discount. One shared PIN for everyone."
          aside={
            <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium", pinIsSet ? "bg-success-soft text-success" : "bg-amber-50 text-amber-700")}>
              {pinIsSet ? "PIN set" : "No PIN yet"}
            </span>
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="pin" className="text-[12px] text-text-muted">{pinIsSet ? "New 4-digit PIN" : "4-digit PIN"}</Label>
              <Input id="pin" className="mt-1 w-32 tracking-[0.3em]" type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            </div>
            <div>
              <Label htmlFor="pin-confirm" className="text-[12px] text-text-muted">Type it again</Label>
              <Input id="pin-confirm" className="mt-1 w-32 tracking-[0.3em]" type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            </div>
            <Button variant="brand" size="sm" onClick={savePin} disabled={isPending || pin.length !== 4 || confirmPin.length !== 4}>{pinIsSet ? "Change PIN" : "Set PIN"}</Button>
            <Saved show={pinSaved} text="PIN saved. The tablet uses it right away." />
          </div>
          {pinError && <p className="mt-2 text-[12.5px] text-danger">{pinError}</p>}
        </Section>

        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 shadow-card sm:px-6">
          <div>
            <div className="text-[13.5px] font-medium text-ink">Log out</div>
            <div className="text-[12px] text-text-muted">End your session on this device.</div>
          </div>
          <form action={signOutAction}>
            <Button variant="outline" size="sm" type="submit"><LogOut className="h-3.5 w-3.5" /> Log out</Button>
          </form>
        </div>
      </TabsContent>

      {/* One save bar for the restaurant details and hours; only when something changed. */}
      <div className={cn("fixed inset-x-0 bottom-0 z-30 transition-transform duration-300 lg:left-64", (dirty || restaurantSaved || restaurantError) && tab === "restaurant" ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0")}>
        <div className="mx-auto mb-4 flex max-w-3xl items-center gap-3 rounded-2xl border border-border bg-ink px-4 py-3 text-white shadow-popover">
          {restaurantSaved && !dirty ? (
            <span className="flex items-center gap-2 text-[13px] font-medium"><Check className="h-4 w-4 text-success" /> Saved. Your AI uses this on the next call.</span>
          ) : (
            <>
              <span className="flex-1 text-[13px]">{restaurantError ? <span className="text-red-300">{restaurantError}</span> : "You have unsaved changes"}</span>
              <button onClick={discardRestaurant} disabled={isPending} className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white/75 hover:text-white">Discard</button>
              <Button variant="brand" size="sm" onClick={saveRestaurant} disabled={isPending}>{isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save changes"}</Button>
            </>
          )}
        </div>
      </div>
    </Tabs>
  );
}
