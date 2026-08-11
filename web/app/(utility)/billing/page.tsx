"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeDollarSign, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getBillingLedger,
  getBillingSnapshot,
  listBillingPlans,
  redeemBillingVoucher,
  type BillingLedgerItem,
  type BillingPlan,
  type BillingSnapshot,
  type BillingUsageItem,
} from "@/lib/billing-api";

function formatDate(value: string | null, language: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString(language.startsWith("zh") ? "zh-CN" : "en-US");
}

function price(fen: number, language: string): string {
  return new Intl.NumberFormat(language.startsWith("zh") ? "zh-CN" : "en-US", {
    style: "currency",
    currency: "CNY",
  }).format(fen / 100);
}

export default function BillingPage() {
  const { t, i18n } = useTranslation();
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [ledger, setLedger] = useState<BillingLedgerItem[]>([]);
  const [voiceLedger, setVoiceLedger] = useState<Array<{ id: string; delta_seconds: number; created_at: string }>>([]);
  const [usage, setUsage] = useState<BillingUsageItem[]>([]);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [account, accountLedger, publicPlans] = await Promise.all([
        getBillingSnapshot(),
        getBillingLedger(),
        listBillingPlans(),
      ]);
      setSnapshot(account);
      setLedger(accountLedger.items);
      setVoiceLedger(accountLedger.voice_items);
      setUsage(accountLedger.usage);
      setPlans(publicPlans.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Failed to load billing"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setMessage("");
    setError("");
    try {
      const next = await redeemBillingVoucher(trimmed);
      setSnapshot(next);
      setCode("");
      setMessage(t("Membership card redeemed"));
      const accountLedger = await getBillingLedger();
      setLedger(accountLedger.items);
      setVoiceLedger(accountLedger.voice_items);
      setUsage(accountLedger.usage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Failed to redeem membership card"));
    } finally {
      setSubmitting(false);
    }
  }

  const language = i18n.language || "zh-CN";
  const expiry = snapshot?.membership?.expires_at;
  const activePlan = snapshot?.plan;

  return (
    <div className="h-full overflow-y-auto bg-[var(--background)] px-4 py-8 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-5xl">
        <Link href="/home" className="mb-5 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeft size={16} />
          {t("Back")}
        </Link>
        <div className="mb-7 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-semibold text-[var(--foreground)]">{t("Membership and quota")}</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("Redeem a card to unlock study features and server-side text quota.")}</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--card)] disabled:opacity-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {t("Refresh")}
          </button>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {message && <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={16} />{message}</div>}

        <section className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]"><BadgeDollarSign size={18} />{t("Current access")}</div>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-xl font-semibold text-[var(--foreground)]">{activePlan?.name ?? t("No membership yet")}</div>
                <div className="mt-1 text-sm text-[var(--muted-foreground)]">{expiry ? t("Valid until {{date}}", { date: formatDate(expiry, language) }) : snapshot?.membership ? t("Permanent membership") : t("Redeem a card to activate access")}</div>
              </div>
              <div className="flex flex-wrap gap-5 text-right"><div><div className="text-3xl font-semibold text-[var(--foreground)]">{snapshot?.text_balance_points?.toLocaleString(language) ?? "-"}</div><div className="text-xs text-[var(--muted-foreground)]">{t("text quota points remaining")}</div></div><div><div className="text-3xl font-semibold text-[var(--foreground)]">{snapshot?.voice_balance_minutes?.toLocaleString(language) ?? "-"}</div><div className="text-xs text-[var(--muted-foreground)]">{t("voice quota minutes remaining")}</div></div></div>
            </div>
          </div>
          <form onSubmit={redeem} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
            <label htmlFor="membership-code" className="text-sm font-medium text-[var(--foreground)]">{t("Redeem membership card")}</label>
            <div className="mt-3 flex gap-2">
              <input id="membership-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder={t("Enter card code")} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
              <button type="submit" disabled={!code.trim() || submitting} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? t("Redeeming…") : t("Redeem")}</button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[var(--muted-foreground)]">{t("One card can be redeemed only once. LDXP handles payment and card delivery; DeepTutor applies the membership here.")}</p>
          </form>
        </section>

        <section className="mt-6">
          <h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">{t("Available plans")}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.code} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="flex items-start justify-between gap-2"><h3 className="font-medium text-[var(--foreground)]">{plan.name}</h3><span className="shrink-0 text-sm font-semibold text-[var(--foreground)]">{price(plan.price_fen, language)}</span></div>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">{plan.description}</p><p className="mt-2 text-xs text-[var(--muted-foreground)]">{t("Includes {{minutes}} realtime voice minutes", { minutes: Math.round(plan.voice_quota_seconds / 60).toLocaleString(language) })}</p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-[var(--muted-foreground)]">{plan.code}</span>
                  {plan.purchase_url && <a href={plan.purchase_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white hover:opacity-90" title={t("Open payment page")}>
                    <ExternalLink size={13} />
                    {t("Buy and get card")}
                  </a>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">{t("Quota ledger")}</h2>
            {ledger.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">{t("No quota records yet")}</p> : <div className="space-y-2">{ledger.slice(0, 8).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-b border-[var(--border)]/70 pb-2 text-sm last:border-0"><span className="text-[var(--muted-foreground)]">{item.reason}</span><span className="text-[var(--foreground)]">{item.delta_k_tokens >= 0 ? "+" : ""}{(item.delta_k_tokens / 10).toFixed(1)} {t("points")}</span></div>)}</div>}
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">{t("Realtime voice ledger")}</h2>
            {voiceLedger.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">{t("No realtime voice records yet")}</p> : <div className="space-y-2">{voiceLedger.slice(0, 8).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-b border-[var(--border)]/70 pb-2 text-sm last:border-0"><span className="text-[var(--muted-foreground)]">{formatDate(item.created_at, language)}</span><span className="text-[var(--foreground)]">{item.delta_seconds >= 0 ? "+" : ""}{(item.delta_seconds / 60).toFixed(1)} {t("minutes")}</span></div>)}</div>}
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">{t("Recent usage")}</h2>
            {usage.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">{t("No usage records yet")}</p> : <div className="space-y-2">{usage.slice(0, 8).map((item) => <div key={item.request_id} className="flex items-center justify-between gap-3 border-b border-[var(--border)]/70 pb-2 text-sm last:border-0"><span className="truncate text-[var(--muted-foreground)]">{item.capability}</span><span className="shrink-0 text-[var(--foreground)]">-{(item.charged_k_tokens / 10).toFixed(1)} {t("points")}</span></div>)}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
