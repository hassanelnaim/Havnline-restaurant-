"use client";
import { useState, useEffect } from "react";
import { Play, Square, Check, Loader2, RefreshCw } from "lucide-react";
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-text-faint">{voices.length} voices in your ElevenLabs library</p>
        <Button size="sm" variant="ghost" onClick={loadVoices}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>
      <p className="text-[11.5px] text-text-faint">The round button plays ElevenLabs' own sample of each voice.</p>
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {voices.map((voice) => {
          const isSelected = selectedVoiceRef === voice.voiceId;
          return (
            <div key={voice.voiceId} className={cn("flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5", isSelected ? "border-brand bg-brand-soft" : "border-border bg-card")}>
              <div className="flex items-center gap-3">
                {voice.previewUrl && (
                  <button type="button" onClick={() => togglePreview(voice)} title="Play ElevenLabs' sample" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-text-muted hover:bg-paper">
                    {playingId === voice.voiceId ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                )}
                <div>
                  <div className="text-[13px] font-medium text-ink">{voice.name}</div>
                  {(voice.category || voice.description) && (
                    <div className="mt-0.5 flex gap-1.5">
                      {voice.category && <Badge variant="neutral">{voice.category}</Badge>}
                      {voice.description && <Badge variant="neutral">{voice.description}</Badge>}
                    </div>
                  )}
                </div>
              </div>
              <Button size="sm" variant={isSelected ? "brand" : "outline"} onClick={() => onSelect(voice.voiceId, voice.name)}>
                {isSelected ? <><Check className="h-3.5 w-3.5" /> Selected</> : "Choose"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
