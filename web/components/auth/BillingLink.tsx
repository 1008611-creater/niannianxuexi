"use client";

import Link from "next/link";
import { BadgeDollarSign } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";

export function BillingLink({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const active = pathname.startsWith("/billing");
  const className = active
    ? "bg-[var(--primary)]/10 text-[var(--primary)]"
    : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]";

  if (collapsed) {
    return (
      <Link
        href="/billing"
        className={`rounded-lg p-2 transition-colors ${className}`}
        aria-label={t("Membership and quota")}
        title={t("Membership and quota")}
      >
        <BadgeDollarSign size={16} strokeWidth={1.5} />
      </Link>
    );
  }

  return (
    <Link
      href="/billing"
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${className}`}
    >
      <BadgeDollarSign size={16} strokeWidth={1.5} />
      <span>{t("Membership and quota")}</span>
    </Link>
  );
}
