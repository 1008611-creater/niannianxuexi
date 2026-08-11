"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

// Student learning paths own their compact single-column surface. They must
// not inherit the generic learning-space hub or its wide document padding.
const FULL_BLEED = ["/space/learning"];

function isFullBleed(pathname: string): boolean {
  return FULL_BLEED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Hub-and-spoke: the dashboard at `/space` is the only navigator. Once inside a
// section we don't re-list every sibling on a rail — a single "back to the hub"
// link keeps the section focused and sends you to the overview to switch.
function BackToHub() {
  const { t } = useTranslation();
  return (
    <Link
      href="/space"
      className="group inline-flex items-center gap-1.5 text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
    >
      <ArrowLeft
        size={15}
        strokeWidth={1.8}
        className="transition-transform group-hover:-translate-x-0.5"
      />
      {t("Learning Space")}
    </Link>
  );
}

export default function SpaceMain({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname() ?? "";
  const isDashboard = pathname === "/space";

  if (isFullBleed(pathname)) {
    return (
      <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y bg-[var(--background)] [-webkit-overflow-scrolling:touch]">
        {children}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y bg-[var(--background)] [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]">
      <div className="mx-auto min-h-full max-w-5xl px-8 py-8 pb-[calc(3rem+env(safe-area-inset-bottom,0px))]">
        {!isDashboard && (
          <div className="mb-5">
            <BackToHub />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
