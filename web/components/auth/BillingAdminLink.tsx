"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuthStatus } from "@/hooks/useAuthStatus";

export function BillingAdminLink({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { enabled, isAdmin } = useAuthStatus();
  if (!enabled || !isAdmin) return null;
  const active = pathname.startsWith("/admin/billing");
  const className = active
    ? "bg-[var(--primary)]/10 text-[var(--primary)]"
    : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]";

  if (collapsed) {
    return (
      <Link
        href="/admin/billing"
        className={`rounded-lg p-2 transition-colors ${className}`}
        aria-label={t("Billing administration")}
        title={t("Billing administration")}
      >
        <ClipboardList size={16} strokeWidth={1.5} />
      </Link>
    );
  }
  return (
    <Link
      href="/admin/billing"
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${className}`}
    >
      <ClipboardList size={16} strokeWidth={1.5} />
      <span>{t("Billing administration")}</span>
    </Link>
  );
}
