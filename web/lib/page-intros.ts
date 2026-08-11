import type { AppLanguage } from "@/context/app-shell-storage";

export interface PageIntroContent {
  title: string;
  summary: string;
  actions: readonly string[];
  confirmLabel: string;
}

export interface PageIntroDefinition {
  id: string;
  path: string;
  content: Record<AppLanguage, PageIntroContent>;
}

const PAGE_INTROS: readonly PageIntroDefinition[] = [
  {
    id: "home",
    path: "/home",
    content: {
      zh: {
        title: "和念念开始学习",
        summary: "拍题、说话或输入问题，念念会结合当前对话和学习资料继续讲明白。",
        actions: ["拍照讲题并追问", "和念念老师实时说话", "上传试卷或学习资料"],
        confirmLabel: "开始学习",
      },
      en: {
        title: "Start learning with Niannian",
        summary: "Ask with a photo, voice, or text. Niannian uses your current conversation and learning materials to keep explaining.",
        actions: ["Ask about a photographed question", "Talk with Niannian in real time", "Upload a paper or learning material"],
        confirmLabel: "Start learning",
      },
    },
  },
  {
    id: "partners",
    path: "/partners",
    content: {
      zh: {
        title: "选择一位学习伙伴",
        summary: "不同伙伴会长期陪伴你，并记住适合你的讲解方式和学习重点。",
        actions: ["找数学老师讲知识点", "让错题教练分析原因", "让家长助手整理学习建议"],
        confirmLabel: "看看伙伴",
      },
      en: {
        title: "Choose a learning partner",
        summary: "Each partner can support you over time and remember the explanations and learning focus that suit you.",
        actions: ["Learn a concept with a math teacher", "Diagnose mistakes with a review coach", "Turn progress into practical family guidance"],
        confirmLabel: "View partners",
      },
    },
  },
  {
    id: "agents",
    path: "/agents",
    content: {
      zh: {
        title: "一键完成学习任务",
        summary: "智能体专门处理一次明确任务，例如分析试卷、整理错题或生成变式练习。",
        actions: ["分析整张试卷", "整理错题和薄弱知识点", "生成针对性练习"],
        confirmLabel: "选择任务",
      },
      en: {
        title: "Complete a focused learning task",
        summary: "Agents handle a specific job such as paper analysis, mistake review, or targeted practice generation.",
        actions: ["Analyze a complete paper", "Organize mistakes and weak concepts", "Generate targeted practice"],
        confirmLabel: "Choose a task",
      },
    },
  },
  {
    id: "co-writer",
    path: "/co-writer",
    content: {
      zh: {
        title: "和念念一起写",
        summary: "从真实写作任务开始，念念可以帮助构思、修改和完善表达。",
        actions: ["梳理作文思路", "修改语句和结构", "完成读后感或学习总结"],
        confirmLabel: "开始写作",
      },
      en: {
        title: "Write with Niannian",
        summary: "Start with a real writing task and get help with ideas, revision, and clearer expression.",
        actions: ["Plan an essay", "Improve wording and structure", "Write a reflection or learning summary"],
        confirmLabel: "Start writing",
      },
    },
  },
  {
    id: "book",
    path: "/book",
    content: {
      zh: {
        title: "阅读并随时提问",
        summary: "查看适合当前学习阶段的资料，阅读过程中可以直接让念念解释。",
        actions: ["继续最近阅读", "查看老师推荐资料", "针对选中内容向念念提问"],
        confirmLabel: "开始阅读",
      },
      en: {
        title: "Read and ask as you go",
        summary: "Open materials suited to your current stage and ask Niannian for explanations while reading.",
        actions: ["Continue recent reading", "Open teacher-recommended material", "Ask about selected content"],
        confirmLabel: "Start reading",
      },
    },
  },
  {
    id: "learning-space",
    path: "/space",
    content: {
      zh: {
        title: "看清学习进展",
        summary: "这里汇总最近学习、薄弱知识点和下一步最值得完成的任务。",
        actions: ["继续今天的学习", "复习近期错题", "查看掌握情况变化"],
        confirmLabel: "查看进展",
      },
      en: {
        title: "See your learning progress",
        summary: "Review recent learning, weak concepts, and the most useful next task.",
        actions: ["Continue today's learning", "Review recent mistakes", "See how mastery is changing"],
        confirmLabel: "View progress",
      },
    },
  },
  {
    id: "memory",
    path: "/memory",
    content: {
      zh: {
        title: "管理念念记住的信息",
        summary: "检查念念记住的年级、教材、学习偏好和近期困难，并随时修正。",
        actions: ["查看已记住的信息", "修改不准确的内容", "删除不希望保留的信息"],
        confirmLabel: "查看记忆",
      },
      en: {
        title: "Manage what Niannian remembers",
        summary: "Review and correct remembered grade, textbook, preferences, and recent learning difficulties.",
        actions: ["Review saved facts", "Correct inaccurate information", "Remove information you do not want saved"],
        confirmLabel: "View memory",
      },
    },
  },
  {
    id: "knowledge",
    path: "/knowledge",
    content: {
      zh: {
        title: "管理学习资料",
        summary: "教材、教辅、试卷和自己上传的文件都可以在这里提供给念念使用。",
        actions: ["查看已经可用的资料", "上传教辅或试卷", "确认资料处理状态"],
        confirmLabel: "查看资料",
      },
      en: {
        title: "Manage learning materials",
        summary: "Textbooks, study guides, papers, and uploaded files can all be made available to Niannian here.",
        actions: ["Review available materials", "Upload a guide or paper", "Check processing status"],
        confirmLabel: "View materials",
      },
    },
  },
  {
    id: "settings",
    path: "/settings",
    content: {
      zh: {
        title: "调整念念的使用方式",
        summary: "修改个人资料、年级教材、语言、外观、语音和隐私等常用选项。",
        actions: ["切换中文或英文", "检查语音与文件设置", "管理账号和隐私选项"],
        confirmLabel: "查看设置",
      },
      en: {
        title: "Adjust how Niannian works for you",
        summary: "Change profile, grade and textbook, language, appearance, voice, and privacy options.",
        actions: ["Switch Chinese or English", "Check voice and file settings", "Manage account and privacy"],
        confirmLabel: "View settings",
      },
    },
  },
  {
    id: "billing",
    path: "/billing",
    content: {
      zh: {
        title: "查看会员与额度",
        summary: "了解剩余额度、近期使用和不同会员方案，不需要理解模型计费术语。",
        actions: ["查看当前可用额度", "了解额度使用去向", "比较会员方案"],
        confirmLabel: "查看额度",
      },
      en: {
        title: "Review membership and allowance",
        summary: "See remaining allowance, recent use, and membership options without model billing jargon.",
        actions: ["Check remaining allowance", "Understand recent usage", "Compare membership plans"],
        confirmLabel: "View allowance",
      },
    },
  },
  {
    id: "profile",
    path: "/profile",
    content: {
      zh: {
        title: "管理个人资料",
        summary: "查看当前账号并修改头像和个人信息。",
        actions: ["确认当前登录账号", "修改头像", "安全退出当前设备"],
        confirmLabel: "查看资料",
      },
      en: {
        title: "Manage your profile",
        summary: "Review the current account and update your avatar and personal details.",
        actions: ["Confirm the signed-in account", "Change the avatar", "Sign out from this device"],
        confirmLabel: "View profile",
      },
    },
  },
] as const;

function matchesPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function getPageIntro(pathname: string): PageIntroDefinition | null {
  return PAGE_INTROS.find((intro) => matchesPath(pathname, intro.path)) ?? null;
}
