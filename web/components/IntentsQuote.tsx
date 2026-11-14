"use client";

import { Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { ORIGINS, type OriginId, type Quote } from "@/lib/intents";
import { Card } from "./ui";

/** Live NEAR Intents price for sending this top-up from another chain (quote only, never a transfer). */
export function IntentsQuote({ usd }: { usd: number }) {
  const [from, setFrom] = useState<OriginId>("base");
  const [q, setQ] = useState<Quote | null>();
  useEffect(() => {
    setQ(undefined);
    const t = setTimeout(() => {
      fetch(`/api/quote?from=${from}&usd=${usd}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setQ)
        .catch(() => setQ(null));
    }, 250);
    return () => clearTimeout(t);
  }, [from, usd]);
  return (
    <Card>
      <p className="flex items-center gap-2 text-sm text-muted">
        <Globe size={15} /> Sending from another chain?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ORIGINS.map((o) => (
          <button key={o.id} onClick={() => setFrom(o.id)} className={`rounded-full px-3 py-1.5 text-[13px] ${from === o.id ? "bg-brand/30 text-text" : "bg-white/5 text-muted"}`}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="tabular mt-3 text-[14px]">
        {q === undefined
          ? "Getting a live NEAR Intents quote…"
          : q === null
            ? "No live route right now."
            : `$${usd} arrives on NEAR as $${(Number(q.amountOut) / 1e6).toFixed(2)} USDC in about ${q.timeEstimate}s (fees $${q.fee.toFixed(2)}).`}
      </p>
      <p className="mt-1 text-[11px] text-faint">Live mainnet price from NEAR Intents (1Click, dry quote). This demo allowance uses test dollars, so nothing is sent.</p>
    </Card>
  );
}
