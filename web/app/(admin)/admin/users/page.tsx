"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  listUsers,
  deleteUser,
  setUserRole,
  setUserAccess,
  createUser,
  type UserRecord,
} from "@/lib/admin-api";
import { GrantEditor } from "@/features/multi-user/components/GrantEditor";
import { UserAvatar } from "@/components/UserAvatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { filterUsersByQuery } from "@/lib/admin-users";
import {
  Search,
  Shield,
  ShieldCheck,
  ShieldOff,
  Trash2,
  RefreshCw,
  ArrowLeft,
  SlidersHorizontal,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { formatDate as formatLocaleDate, type Language } from "@/lib/datetime";

// Delegates to the shared locale mapping so a new UI language only has to be
// taught to lib/datetime; the guard here is for the empty or unparseable
// created_at that Intl would throw on.
function formatDate(iso: string, lang: Language): string {
  if (!iso) return "—";
  try {
    return formatLocaleDate(new Date(iso), lang);
  } catch {
    return "—";
  }
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language?.startsWith("zh") ? "zh" : "en";
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<{
    kind: "delete" | "promote" | "demote" | "activate" | "deactivate";
    user: UserRecord;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listUsers();
      setUsers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load users"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (!status?.authenticated) {
        router.replace("/login");
        return;
      }
      if (status.role !== "admin") {
        router.replace("/");
        return;
      }
      setCurrentUser(status.username ?? null);
      void load();
    });
  }, [router, load]);

  function openCreateDialog() {
    setCreateUsername("");
    setCreatePassword("");
    setCreateError("");
    setShowCreateDialog(true);
  }

  function closeCreateDialog() {
    if (createSubmitting) return;
    setShowCreateDialog(false);
  }

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (createSubmitting) return;
    setCreateError("");
    const username = createUsername.trim();
    if (!username) {
      setCreateError(t("Username is required."));
      return;
    }
    if (createPassword.length < 8) {
      setCreateError(t("Password must be at least 8 characters."));
      return;
    }
    setCreateSubmitting(true);
    try {
      await createUser(username, createPassword);
      setShowCreateDialog(false);
      await load();
    } catch (e) {
      setCreateError(
        e instanceof Error ? e.message : t("Failed to create user"),
      );
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleConfirmAction() {
    if (!confirmTarget || confirmBusy) return;
    const { kind, user } = confirmTarget;
    setConfirmBusy(true);
    setActionError("");
    try {
      if (kind === "delete") {
        await deleteUser(user.username);
        setUsers((prev) => prev.filter((u) => u.username !== user.username));
      } else if (kind === "promote" || kind === "demote") {
        const newRole = kind === "promote" ? "admin" : "user";
        await setUserRole(user.username, newRole);
        setUsers((prev) =>
          prev.map((u) =>
            u.username === user.username ? { ...u, role: newRole } : u,
          ),
        );
        if (newRole === "admin") {
          setExpandedUserId((current) =>
            current === user.id ? null : current,
          );
        }
      } else {
        const nextAccess = kind === "activate" ? "active" : "disabled";
        await setUserAccess(user.username, nextAccess);
        setUsers((prev) =>
          prev.map((u) =>
            u.username === user.username
              ? {
                  ...u,
                  access_status: nextAccess,
                  disabled: nextAccess === "disabled",
                  access_source: nextAccess === "active" ? "admin" : null,
                  paid_until: null,
                }
              : u,
          ),
        );
      }
      setConfirmTarget(null);
    } catch (e) {
      setConfirmTarget(null);
      setActionError(
        e instanceof Error
          ? e.message
          : confirmTarget.kind === "delete"
            ? t("Failed to delete user")
            : confirmTarget.kind === "activate" ||
                confirmTarget.kind === "deactivate"
              ? t("Failed to update account access")
              : t("Failed to update role"),
      );
    } finally {
      setConfirmBusy(false);
    }
  }

  useEffect(() => {
    if (!expandedUserId) return;
    const expanded = users.find((user) => user.id === expandedUserId);
    if (!expanded || expanded.role === "admin") {
      setExpandedUserId(null);
    }
  }, [expandedUserId, users]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = filterUsersByQuery(users, query);

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[var(--background)] px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[calc(2rem+env(safe-area-inset-bottom,0px))] sm:py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft size={16} />
            {t("Back")}
          </Link>
          <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
                {t("User Management")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {t("Manage registered accounts")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              <button
                type="button"
                onClick={openCreateDialog}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm
                           border border-[var(--border)] text-[var(--foreground)]
                           hover:bg-[var(--card)] transition-colors touch-manipulation sm:min-h-0 sm:py-1.5"
              >
                <UserPlus size={14} />
                {t("Add user")}
              </button>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm
                           border border-[var(--border)] text-[var(--muted-foreground)]
                           hover:text-[var(--foreground)] hover:bg-[var(--card)]
                           disabled:opacity-50 transition-colors touch-manipulation sm:min-h-0 sm:py-1.5"
              >
                <RefreshCw
                  size={14}
                  className={loading ? "animate-spin" : ""}
                />
                {t("Refresh")}
              </button>
            </div>
          </div>
        </div>

        {actionError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {actionError}
          </div>
        )}

        {!loading && !error && users.length > 0 && (
          <div className="mb-4 flex items-center gap-3">
            <div className="relative flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search users…")}
                aria-label={t("Search users")}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2 pl-9 pr-3 text-sm
                           text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/70
                           outline-none focus:border-[var(--ring)] transition-colors"
              />
            </div>
            <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
              {normalizedQuery
                ? t("{{filtered}} of {{total}}", {
                    filtered: filteredUsers.length,
                    total: users.length,
                  })
                : t(users.length === 1 ? "{{count}} user" : "{{count}} users", {
                    count: users.length,
                  })}
            </span>
          </div>
        )}

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
          {loading ? (
            <div className="divide-y divide-[var(--border)]" aria-hidden>
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="flex animate-pulse items-center gap-3 px-5 py-4"
                >
                  <div className="h-8 w-8 rounded-full bg-[var(--muted)]/60" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-36 rounded bg-[var(--muted)]/60" />
                    <div className="h-2.5 w-24 rounded bg-[var(--muted)]/40" />
                  </div>
                  <div className="h-5 w-16 rounded-full bg-[var(--muted)]/40" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-red-500 text-sm">
              {error}
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <Users
                size={28}
                strokeWidth={1.5}
                className="text-[var(--muted-foreground)]/50"
              />
              <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {t("No users yet")}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t("Accounts you create will appear here.")}
              </p>
              <button
                onClick={openCreateDialog}
                className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm
                           border border-[var(--border)] text-[var(--foreground)]
                           hover:bg-[var(--background)]/60 transition-colors touch-manipulation sm:min-h-0 sm:py-1.5"
              >
                <UserPlus size={14} />
                {t("Add user")}
              </button>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <Search
                size={28}
                strokeWidth={1.5}
                className="text-[var(--muted-foreground)]/50"
              />
              <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {t("No users match “{{query}}”", { query: query.trim() })}
              </p>
              <button
                onClick={() => setQuery("")}
                className="mt-4 rounded-lg px-3 py-1.5 text-sm border border-[var(--border)]
                           text-[var(--muted-foreground)] hover:text-[var(--foreground)]
                           hover:bg-[var(--background)]/60 transition-colors"
              >
                {t("Clear search")}
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
                  <th className="px-5 py-3 font-medium">{t("Username")}</th>
                  <th className="hidden px-5 py-3 font-medium sm:table-cell">{t("Role")}</th>
                  <th className="hidden px-5 py-3 font-medium sm:table-cell">{t("Access")}</th>
                  <th className="hidden px-5 py-3 font-medium sm:table-cell">{t("Joined")}</th>
                  <th className="px-3 py-3 font-medium text-right sm:px-5">
                    {t("Actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredUsers.map((user) => {
                  const isSelf = user.username === currentUser;
                  const isAdmin = user.role === "admin";
                  const canManageAssignments = !isAdmin && Boolean(user.id);
                  return (
                    <Fragment key={user.username}>
                      <tr className="group hover:bg-[var(--background)]/50 transition-colors">
                        <td className="min-w-0 px-3 py-3 sm:px-5">
                          <div className="flex items-center gap-3">
                            <UserAvatar
                              username={user.username}
                              userId={user.id}
                              avatar={user.avatar}
                              role={user.role}
                              size={32}
                            />
                            <span className="min-w-0 truncate font-medium text-[var(--foreground)]">
                              {user.username}
                              {isSelf && (
                                <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                                  {t("(you)")}
                                </span>
                              )}
                            </span>
                          </div>
                          <span className="mt-1 block pl-11 text-xs text-[var(--muted-foreground)] sm:hidden">
                            {isAdmin ? t("Admin") : t("User")} · {user.access_status === "active" ? t("Active") : user.access_status === "disabled" ? t("Disabled") : t("Pending")}
                          </span>
                        </td>
                        <td className="hidden px-5 py-3 sm:table-cell">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium
                            ${
                              isAdmin
                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                : "bg-[var(--muted)]/50 text-[var(--muted-foreground)]"
                            }`}
                          >
                            {isAdmin && (
                              <ShieldCheck size={11} strokeWidth={2} />
                            )}
                            {isAdmin ? t("Admin") : t("User")}
                          </span>
                        </td>
                        <td className="hidden px-5 py-3 sm:table-cell">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              user.access_status === "active"
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : user.access_status === "disabled"
                                  ? "bg-red-500/15 text-red-600 dark:text-red-400"
                                  : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                            }`}
                          >
                            {isAdmin
                              ? t("Always active")
                              : user.access_status === "active"
                                ? t("Active")
                                : user.access_status === "disabled"
                                  ? t("Disabled")
                                  : t("Pending")}
                          </span>
                        </td>
                        <td className="hidden px-5 py-3.5 text-[var(--muted-foreground)] sm:table-cell">
                          {formatDate(user.created_at, lang)}
                        </td>
                        <td className="px-2 py-3.5 sm:px-5">
                          <div className="flex items-center justify-end gap-0.5 sm:gap-1.5">
                            {!isAdmin && (
                              <button
                                onClick={() =>
                                  setConfirmTarget({
                                    kind:
                                      user.access_status === "active"
                                        ? "deactivate"
                                        : "activate",
                                    user,
                                  })
                                }
                                disabled={isSelf}
                                title={
                                  isSelf
                                    ? t("Cannot change your own access")
                                    : user.access_status === "active"
                                      ? t("Disable access")
                                      : t("Activate access")
                                }
                                className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition-colors touch-manipulation disabled:cursor-not-allowed disabled:opacity-30 sm:min-h-0 sm:px-2 sm:py-1 ${
                                  user.access_status === "active"
                                    ? "text-red-600 hover:bg-red-500/10 dark:text-red-400"
                                    : "text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                                }`}
                              >
                                {user.access_status === "active"
                                  ? t("Disable")
                                  : t("Activate")}
                              </button>
                            )}
                            {canManageAssignments && (
                              <button
                                onClick={() =>
                                  setExpandedUserId((current) =>
                                    current === user.id ? null : user.id,
                                  )
                                }
                                title={t("Manage assignments")}
                                 className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-1.5 text-[var(--muted-foreground)]
                                          hover:bg-[var(--background)] hover:text-[var(--foreground)]
                                          transition-colors touch-manipulation sm:min-h-0 sm:min-w-0"
                              >
                                <SlidersHorizontal size={15} />
                              </button>
                            )}
                            <button
                              onClick={() =>
                                setConfirmTarget({
                                  kind: isAdmin ? "demote" : "promote",
                                  user,
                                })
                              }
                              disabled={isSelf}
                              title={
                                isSelf
                                  ? t("Cannot change your own role")
                                  : user.role === "admin"
                                    ? t("Demote to user")
                                    : t("Promote to admin")
                              }
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-1.5 text-[var(--muted-foreground)]
                                       hover:bg-[var(--background)] hover:text-[var(--foreground)]
                                       disabled:opacity-30 disabled:cursor-not-allowed transition-colors touch-manipulation sm:min-h-0 sm:min-w-0"
                            >
                              {user.role === "admin" ? (
                                <ShieldOff size={15} />
                              ) : (
                                <Shield size={15} />
                              )}
                            </button>
                            <button
                              onClick={() =>
                                setConfirmTarget({ kind: "delete", user })
                              }
                              disabled={isSelf}
                              title={
                                isSelf
                                  ? t("Cannot delete your own account")
                                  : t("Delete {{username}}", {
                                      username: user.username,
                                    })
                              }
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-1.5 text-[var(--muted-foreground)]
                                       hover:bg-red-500/10 hover:text-red-500
                                       disabled:opacity-30 disabled:cursor-not-allowed transition-colors touch-manipulation sm:min-h-0 sm:min-w-0"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {canManageAssignments && expandedUserId === user.id && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <GrantEditor key={user.id} userId={user.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-[var(--muted-foreground)]">
          {t("DeepTutor Admin · User Management")}
        </p>
      </div>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={
          confirmTarget?.kind === "delete"
            ? t("Delete user")
            : confirmTarget?.kind === "promote"
              ? t("Promote to admin")
              : confirmTarget?.kind === "demote"
                ? t("Demote to user")
                : confirmTarget?.kind === "activate"
                  ? t("Activate account")
                  : t("Disable account")
        }
        tone={confirmTarget?.kind === "delete" ? "danger" : "default"}
        confirmLabel={
          confirmTarget?.kind === "delete"
            ? t("Delete user")
            : confirmTarget?.kind === "promote"
              ? t("Promote")
              : confirmTarget?.kind === "demote"
                ? t("Demote")
                : confirmTarget?.kind === "activate"
                  ? t("Activate")
                  : t("Disable")
        }
        busyLabel={
          confirmTarget?.kind === "delete"
            ? t("Deleting…")
            : confirmTarget?.kind === "promote"
              ? t("Promoting…")
              : confirmTarget?.kind === "demote"
                ? t("Demoting…")
                : confirmTarget?.kind === "activate"
                  ? t("Activating…")
                  : t("Disabling…")
        }
        busy={confirmBusy}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmTarget(null)}
      >
        {confirmTarget && (
          <>
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)]/50 px-3 py-2.5">
              <UserAvatar
                username={confirmTarget.user.username}
                userId={confirmTarget.user.id}
                avatar={confirmTarget.user.avatar}
                role={confirmTarget.user.role}
                size={32}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {confirmTarget.user.username}
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {t("{{role}} · joined {{date}}", {
                    role:
                      confirmTarget.user.role === "admin"
                        ? t("Admin")
                        : t("User"),
                    date: formatDate(confirmTarget.user.created_at, lang),
                  })}
                </p>
              </div>
            </div>
            <p className="mt-3">
              {confirmTarget.kind === "delete"
                ? t(
                    "This permanently removes the account and its assignments. This cannot be undone.",
                  )
                : confirmTarget.kind === "promote"
                  ? t(
                      "Admins can manage users and assignments, and work in the shared main workspace.",
                    )
                  : confirmTarget.kind === "demote"
                    ? t(
                      "They will lose access to the admin area and switch to their own assigned workspace.",
                    )
                    : confirmTarget.kind === "activate"
                      ? t("This account will be allowed to use the product.")
                      : t("This account will immediately lose access to the product.")}
            </p>
          </>
        )}
      </ConfirmDialog>

      {showCreateDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4"
          role="dialog"
          aria-modal="true"
          onClick={closeCreateDialog}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateSubmit}
            className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                {t("Add user")}
              </h2>
              <button
                type="button"
                onClick={closeCreateDialog}
                disabled={createSubmitting}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40 touch-manipulation sm:min-h-0 sm:min-w-0"
                aria-label={t("Close")}
              >
                <X size={16} />
              </button>
            </div>

            <label className="mb-3 block text-xs text-[var(--muted-foreground)]">
              {t("Username (or email)")}
              <input
                type="text"
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                disabled={createSubmitting}
                autoComplete="off"
                autoFocus
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
              />
            </label>

            <label className="mb-4 block text-xs text-[var(--muted-foreground)]">
              {t("Password (≥ 8 chars)")}
              <input
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                disabled={createSubmitting}
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
              />
            </label>

            {createError && (
              <p className="mb-3 text-xs text-red-500">{createError}</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateDialog}
                disabled={createSubmitting}
                className="min-h-11 rounded-lg px-3 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40 touch-manipulation"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={createSubmitting}
                className="min-h-11 rounded-lg bg-[var(--foreground)] px-3 text-sm font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40 touch-manipulation"
              >
                {createSubmitting ? t("Creating…") : t("Create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
