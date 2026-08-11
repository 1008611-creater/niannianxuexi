import { apiFetch, apiUrl } from "@/lib/api";

export interface BillingPlan {
  code: string;
  name: string;
  price_fen: number;
  membership_type: string;
  duration_days: number | null;
  quota_k_tokens: number;
  voice_quota_seconds: number;
  description: string;
  enabled: number;
  purchase_url?: string | null;
}

export interface BillingMembership {
  id: string;
  plan_code: string;
  membership_type: string;
  starts_at: string;
  expires_at: string | null;
  source: string;
  status: string;
}

export interface BillingSnapshot {
  user_id: string;
  username?: string;
  membership: BillingMembership | null;
  plan: BillingPlan | null;
  text_balance_k_tokens: number;
  text_balance_points: number;
  voice_balance_seconds: number;
  voice_balance_minutes: number;
  media_balance: number;
  is_admin?: boolean;
  phase?: string;
  payment_provider?: string;
}

export interface BillingLedgerItem {
  id: string;
  delta_k_tokens: number;
  balance_after_k_tokens: number;
  reason: string;
  reference_id: string;
  created_at: string;
}

export interface BillingUsageItem {
  request_id: string;
  turn_id: string;
  capability: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  charged_k_tokens: number;
  status: string;
  created_at: string;
}

export interface BillingVoucher {
  id: string;
  last4: string;
  plan_code: string;
  plan_name: string;
  batch_id: string;
  status: string;
  imported_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
}

export interface BillingRedemption {
  id: string;
  user_id: string;
  plan_code: string;
  plan_name: string;
  redeemed_at: string;
  request_id: string;
}

async function readError(response: Response, fallback: string): Promise<Error> {
  const data = await response.json().catch(() => ({}));
  return new Error(typeof data?.detail === "string" ? data.detail : fallback);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(apiUrl(path), init);
  if (!response.ok) throw await readError(response, "Request failed");
  return (await response.json()) as T;
}

export function getBillingSnapshot(): Promise<BillingSnapshot> {
  return request<BillingSnapshot>("/api/v1/billing/me");
}

export function getBillingLedger(): Promise<{
  items: BillingLedgerItem[];
  voice_items: BillingVoiceLedgerItem[];
  usage: BillingUsageItem[];
}> {
  return request("/api/v1/billing/ledger");
}

export interface BillingVoiceLedgerItem {
  id: string;
  delta_seconds: number;
  balance_after_seconds: number;
  reason: string;
  reference_id: string;
  created_at: string;
}

export function listBillingPlans(): Promise<{ items: BillingPlan[] }> {
  return request("/api/v1/billing/plans");
}

export function redeemBillingVoucher(code: string): Promise<BillingSnapshot> {
  return request("/api/v1/billing/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export function listAdminBillingPlans(): Promise<{ items: BillingPlan[] }> {
  return request("/api/v1/billing/admin/plans");
}

export function importBillingVouchers(payload: {
  plan_code: string;
  codes: string[];
  batch_id?: string;
}): Promise<{ inserted: number; duplicates: number; batch_id: string }> {
  return request("/api/v1/billing/admin/vouchers/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function listBillingVouchers(): Promise<{ items: BillingVoucher[] }> {
  return request("/api/v1/billing/admin/vouchers");
}

export function voidBillingVoucher(
  voucherId: string,
  reason: string,
): Promise<{ ok: boolean }> {
  return request(`/api/v1/billing/admin/vouchers/${encodeURIComponent(voucherId)}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export function listBillingRedemptions(): Promise<{ items: BillingRedemption[] }> {
  return request("/api/v1/billing/admin/redemptions");
}

export function adjustBillingQuota(payload: {
  user_id: string;
  delta_points: number;
  reason: string;
}): Promise<{ text_balance_points: number }> {
  return request("/api/v1/billing/admin/quota/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function adjustBillingVoiceQuota(payload: {
  user_id: string;
  delta_minutes: number;
  reason: string;
}): Promise<{ voice_balance_seconds: number; voice_balance_minutes: number }> {
  return request("/api/v1/billing/admin/voice-quota/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
