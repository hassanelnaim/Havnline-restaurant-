"use client";
import { useState, useEffect } from "react";
import { Play, Square, Check, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  previewUrl: string | null;
  category: string | null;
  description: string | null;
}

export function ElevenLabsVoiceBrowser({ selectedVoiceRef, onSelect }: { selectedVoiceRef: string | null; onSelect: (voiceId: string, name: string) => void }) {
  const [voices, setVoices] = useState<ElevenLabsVoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  async function loadVoices() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/elevenlabs/voices");
      const data = await res.json();
      if (data.error && (!data.voices || data.voices.length === 0)) {
        setError(data.error);
        setVoices([]);
      } else {
        setVoices(data.voices || []);
      }
    } catch {
      setError("Could not load your voice library.");
      setVoices([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadVoices();
    return () => { audioEl?.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePreview(voice: ElevenLabsVoice) {
    if (!voice.previewUrl) return;
    if (playingId === voice.voiceId) {
      audioEl?.pause();
      setPlayingId(null);
      return;
    }
    audioEl?.pause();
    const audio = new Audio(voice.previewUrl);
    setAudioEl(audio);
    audio.onended = () => setPlayingId(null);
    audio.play();
    setPlayingId(voice.voiceId);
  }

  if (loading) {
    return <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-paper px-4 py-6 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading your ElevenLabs voice library…</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-paper px-4 py-6 text-center text-[13px] text-text-muted">
        {error}
        <div className="mt-3"><Button size="sm" variant="outline" onClick={loadVoices}><RefreshCw className="h-3.5 w-3.5" /> Try again</Button></div>
      </div>
    );
  }

  if (!voices || voices.length === 0) {
    return <div className="rounded-lg border border-dashed border-border bg-paper px-4 py-6 text-center text-[13px] text-text-muted">No voices found in your ElevenLabs account.</div>;
  }

  // Filter chips from the voices' own labels (accent etc.), most common first.
  const tagCounts = new Map<string, number>();
  for (const v of voices) if (v.description) tagCounts.set(v.description, (tagCounts.get(v.description) || 0) + 1);
  const tags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 8);
  const q = query.trim().toLowerCase();
  const shown = voices.filter((v) => (!tag || v.description === tag) && (!q || v.name.toLowerCase().includes(q)));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${voices.length} voices…`} className="h-9 w-full rounded-lg border border-border bg-paper pl-8 pr-3 text-[13px] focus:border-brand focus:outline-none" />
        </div>
        <Button size="sm" variant="ghost" onClick={loadVoices} title="Reload your ElevenLabs library"><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
      {tags.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {[null, ...tags].map((t) => (
            <button key={t ?? "all"} onClick={() => setTag(t)} className={cn("rounded-full border px-2.5 py-0.5 text-[12px] font-medium capitalize transition-colors", tag === t ? "border-brand bg-brand text-white" : "border-border bg-card text-text-muted hover:border-brand/40")}>
              {t ?? "All"}
            </button>
          ))}
        </div>
      )}
      <p className="text-[11.5px] text-text-faint">▶ plays ElevenLabs&apos; own sample of each voice.</p>
      <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {shown.length === 0 && <p className="py-4 text-[13px] text-text-muted">No voices match.</p>}
        {shown.map((voice) => {
          const isSelected = selectedVoiceRef === voice.voiceId;
          const [first, ...rest] = voice.name.split(" - ");
          return (
            <div key={voice.voiceId} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5", isSelected ? "border-brand bg-brand-soft" : "border-border bg-card")}>
              {voice.previewUrl ? (
                <button type="button" onClick={() => togglePreview(voice)} title="Play ElevenLabs' sample" className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", playingId === voice.voiceId ? "border-brand bg-brand text-white" : "border-border bg-card text-text-muted hover:bg-paper")}>
                  {playingId === voice.voiceId ? <Square className="h-3 w-3" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
                </button>
              ) : <span className="h-8 w-8 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{first}</div>
                <div className="truncate text-[11.5px] text-text-muted">{rest.join(" - ") || voice.description || voice.category}</div>
              </div>
              <Button size="sm" variant={isSelected ? "brand" : "outline"} onClick={() => onSelect(voice.voiceId, voice.name)}>
                {isSelected ? <><Check className="h-3.5 w-3.5" /> Chosen</> : "Choose"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
