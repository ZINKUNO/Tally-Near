"use client";

import { Globe } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { ORIGINS, type Deposit, type DepositStatus, type OriginId, type Quote } from "@/lib/intents";
import { Card } from "./ui";

/**
 * NEAR Intents for family abroad: a live price for sending this top-up from another chain, and, for an
 * allowance owned by an implicit account, a real 1Click deposit address that delivers USDC to the same
 * account id on NEAR mainnet.
 */
export function IntentsQuote({ usd, recipient }: { usd: number; recipient?: string }) {
  const [from, setFrom] = useState<OriginId>("base");
  const [q, setQ] = useState<Quote | null>();
  const [refund, setRefund] = useState("");
  const [dep, setDep] = useState<Deposit>();
  const [st, setSt] = useState<DepositStatus>();
  const [err, setErr] = useState<string>();
  const live = !!recipient && /^[0-9a-f]{64}$/.test(recipient);

  useEffect(() => {
    setQ(undefined);
    setDep(undefined);
    const t = setTimeout(() => {
      fetch(`/api/quote?from=${from}&usd=${usd}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setQ)
        .catch(() => setQ(null));
    }, 250);
    return () => clearTimeout(t);
  }, [from, usd]);

  useEffect(() => {
    if (!dep) return;
    const poll = () =>
      fetch(`/api/intents?depositAddress=${dep.depositAddress}`)
        .then((r) => r.json())
        .then(setSt)
        .catch(() => {});
    poll();
    const t = setInterval(poll, 6000);
    return () => clearInterval(t);
  }, [dep]);

  const start = async () => {
    setErr(undefined);
    const r = await fetch("/api/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from, usd, recipient, refundTo: refund.trim() }) });
    const j = await r.json();
    if (!r.ok) return setErr(j.error ?? "Couldn't get a deposit address.");
    setDep(j);
  };

  const label = ORIGINS.find((o) => o.id === from)?.label ?? from;
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

      {live && !dep && (
        <div className="mt-3 space-y-2">
          <input
            value={refund}
            onChange={(e) => setRefund(e.target.value)}
            placeholder="Your 0x… address on that chain (refunds go here)"
            className="glass h-11 w-full rounded-xl px-3 text-[13px] outline-none"
          />
          <button onClick={start} disabled={!/^0x[0-9a-fA-F]{40}$/.test(refund.trim())} className="h-10 w-full rounded-xl bg-white/10 text-[14px] disabled:opacity-40">
            Send it for real via NEAR Intents
          </button>
        </div>
      )}
      {dep && (
        <div className="mt-3 flex gap-3">
          <div className="rounded-xl bg-white p-2">
            <QRCodeSVG value={dep.depositAddress} size={96} />
          </div>
          <div className="min-w-0 text-[12px]">
            <p>
              Send exactly <b>{(Number(dep.amountIn) / 1e6).toFixed(2)} {label}</b> to
            </p>
            <p className="mono break-all text-[11px]">{dep.depositAddress}</p>
            <p className="mt-1 text-muted">
              Arrives as {(Number(dep.amountOut) / 1e6).toFixed(2)} USDC on NEAR mainnet · status: <b>{st?.status ?? "PENDING_DEPOSIT"}</b>
            </p>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-[12px] text-blocked">{err}</p>}
      <p className="mt-2 text-[11px] text-faint">
        {live
          ? "Live NEAR Intents (1Click) on mainnet: USDC lands at this allowance's account id on NEAR mainnet. The testnet allowance itself holds test dollars."
          : "Live mainnet price from NEAR Intents (1Click, dry quote). This demo allowance uses test dollars, so nothing is sent."}
      </p>
    </Card>
  );
}
