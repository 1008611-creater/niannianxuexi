export type LearningTemplateAction = "photo" | "concept" | "paper";

export interface LearningTemplate {
  id: string;
  revision: number;
  audience: "student" | "parent";
  region: string;
  stage: string;
  grade: string;
  subject: string;
  textbookEdition: string;
  materialRefs: readonly string[];
  personaRef: string;
  partnerRef: string;
  defaultActions: readonly LearningTemplateAction[];
  toolPolicy: "student_safe";
  teachingPolicy: "guided_first";
  rightsStatus: "pending_review" | "verified";
}

/**
 * The first product slice is an entry contract, not a curriculum package.
 * Material and rights fields stay explicit until an administrator verifies the
 * exact edition and licensed sources.
 */
export const JUNIOR_MATH_BRIDGE_TEMPLATE: LearningTemplate = {
  id: "junior-math-bridge-pep",
  revision: 1,
  audience: "student",
  region: "全国通用（待核实地区映射）",
  stage: "初中",
  grade: "初二入学衔接",
  subject: "数学",
  textbookEdition: "人教版（待核实具体册次）",
  materialRefs: ["pep-junior-math-index (待核实)", "user-uploaded-materials"],
  personaRef: "niannian-math-teacher (待核实)",
  partnerRef: "niannian-math-teacher (待核实)",
  defaultActions: ["photo", "concept", "paper"],
  toolPolicy: "student_safe",
  teachingPolicy: "guided_first",
  rightsStatus: "pending_review",
};
