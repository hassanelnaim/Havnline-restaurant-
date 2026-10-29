"use client";

import { useEffect, useRef, useState } from "react";
import { TURNSTILE_SITE_KEY } from "@/lib/security/captcha";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Couldn't load the security check."));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Cloudflare's "are you human" check. Most people never see a puzzle: it
 * passes on its own in a second or two. Puts the token in a hidden
 * "captchaToken" field for server-action forms, and hands it to onToken for
 * forms that submit from the browser. Renders nothing when no site key is
 * set. A token works once, so remount it (change its key) after each submit.
 */
export function Turnstile({ onToken, className }: { onToken?: (token: string) => void; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let id: string | null = null;
    let cancelled = false;
    const set = (t: string) => {
      setToken(t);
      onTokenRef.current?.(t);
    };
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        id = window.turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: "interaction-only",
          "refresh-expired": "auto",
          callback: (t: string) => set(t),
          "expired-callback": () => set(""),
          "error-callback": () => {
            set("");
            setFailed(true);
          },
        });
      })
      .catch(() => setFailed(true));

    // A token works once. After the form sends it, fetch a fresh one so a
    // second try (wrong password, typo) doesn't send a used token.
    const form = box.current?.closest("form");
    const onSubmit = () =>
      setTimeout(() => {
        if (cancelled || !id || !window.turnstile) return;
        set("");
        window.turnstile.reset(id);
      }, 0);
    form?.addEventListener("submit", onSubmit);
    return () => {
      cancelled = true;
      form?.removeEventListener("submit", onSubmit);
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <div className={className}>
      <div ref={box} />
      <input type="hidden" name="captchaToken" value={token} />
      {failed && (
        <p className="mt-1 text-[12px] text-danger" role="alert">
          The security check couldn&apos;t load. Turn off any ad or script blocker for this site and reload the page.
        </p>
      )}
    </div>
  );
}
