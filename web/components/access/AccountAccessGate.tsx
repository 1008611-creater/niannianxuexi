"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { fetchAuthStatus, type AuthStatus } from "@/lib/auth";

export default function AccountAccessGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await fetchAuthStatus();
    setStatus(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  if (loading || !status || !status.enabled || status.role === "admin") {
    return <>{children}</>;
  }
  if (status.access_status === "active") {
    return <>{children}</>;
  }

  // The billing page is the activation path for a newly registered account.
  // Keep it reachable while the rest of the product remains locked.
  if (status.access_status === "pending" && pathname.startsWith("/billing")) {
    return <>{children}</>;
  }

  const disabled = status.access_status === "disabled";
  return (
    <div className="flex h-full min-h-[60vh] w-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--secondary)]/40 px-8 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--background)] text-[var(--muted-foreground)]">
          <Lock size={20} strokeWidth={1.8} />
        </div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">
          {disabled ? t("Account disabled") : t("Account not activated")}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
          {disabled
            ? t("Contact the administrator to restore access.")
            : t("Complete payment or contact the administrator to activate this account.")}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--background)]"
        >
          <RefreshCw size={14} />
          {t("Check again")}
        </button>
        {!disabled && (
          <Link
            href="/billing"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
          >
            {t("Redeem a membership card")}
          </Link>
        )}
      </div>
    </div>
  );
}
