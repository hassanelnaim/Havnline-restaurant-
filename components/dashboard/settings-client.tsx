"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Building2, UserRound, Bell, Clock, KeyRound } from "lucide-react";
import type { DbBusiness, DbBusinessHours } from "@/lib/database/types";
import type { UserProfile } from "@/lib/data/profile";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { signOutAction } from "@/app/actions/auth";
import { updateBusinessProfileAction, updateBusinessHoursAction, updateNotificationPreferencesAction, setMoneyPinAction } from "@/app/actions/business";
import { updateProfileNameAction, updateEmailAction, updatePasswordAction } from "@/app/actions/profile";
import { RESTAURANT_TYPES } from "@/lib/restaurant-types";

const WEEKDAY_LABELS: Record<string, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
const WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function SettingsClient({ business, profile, hours, moneyPinSet }: { business: DbBusiness; profile: UserProfile; hours: DbBusinessHours[]; moneyPinSet: boolean }) {
  const [name, setName] = useState(business.name);
  const [businessType, setBusinessType] = useState(business.business_type || "");
  const [description, setDescription] = useState(business.description || "");
  const [address, setAddress] = useState(business.address || "");
  const [addressCity, setAddressCity] = useState(business.address_city || "");
  const [addressState, setAddressState] = useState(business.address_state || "");
  const [addressZip, setAddressZip] = useState(business.address_zip || "");
  const [phone, setPhone] = useState(business.phone || "");
  const [notifyCalls, setNotifyCalls] = useState(business.notification_preferences?.calls ?? false);
  const [notifyEscalations, setNotifyEscalations] = useState(business.notification_preferences?.escalations ?? true);
  const [notifyDigest, setNotifyDigest] = useState(business.notification_preferences?.digest ?? false);
  const [notifSaved, setNotifSaved] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const sortedHours = [...hours].sort((a, b) => WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday));
  const [hoursDraft, setHoursDraft] = useState(sortedHours.map((h) => ({ weekday: h.weekday, isOpen: h.is_open, openTime: h.open_time?.slice(0, 5) || "09:00", closeTime: h.close_time?.slice(0, 5) || "17:00" })));
  const [hoursSaved, setHoursSaved] = useState(false);
  const [hoursError, setHoursError] = useState<string | null>(null);

  function setDay(index: number, patch: Partial<(typeof hoursDraft)[number]>) {
    const next = [...hoursDraft];
    next[index] = { ...next[index], ...patch };
    setHoursDraft(next);
  }

  function handleSaveHours() {
    setHoursError(null);
    startTransition(async () => {
      const result = await updateBusinessHoursAction(hoursDraft);
      if (!result.success) { setHoursError(result.error || "Could not save hours."); return; }
      setHoursSaved(true);
      setTimeout(() => setHoursSaved(false), 1800);
    });
  }

  const [fullName, setFullName] = useState(profile.fullName);
  const [email, setEmail] = useState(profile.email);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function handleSaveProfile() {
    setError(null);
    startTransition(async () => {
      const result = await updateBusinessProfileAction({ name, description, address, addressCity, addressState, addressZip, phone, businessType });
      if (!result.success) { setError(result.error || "Could not save changes."); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    });
  }

  function handleSaveName() {
    setNameError(null);
    startTransition(async () => {
      const result = await updateProfileNameAction(fullName);
      if (!result.success) { setNameError(result.error || "Could not save your name."); return; }
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 1800);
    });
  }

  function handleSaveEmail() {
    setEmailError(null);
    startTransition(async () => {
      const result = await updateEmailAction(email);
      if (!result.success) { setEmailError(result.error || "Could not update your email."); return; }
      setEmailSaved(true);
    });
  }

  function handleSavePassword() {
    setPasswordError(null);
    startTransition(async () => {
      const result = await updatePasswordAction(newPassword);
      if (!result.success) { setPasswordError(result.error || "Could not update your password."); return; }
      setPasswordSaved(true);
      setNewPassword("");
      setTimeout(() => setPasswordSaved(false), 2500);
    });
  }

  function handleSaveNotifications() {
    startTransition(async () => {
      await updateNotificationPreferencesAction({ calls: notifyCalls, escalations: notifyEscalations, digest: notifyDigest });
      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 2500);
    });
  }

  const [moneyPin, setMoneyPinInput] = useState("");
  const [confirmMoneyPin, setConfirmMoneyPin] = useState("");
  const [pinSaved, setPinSaved] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinIsSet, setPinIsSet] = useState(moneyPinSet);

  function handleSaveMoneyPin() {
    setPinError(null);
    if (!/^\d{4}$/.test(moneyPin)) { setPinError("PIN must be exactly 4 digits."); return; }
    if (moneyPin !== confirmMoneyPin) { setPinError("PINs don't match."); return; }
    startTransition(async () => {
      const result = await setMoneyPinAction({ pin: moneyPin, confirmPin: confirmMoneyPin });
      if (!result.success) { setPinError(result.error || "Could not save that PIN."); return; }
      setPinIsSet(true);
      setMoneyPinInput("");
      setConfirmMoneyPin("");
      setPinSaved(true);
      setTimeout(() => setPinSaved(false), 1800);
    });
  }

  return (
    <Tabs defaultValue="business">
      <TabsList className="flex-wrap">
        <TabsTrigger value="business"><Building2 className="h-3.5 w-3.5" /> Business profile</TabsTrigger>
        <TabsTrigger value="hours"><Clock className="h-3.5 w-3.5" /> Hours</TabsTrigger>
        <TabsTrigger value="account"><UserRound className="h-3.5 w-3.5" /> Account</TabsTrigger>
        <TabsTrigger value="notifications"><Bell className="h-3.5 w-3.5" /> Notifications</TabsTrigger>
        <TabsTrigger value="security"><KeyRound className="h-3.5 w-3.5" /> Security</TabsTrigger>
      </TabsList>

      <TabsContent value="business">
        <Card>
          <CardHeader><CardTitle>Business profile</CardTitle><CardDescription>Shown to your AI order-taker and used across the dashboard.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Business name</Label><Input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div>
                <Label>Restaurant type</Label>
                <select className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                  <option value="">Select a type…</option>
                  {RESTAURANT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-text-faint">Your AI uses this to shape its assumptions on the phone.</p>
              </div>
            </div>
            <div><Label>Description</Label><Textarea rows={3} className="mt-1.5" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div><Label>Address</Label><Input className="mt-1.5" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div><Label>City</Label><Input className="mt-1.5" value={addressCity} onChange={(e) => setAddressCity(e.target.value)} /></div>
              <div><Label>State</Label><Input className="mt-1.5" maxLength={2} placeholder="NY" value={addressState} onChange={(e) => setAddressState(e.target.value)} /></div>
              <div><Label>ZIP</Label><Input className="mt-1.5" value={addressZip} onChange={(e) => setAddressZip(e.target.value)} /></div>
            </div>
            <p className="text-[11px] text-text-faint">City, state and ZIP are used to calculate real sales tax on every order below — they need to be your restaurant's actual location, not just a display address.</p>
            <div><Label>Phone (used for call transfers)</Label><Input className="mt-1.5" value={phone} onChange={(e) => setPhone(e.target.value)} /><p className="mt-1 text-[11px] text-text-faint">Your HavnLine number and forwarding are managed in Integrations.</p></div>
            {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
            <div className="flex items-center gap-3">
              <Button variant="brand" size="sm" onClick={handleSaveProfile} disabled={isPending}>{isPending ? "Saving…" : "Save changes"}</Button>
              {saved && <span className="text-[12.5px] font-medium text-success">Saved ✓</span>}
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader><CardTitle>Sales tax</CardTitle><CardDescription>Calculated automatically on every order via Stripe Tax — not something you configure here.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[13px] text-text">
              Every phone order's tax is now looked up live from your restaurant's real address above — the correct combined state, county and city rate, not a flat number you'd have to keep up to date yourself. It shows up on the total your AI quotes, the kitchen ticket, and the <Link href="/dashboard/end-of-day" className="text-brand underline">End of Day report</Link>'s "Tax collected" total, which is what you'd use when filing with your state's Department of Revenue (sales tax isn't an IRS/federal thing — it's remitted to the state).
            </p>
            <p className="text-[13px] text-text-faint">
              Two one-time things need to happen in Stripe's own dashboard before this actually collects anything: turning on Stripe Tax, and adding a tax registration for your state (without a registration, Stripe calculates successfully but returns $0 tax — not an error). Both are done at{" "}
              <a href="https://dashboard.stripe.com/settings/tax" target="_blank" rel="noreferrer" className="text-brand underline">dashboard.stripe.com/settings/tax</a>.
            </p>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="hours">
        <Card>
          <CardHeader><CardTitle>Business hours</CardTitle><CardDescription>Your AI only takes phone orders within these hours.</CardDescription></CardHeader>
          <CardContent>
            <div className="divide-y divide-border-soft rounded-xl border border-border">
              {hoursDraft.map((day, i) => (
                <div key={day.weekday} className="flex flex-wrap items-center gap-4 px-4 py-3.5">
                  <div className="flex w-32 items-center gap-2.5"><Switch checked={day.isOpen} onCheckedChange={(checked) => setDay(i, { isOpen: checked })} /><span className="text-[13.5px] font-medium text-text">{WEEKDAY_LABELS[day.weekday]}</span></div>
                  {day.isOpen ? (
                    <div className="flex flex-1 items-center gap-2">
                      <Input type="time" className="w-32" value={day.openTime} onChange={(e) => setDay(i, { openTime: e.target.value })} />
                      <span className="text-[12.5px] text-text-faint">to</span>
                      <Input type="time" className="w-32" value={day.closeTime} onChange={(e) => setDay(i, { closeTime: e.target.value })} />
                      {day.openTime === day.closeTime && <span className="text-[12px] font-medium text-brand">Open 24 hours</span>}
                    </div>
                  ) : <span className="flex-1 text-[13px] text-text-faint">Closed</span>}
                </div>
              ))}
            </div>
            {hoursError && <p className="mt-3 text-[12px] text-danger">{hoursError}</p>}
            <div className="mt-4 flex items-center gap-3">
              <Button variant="brand" size="sm" onClick={handleSaveHours} disabled={isPending}>{isPending ? "Saving…" : "Save hours"}</Button>
              {hoursSaved && <span className="text-[12.5px] font-medium text-success">Saved ✓</span>}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="account">
        <Card>
          <CardHeader><CardTitle>Your profile</CardTitle><CardDescription>Your personal login and display name.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Full name</Label>
              <div className="mt-1.5 flex gap-2"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /><Button variant="brand" size="sm" onClick={handleSaveName} disabled={isPending}>Save</Button></div>
              {nameError && <p className="mt-1.5 text-[12px] text-danger">{nameError}</p>}
              {nameSaved && <p className="mt-1.5 text-[12px] text-success">Saved ✓</p>}
            </div>
            <div>
              <Label>Email</Label>
              <div className="mt-1.5 flex gap-2"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /><Button variant="brand" size="sm" onClick={handleSaveEmail} disabled={isPending}>Save</Button></div>
              {emailError && <p className="mt-1.5 text-[12px] text-danger">{emailError}</p>}
              {emailSaved && <p className="mt-1.5 text-[12px] text-success">Check your new email for a confirmation link.</p>}
            </div>
            <Separator />
            <div>
              <Label>New password</Label>
              <div className="mt-1.5 flex gap-2"><Input type="password" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /><Button variant="brand" size="sm" onClick={handleSavePassword} disabled={isPending || newPassword.length === 0}>Update password</Button></div>
              {passwordError && <p className="mt-1.5 text-[12px] text-danger">{passwordError}</p>}
              {passwordSaved && <p className="mt-1.5 text-[12px] text-success">Password updated ✓</p>}
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div><div className="text-[13.5px] font-medium text-text">Log out</div><div className="text-[12px] text-text-muted">End your session on this device.</div></div>
              <form action={signOutAction}><Button variant="outline" size="sm" type="submit">Log out</Button></form>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="notifications">
        <Card>
          <CardHeader><CardTitle>Notifications</CardTitle><CardDescription>Choose what you want to be alerted about.</CardDescription></CardHeader>
          <CardContent className="space-y-1">
            {[
              { label: "New calls", desc: "Get notified every time a call comes in.", value: notifyCalls, set: setNotifyCalls },
              { label: "Human escalations", desc: "Get notified when the AI needs your help.", value: notifyEscalations, set: setNotifyEscalations },
              { label: "Weekly digest", desc: "A summary of calls and orders each week.", value: notifyDigest, set: setNotifyDigest },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between border-b border-border-soft py-3.5 last:border-0">
                <div><div className="text-[13.5px] font-medium text-text">{row.label}</div><div className="text-[12px] text-text-muted">{row.desc}</div></div>
                <Switch checked={row.value} onCheckedChange={row.set} />
              </div>
            ))}
            <p className="pt-3 text-[11.5px] text-text-faint">Escalation emails require an email provider to be connected on the backend — ask your developer to confirm one's set up if emails aren't arriving.</p>
            <div className="flex items-center gap-3 pt-1">
              <Button variant="brand" size="sm" onClick={handleSaveNotifications} disabled={isPending}>Save preferences</Button>
              {notifSaved && <span className="text-[12px] text-success">Saved ✓</span>}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="security">
        <Card>
          <CardHeader>
            <CardTitle>Tablet money PIN</CardTitle>
            <CardDescription>Required on the paired HavnLine Printer tablet before a refund or discount — never needed for comping or adding items to an order.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-[12.5px]">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${pinIsSet ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
                {pinIsSet ? "A PIN is set" : "No PIN set yet"}
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>{pinIsSet ? "New 4-digit PIN" : "4-digit PIN"}</Label>
                <Input
                  className="mt-1.5"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  value={moneyPin}
                  onChange={(e) => setMoneyPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
              </div>
              <div>
                <Label>Confirm PIN</Label>
                <Input
                  className="mt-1.5"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  value={confirmMoneyPin}
                  onChange={(e) => setConfirmMoneyPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
              </div>
            </div>
            <p className="text-[11px] text-text-faint">This is one shared PIN for all staff on this tablet, not a per-person login. Changing it here takes effect immediately on the paired tablet.</p>
            {pinError && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{pinError}</div>}
            <div className="flex items-center gap-3">
              <Button variant="brand" size="sm" onClick={handleSaveMoneyPin} disabled={isPending || moneyPin.length !== 4 || confirmMoneyPin.length !== 4}>
                {isPending ? "Saving…" : pinIsSet ? "Change PIN" : "Set PIN"}
              </Button>
              {pinSaved && <span className="text-[12.5px] font-medium text-success">Saved ✓</span>}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
