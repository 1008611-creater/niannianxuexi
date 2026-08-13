import { apiFetch, apiUrl } from "@/lib/api";

export type LearnerQuestion = {
  id: string;
  skill: string;
  prompt: string;
  options: string[];
};

export type LearnerProfile = {
  id: string;
  child_name: string;
  grade: string;
  textbook_edition: string;
  assessment: {
    score: number;
    total: number;
    level: string;
    weak_areas: string[];
    results?: { question_id: string; choice?: number; correct: boolean }[];
  };
  agent_presets: { id: string; name: string; purpose: string }[];
  updated_at: string;
};

async function request(path: string, init?: RequestInit): Promise<Response> {
  return apiFetch(apiUrl(path), init);
}

export async function getLearnerProfile(): Promise<LearnerProfile | null> {
  const response = await request("/api/v1/learning-profile/profile");
  if (!response.ok) throw new Error("无法读取孩子档案");
  const payload = (await response.json()) as { profile: LearnerProfile | null };
  return payload.profile;
}

export async function getLearnerQuestions(): Promise<LearnerQuestion[]> {
  const response = await request("/api/v1/learning-profile/questions");
  if (!response.ok) throw new Error("无法加载摸底题");
  const payload = (await response.json()) as { questions: LearnerQuestion[] };
  return payload.questions;
}

export async function saveLearnerProfile(input: {
  child_name: string;
  grade: string;
  textbook_edition: string;
  answers: Record<string, number>;
}): Promise<LearnerProfile> {
  const response = await request("/api/v1/learning-profile/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("保存失败，请稍后再试");
  const payload = (await response.json()) as { profile: LearnerProfile };
  return payload.profile;
}
