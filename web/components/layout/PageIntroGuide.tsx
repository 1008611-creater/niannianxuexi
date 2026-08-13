"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, CircleHelp } from "lucide-react";
import Modal from "@/components/common/Modal";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";
import { useAppShell } from "@/context/AppShellContext";
import { getPageIntro } from "@/lib/page-intros";

export const OPEN_PAGE_INTRO_EVENT = "niannian:open-page-intro";
const INTRO_VERSION = "2";

function storageKey(id: string): string {
  return `niannian.page-intro.${id}`;
}

export function openCurrentPageIntro(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_PAGE_INTRO_EVENT));
}

export default function PageIntroGuide() {
  const pathname = usePathname();
  const { language } = useAppShell();
  const intro = getPageIntro(pathname);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!intro) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(storageKey(intro.id)) === INTRO_VERSION;
    } catch {
      // A blocked localStorage should not prevent the page from being usable.
    }
    const frame = window.requestAnimationFrame(() => setOpen(!seen));
    return () => window.cancelAnimationFrame(frame);
  }, [intro]);

  useEffect(() => {
    const handleOpen = () => {
      if (intro) setOpen(true);
    };
    window.addEventListener(OPEN_PAGE_INTRO_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_PAGE_INTRO_EVENT, handleOpen);
  }, [intro]);

  if (!intro) return null;
  const content = intro.content[language];

  const close = () => {
    try {
      window.localStorage.setItem(storageKey(intro.id), INTRO_VERSION);
    } catch {
      // Dismissal still works for the current visit without localStorage.
    }
    setOpen(false);
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title={content.title}
      titleIcon={<CircleHelp size={19} strokeWidth={1.8} />}
      width="sm"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LanguageSwitcher />
          <button
            type="button"
            data-autofocus
            onClick={close}
            className="h-9 rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            {content.confirmLabel}
          </button>
        </div>
      }
    >
      <div className="space-y-5 p-5">
        <p className="text-sm leading-6 text-[var(--foreground)]/85">{content.summary}</p>
        <div className="space-y-3">
          {content.actions.map((action) => (
            <div key={action} className="flex items-start gap-3 text-sm text-[var(--foreground)]">
              <CheckCircle2
                size={17}
                strokeWidth={1.8}
                className="mt-0.5 shrink-0 text-[var(--primary)]"
              />
              <span className="leading-5">{action}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
