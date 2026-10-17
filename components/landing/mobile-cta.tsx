"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** A "Start free trial" bar pinned to the bottom on phones, once the visitor scrolls past the top. */
export function MobileCta() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 520);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className={`fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 p-3 backdrop-blur transition-transform duration-300 sm:hidden ${visible ? "translate-y-0" : "translate-y-full"}`}>
      <Link href="/signup" className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[14px] font-semibold text-white shadow-sm">
        Start your free trial <ArrowRight className="h-4 w-4" />
      </Link>
      <p className="mt-1.5 text-center text-[11px] text-text-faint">7 days free · Cancel anytime</p>
    </div>
  );
}
