"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Building2, UserRound, Bell, Clock } from "lucide-react";
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
import { updateBusinessProfileAction, updateBusinessHoursAction, updateNotificationPreferencesAction } from "@/app/actions/business";
import { updateProfileNameAction, updateEmailAction, updatePasswordAction } from "@/app/actions/profile";

const WEEKDAY_LABELS: Record<string, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
const WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function SettingsClient({ business, profile, hours }: { business: DbBusiness; profile: UserProfile; hours: DbBusinessHours[] }) {
  const [name, setName] = useState(business.name);
  const [description, setDescription] = useState(business.description || "");
  const [address, setAddress] = useState(business.address || "");
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
      const result = await updateBusinessProfileAction({ name, description, address, phone });
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

  return (
    <Tabs defaultValue="business">
      <TabsList className="flex-wrap">
        <TabsTrigger value="business"><Building2 className="h-3.5 w-3.5" /> Business profile</TabsTrigger>
        <TabsTrigger value="hours"><Clock className="h-3.5 w-3.5" /> Hours</TabsTrigger>
        <TabsTrigger value="account"><UserRound className="h-3.5 w-3.5" /> Account</TabsTrigger>
        <TabsTrigger value="notifications"><Bell className="h-3.5 w-3.5" /> Notifications</TabsTrigger>
      </TabsList>

      <TabsContent value="business">
        <Card>
          <CardHeader><CardTitle>Business profile</CardTitle><CardDescription>Shown to your AI order-taker and used across the dashboard.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div><Label>Business name</Label><Input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>Description</Label><Textarea rows={3} className="mt-1.5" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Address</Label><Input className="mt-1.5" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
              <div><Label>Phone (used for call transfers)</Label><Input className="mt-1.5" value={phone} onChange={(e) => setPhone(e.target.value)} /><p className="mt-1 text-[11px] text-text-faint">Your HavnLine number and forwarding are managed in Integrations.</p></div>
            </div>
            {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
            <div className="flex items-center gap-3">
              <Button variant="brand" size="sm" onClick={handleSaveProfile} disabled={isPending}>{isPending ? "Saving…" : "Save changes"}</Button>
              {saved && <span className="text-[12.5px] font-medium text-success">Saved ✓</span>}
            </div>
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
                    <div className="flex flex-1 items-center gap-2"><Input type="time" className="w-32" value={day.openTime} onChange={(e) => setDay(i, { openTime: e.target.value })} /><span className="text-[12.5px] text-text-faint">to</span><Input type="time" className="w-32" value={day.closeTime} onChange={(e) => setDay(i, { closeTime: e.target.value })} /></div>
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
              <div className="mt-1.5 flex gap-2"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /><Button variant="outline" size="sm" onClick={handleSaveName} disabled={isPending}>Save</Button></div>
              {nameError && <p className="mt-1.5 text-[12px] text-danger">{nameError}</p>}
              {nameSaved && <p className="mt-1.5 text-[12px] text-success">Saved ✓</p>}
            </div>
            <div>
              <Label>Email</Label>
              <div className="mt-1.5 flex gap-2"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /><Button variant="outline" size="sm" onClick={handleSaveEmail} disabled={isPending}>Save</Button></div>
              {emailError && <p className="mt-1.5 text-[12px] text-danger">{emailError}</p>}
              {emailSaved && <p className="mt-1.5 text-[12px] text-success">Check your new email for a confirmation link.</p>}
            </div>
            <Separator />
            <div>
              <Label>New password</Label>
              <div className="mt-1.5 flex gap-2"><Input type="password" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /><Button variant="outline" size="sm" onClick={handleSavePassword} disabled={isPending || newPassword.length === 0}>Update password</Button></div>
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
    </Tabs>
  );
}
