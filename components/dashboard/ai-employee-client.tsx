"use client";
import { useState, useTransition } from "react";
import { Sparkles, Mic, Gauge } from "lucide-react";
import type { AiResponsibilities, DbAiReceptionist, DbAiVoiceConfig, DbBusinessHours, Personality } from "@/lib/database/types";
import { updateAiEmployeeAction } from "@/app/actions/business";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ElevenLabsVoiceBrowser } from "@/components/voice/elevenlabs-voice-browser";
import { cn } from "@/lib/utils";

const PERSONALITIES: { id: Personality; label: string }[] = [
  { id: "professional", label: "Professional" },
  { id: "friendly", label: "Friendly" },
  { id: "warm", label: "Warm" },
  { id: "energetic", label: "Energetic" },
  { id: "calm", label: "Calm" },
];

const RESPONSIBILITY_ITEMS: { key: keyof AiResponsibilities; label: string }[] = [
  { key: "answer_questions", label: "Answering questions" },
  { key: "take_orders", label: "Taking phone orders" },
  { key: "modify_orders", label: "Adding/removing items mid-call" },
  { key: "collect_customer_info", label: "Collecting customer info" },
  { key: "escalate_to_human", label: "Escalating to a human" },
];

export function AiEmployeeClient({ ai, voice, hours }: { ai: DbAiReceptionist; voice: DbAiVoiceConfig; hours: DbBusinessHours[] }) {
  const [generatedInstructions, setGeneratedInstructions] = useState(ai.generated_instructions);
  const [personality, setPersonality] = useState(ai.personality);
  const [responsibilities, setResponsibilities] = useState(ai.responsibilities);
  const [orderingRules, setOrderingRules] = useState(ai.ordering_rules || "");
  const [escalationRules, setEscalationRules] = useState(ai.escalation_rules || "");
  const [voiceId, setVoiceId] = useState(voice.voice_id);
  const [customVoiceRef, setCustomVoiceRef] = useState<string | null>(voice.voice_id === "custom" ? voice.provider_voice_ref : null);
  const [customVoiceName, setCustomVoiceName] = useState<string | null>(voice.voice_id === "custom" ? voice.provider_voice_name : null);
  const [speakingRate, setSpeakingRate] = useState(voice.speaking_rate ?? 1.0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateAiEmployeeAction({
        personality, responsibilities, voiceId, orderingRules, escalationRules,
        customVoice: customVoiceRef && customVoiceName ? { providerVoiceRef: customVoiceRef, providerVoiceName: customVoiceName } : null,
        speakingRate,
      });
      if (!result.success) { setError(result.error || "Could not save changes."); return; }
      if (result.generatedInstructions) setGeneratedInstructions(result.generatedInstructions);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    });
  }

  return (
    <div>
      <Card className="mb-4 border-brand/20 bg-brand-soft/40">
        <CardContent className="flex items-start gap-3 p-4">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-brand-dark">AI briefing</div>
            <p className="mt-1 text-[13px] text-text">
              {generatedInstructions || "Save your settings below to generate a plain-English summary of what your AI is set up to do."}
            </p>
          </div>
        </CardContent>
      </Card>

    <Tabs defaultValue="personality">
      <TabsList>
        <TabsTrigger value="personality">Personality</TabsTrigger>
        <TabsTrigger value="voice"><Mic className="h-3.5 w-3.5" /> Voice</TabsTrigger>
        <TabsTrigger value="responsibilities">Responsibilities</TabsTrigger>
        <TabsTrigger value="behavior">Business behavior</TabsTrigger>
      </TabsList>

      <TabsContent value="personality">
        <Card>
          <CardHeader>
            <CardTitle>Personality</CardTitle>
            <CardDescription>The tone your AI uses on every call. It never gives itself a name — it identifies as your business's automated order-taker, not a person.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {customVoiceName && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-paper px-3.5 py-2.5 text-[12.5px] text-text-muted">
                <Mic className="h-3.5 w-3.5 text-brand" /> Voice: <span className="font-medium text-ink">{customVoiceName}</span>
                <span className="text-text-faint">— change this in the Voice tab</span>
              </div>
            )}
            <div>
              <Label>Tone</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {PERSONALITIES.map((p) => (
                  <button key={p.id} onClick={() => setPersonality(p.id)} className={cn("rounded-xl border px-3 py-3 text-[13px] font-medium transition-colors", personality === p.id ? "border-brand bg-brand-soft text-brand-dark" : "border-border bg-card text-text hover:bg-paper")}>{p.label}</button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="voice">
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Gauge className="h-4 w-4 text-brand" /> Speaking speed</CardTitle>
            <CardDescription>How fast your AI talks on a real call. Most callers do fine around normal — a noticeably slower pace can help with older customers or a complicated order; faster can help if your crowd just wants to get in and out.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <span className="w-14 text-[12px] text-text-faint">Slower</span>
              <input
                type="range"
                min={0.7}
                max={1.2}
                step={0.05}
                value={speakingRate}
                onChange={(e) => setSpeakingRate(parseFloat(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-brand"
              />
              <span className="w-14 text-right text-[12px] text-text-faint">Faster</span>
              <span className="w-16 shrink-0 rounded-lg border border-border bg-paper px-2.5 py-1 text-center font-mono text-[12.5px] font-semibold text-ink">{speakingRate.toFixed(2)}x</span>
            </div>
            <p className="mt-2.5 text-[11.5px] text-text-faint">
              Use the <Mic className="inline h-3 w-3 -mt-0.5" /> preview button below on any voice to hear it at this exact speed before saving.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /> Voice</CardTitle>
            <CardDescription>{customVoiceName ? `Currently using: ${customVoiceName}` : "Browse your ElevenLabs voice library and pick a voice."}</CardDescription>
          </CardHeader>
          <CardContent>
            <ElevenLabsVoiceBrowser selectedVoiceRef={customVoiceRef} onSelect={(id, name) => { setCustomVoiceRef(id); setCustomVoiceName(name); }} speakingRate={speakingRate} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="responsibilities">
        <Card>
          <CardHeader><CardTitle>Responsibilities</CardTitle><CardDescription>What your AI is allowed to do on its own.</CardDescription></CardHeader>
          <CardContent className="divide-y divide-border-soft">
            {RESPONSIBILITY_ITEMS.map((item) => (
              <div key={item.key} className="flex items-center justify-between py-3">
                <span className="text-[13.5px] font-medium text-text">{item.label}</span>
                <Switch checked={responsibilities[item.key]} onCheckedChange={(checked) => setResponsibilities((prev) => ({ ...prev, [item.key]: checked }))} />
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="behavior">
        <Card>
          <CardHeader><CardTitle>Rules</CardTitle><CardDescription>Extra instructions layered on top of the defaults.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div><Label>Ordering rules</Label><Textarea rows={3} className="mt-1.5" value={orderingRules} onChange={(e) => setOrderingRules(e.target.value)} /></div>
            <div><Label>Escalation rules</Label><Textarea rows={3} className="mt-1.5" value={escalationRules} onChange={(e) => setEscalationRules(e.target.value)} /></div>
          </CardContent>
        </Card>
      </TabsContent>

      <div className="mt-6 flex items-center gap-3">
        <Button variant="brand" onClick={handleSave} disabled={isPending}>{isPending ? "Saving…" : "Save changes"}</Button>
        {saved && <span className="text-[12.5px] font-medium text-success">Saved ✓</span>}
        {error && <span className="text-[12.5px] font-medium text-danger">{error}</span>}
      </div>
    </Tabs>
    </div>
  );
}
