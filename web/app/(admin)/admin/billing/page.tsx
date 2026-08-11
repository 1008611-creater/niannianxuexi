"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  adjustBillingQuota,
  adjustBillingVoiceQuota,
  importBillingVouchers,
  listAdminBillingPlans,
  listBillingRedemptions,
  listBillingVouchers,
  voidBillingVoucher,
  type BillingPlan,
  type BillingRedemption,
  type BillingVoucher,
} from "@/lib/billing-api";

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

export default function AdminBillingPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [vouchers, setVouchers] = useState<BillingVoucher[]>([]);
  const [redemptions, setRedemptions] = useState<BillingRedemption[]>([]);
  const [planCode, setPlanCode] = useState("");
  const [codes, setCodes] = useState("");
  const [batchId, setBatchId] = useState("");
  const [adjustUser, setAdjustUser] = useState("");
  const [adjustPoints, setAdjustPoints] = useState("0");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustVoiceUser, setAdjustVoiceUser] = useState("");
  const [adjustVoiceMinutes, setAdjustVoiceMinutes] = useState("0");
  const [adjustVoiceReason, setAdjustVoiceReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [planData, voucherData, redemptionData] = await Promise.all([
        listAdminBillingPlans(),
        listBillingVouchers(),
        listBillingRedemptions(),
      ]);
      setPlans(planData.items);
      setVouchers(voucherData.items);
      setRedemptions(redemptionData.items);
      setPlanCode((current) => current || planData.items[0]?.code || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Failed to load billing administration"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchAuthStatus().then((status) => {
      if (!status?.authenticated) return router.replace("/login");
      if (status.role !== "admin") return router.replace("/");
      void load();
    });
  }, [load, router]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(event: React.FormEvent) {
    event.preventDefault();
    const values = codes.split(/\r?\n|,|\s+/).map((value) => value.trim()).filter(Boolean);
    if (!planCode || values.length === 0) return;
    await run(async () => {
      const result = await importBillingVouchers({ plan_code: planCode, codes: values, batch_id: batchId.trim() || undefined });
      setCodes("");
      setBatchId("");
      setMessage(t("Imported {{inserted}} cards; {{duplicates}} duplicates skipped.", result));
    });
  }

  async function handleAdjust(event: React.FormEvent) {
    event.preventDefault();
    if (!adjustUser.trim() || !adjustReason.trim()) return;
    await run(async () => {
      const result = await adjustBillingQuota({ user_id: adjustUser.trim(), delta_points: Number(adjustPoints) || 0, reason: adjustReason.trim() });
      setMessage(t("Quota updated. New balance: {{points}} points.", { points: result.text_balance_points }));
      setAdjustReason("");
    });
  }

  async function handleVoiceAdjust(event: React.FormEvent) {
    event.preventDefault();
    if (!adjustVoiceUser.trim() || !adjustVoiceReason.trim()) return;
    await run(async () => {
      const result = await adjustBillingVoiceQuota({
        user_id: adjustVoiceUser.trim(),
        delta_minutes: Number(adjustVoiceMinutes) || 0,
        reason: adjustVoiceReason.trim(),
      });
      setMessage(t("Voice quota updated. New balance: {{minutes}} minutes.", { minutes: result.voice_balance_minutes }));
      setAdjustVoiceReason("");
    });
  }

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[var(--background)] px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[calc(2rem+env(safe-area-inset-bottom,0px))] sm:py-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/admin/users" className="mb-5 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><ArrowLeft size={16} />{t("Back")}</Link>
        <div className="mb-7 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><ShieldCheck size={20} className="text-[var(--primary)]" /><h1 className="font-serif text-2xl font-semibold text-[var(--foreground)]">{t("Billing administration")}</h1></div><p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("Import LDXP cards and manage the server-side membership ledger.")}</p></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--card)] disabled:opacity-50 touch-manipulation sm:self-start"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />{t("Refresh")}</button></div>
        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {message && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">{message}</div>}
        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={handleImport} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"><h2 className="text-base font-semibold text-[var(--foreground)]">{t("Import membership cards")}</h2><label htmlFor="billing-plan" className="mt-4 block text-sm text-[var(--muted-foreground)]">{t("Plan")}</label><select id="billing-plan" value={planCode} onChange={(event) => setPlanCode(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]">{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {plan.code}</option>)}</select><label htmlFor="voucher-codes" className="mt-4 block text-sm text-[var(--muted-foreground)]">{t("Card codes")}</label><textarea id="voucher-codes" value={codes} onChange={(event) => setCodes(event.target.value)} rows={5} placeholder={t("One card code per line")} className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" /><label htmlFor="voucher-batch-id" className="sr-only">{t("Batch ID (optional)")}</label><input id="voucher-batch-id" value={batchId} onChange={(event) => setBatchId(event.target.value)} placeholder={t("Batch ID (optional)")} className="mt-3 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]" /><button type="submit" disabled={busy || !codes.trim()} className="mt-4 min-h-11 rounded-lg bg-[var(--primary)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 touch-manipulation">{t("Import cards")}</button><p className="mt-3 text-xs text-[var(--muted-foreground)]">{t("Only the card hash and last four characters are stored.")}</p></form>
          <form onSubmit={handleAdjust} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"><h2 className="text-base font-semibold text-[var(--foreground)]">{t("Adjust user quota")}</h2><label htmlFor="adjust-user-id" className="sr-only">{t("User ID")}</label><input id="adjust-user-id" value={adjustUser} onChange={(event) => setAdjustUser(event.target.value)} placeholder={t("User ID")} className="mt-4 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]" /><div className="mt-3 flex flex-col gap-3 sm:flex-row"><div className="w-full sm:w-32"><label htmlFor="adjust-points" className="sr-only">{t("Points")}</label><input id="adjust-points" type="number" value={adjustPoints} onChange={(event) => setAdjustPoints(event.target.value)} placeholder={t("Points")} className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]" /></div><div className="min-w-0 flex-1"><label htmlFor="adjust-reason" className="sr-only">{t("Reason")}</label><input id="adjust-reason" value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} placeholder={t("Reason")} className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]" /></div></div><button type="submit" disabled={busy || !adjustUser.trim() || !adjustReason.trim()} className="mt-4 min-h-11 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--background)] disabled:opacity-50 touch-manipulation">{t("Apply quota adjustment")}</button><p className="mt-3 text-xs text-[var(--muted-foreground)]">{t("Use a negative number to deduct points. Every adjustment is audited.")}</p></form>
          <form onSubmit={handleVoiceAdjust} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"><h2 className="text-base font-semibold text-[var(--foreground)]">{t("Adjust realtime voice quota")}</h2><label htmlFor="adjust-voice-user-id" className="sr-only">{t("User ID")}</label><input id="adjust-voice-user-id" value={adjustVoiceUser} onChange={(event) => setAdjustVoiceUser(event.target.value)} placeholder={t("User ID")} className="mt-4 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]" /><div className="mt-3 flex flex-col gap-3 sm:flex-row"><div className="w-full sm:w-32"><label htmlFor="adjust-voice-minutes" className="sr-only">{t("Minutes")}</label><input id="adjust-voice-minutes" type="number" value={adjustVoiceMinutes} onChange={(event) => setAdjustVoiceMinutes(event.target.value)} placeholder={t("Minutes")} className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]" /></div><div className="min-w-0 flex-1"><label htmlFor="adjust-voice-reason" className="sr-only">{t("Reason")}</label><input id="adjust-voice-reason" value={adjustVoiceReason} onChange={(event) => setAdjustVoiceReason(event.target.value)} placeholder={t("Reason")} className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]" /></div></div><button type="submit" disabled={busy || !adjustVoiceUser.trim() || !adjustVoiceReason.trim()} className="mt-4 min-h-11 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--background)] disabled:opacity-50 touch-manipulation">{t("Apply voice quota adjustment")}</button><p className="mt-3 text-xs text-[var(--muted-foreground)]">{t("Use a negative number to deduct minutes. Every adjustment is audited.")}</p></form>
        </div>
        <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"><h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">{t("Card inventory")}</h2><div className="overflow-x-auto overscroll-x-contain"><table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b border-[var(--border)] text-xs text-[var(--muted-foreground)]"><tr><th className="px-2 py-2">{t("Card")}</th><th className="px-2 py-2">{t("Plan")}</th><th className="px-2 py-2">{t("Status")}</th><th className="px-2 py-2">{t("Imported")}</th><th className="px-2 py-2 text-right">{t("Actions")}</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{vouchers.map((voucher) => <tr key={voucher.id}><td className="px-2 py-2 font-mono text-xs">****{voucher.last4}</td><td className="px-2 py-2">{voucher.plan_name}</td><td className="px-2 py-2">{voucher.status}</td><td className="px-2 py-2 text-[var(--muted-foreground)]">{formatDate(voucher.imported_at)}</td><td className="px-2 py-2 text-right">{voucher.status === "available" && <button type="button" disabled={busy} onClick={() => void run(async () => { await voidBillingVoucher(voucher.id, t("Voided by administrator")); setMessage(t("Card voided")); })} className="inline-flex min-h-11 items-center px-3 text-xs text-red-600 hover:underline dark:text-red-400 touch-manipulation">{t("Void")}</button>}</td></tr>)}</tbody></table></div>{!vouchers.length && !loading && <p className="py-6 text-sm text-[var(--muted-foreground)]">{t("No cards imported yet")}</p>}</section>
        <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"><h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">{t("Redemption records")}</h2><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b border-[var(--border)] text-xs text-[var(--muted-foreground)]"><tr><th className="px-2 py-2">{t("User ID")}</th><th className="px-2 py-2">{t("Plan")}</th><th className="px-2 py-2">{t("Redeemed")}</th><th className="px-2 py-2">{t("Request ID")}</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{redemptions.map((item) => <tr key={item.id}><td className="px-2 py-2 font-mono text-xs">{item.user_id}</td><td className="px-2 py-2">{item.plan_name}</td><td className="px-2 py-2 text-[var(--muted-foreground)]">{formatDate(item.redeemed_at)}</td><td className="max-w-[260px] truncate px-2 py-2 font-mono text-xs text-[var(--muted-foreground)]">{item.request_id}</td></tr>)}</tbody></table></div>{!redemptions.length && !loading && <p className="py-6 text-sm text-[var(--muted-foreground)]">{t("No redemptions yet")}</p>}</section>
      </div>
    </div>
  );
}
