import type { OutputSchemaKey } from "./schemas";

export type Division =
  | "Executive"
  | "Research"
  | "Marketing"
  | "Content"
  | "Development"
  | "Business Operations";

export const DIVISIONS: Division[] = [
  "Executive",
  "Research",
  "Marketing",
  "Content",
  "Development",
  "Business Operations",
];

interface TemplateBase {
  key: string;
  name: string;
  division: Division;
  description: string;
  specialization: string;
}

/** A roster entry with a real prompt, output contract and limits (checks live in contracts.ts). */
export interface ImplementedAgentTemplate extends TemplateBase {
  implemented: true;
  instructions: string;
  outputSchemaKey: OutputSchemaKey;
  allowedTools: string[];
  permissions: string[];
  /** Includes thinking tokens, which Opus 5.5 and Fable 5.1 always produce. */
  maxOutputTokens: number;
  /** Sent as output_config.effort; null keeps the model's default. */
  effort: "low" | "medium" | "high" | null;
  budgetUsdPerRun: number;
  timeoutMs: number;
  maxAttempts: number;
}

/** A roster entry defined in the registry but not yet executable. Shown as "Planned" in the UI. */
export interface PlannedAgentTemplate extends TemplateBase {
  implemented: false;
}

export type AgentTemplate = ImplementedAgentTemplate | PlannedAgentTemplate;

const executiveCoordinator: ImplementedAgentTemplate = {
  implemented: true,
  key: "executive-coordinator",
  name: "Executive Coordinator",
  division: "Executive",
  description:
    "Decomposes objectives into workstreams, routes them to specialist agents, and escalates decisions.",
  specialization: "Objective decomposition and routing",
  instructions: `You are the Executive Coordinator. Turn the owner's objective into a concrete execution plan.
- Break the objective into 2-7 workstreams, each owned by one specialist role (Market Research Agent, Competitor Intelligence Agent, Product Research Agent, Marketing Strategist, Copywriting Agent, Financial Analyst, Software Architect, etc.).
- Order workstreams with explicit dependencies. Do not create circular dependencies.
- Mark any workstream involving money, publishing, customer commitments, deployments or credentials as requiring human approval.
- List the decisions only the owner can make.`,
  outputSchemaKey: "executive-plan.v1",
  allowedTools: [],
  permissions: ["read:business"],
  maxOutputTokens: 8192,
  effort: "medium",
  budgetUsdPerRun: 0.25,
  timeoutMs: 120_000,
  maxAttempts: 3,
};

const marketResearch: ImplementedAgentTemplate = {
  implemented: true,
  key: "market-research",
  name: "Market Research Agent",
  division: "Research",
  description:
    "Industry research, market trends, and demand analysis with every claim's basis stated.",
  specialization: "Market and demand analysis",
  instructions: `You are the Market Research Agent. Produce a research brief answering the task's question.
- For every finding, state its basis (provided context, general knowledge up to your training cutoff, or assumption) and whether it needs verification against current sources.
- You do not have live web access in this version. Say so in "limitations" and never present figures as current market data unless they came from the provided context.
- Prefer specific, testable findings over generic advice.`,
  outputSchemaKey: "market-research.v1",
  allowedTools: [],
  permissions: ["read:business"],
  maxOutputTokens: 12_000,
  effort: "medium",
  budgetUsdPerRun: 0.4,
  timeoutMs: 180_000,
  maxAttempts: 3,
};

const copywriter: ImplementedAgentTemplate = {
  implemented: true,
  key: "copywriting",
  name: "Copywriting Agent",
  division: "Marketing",
  description:
    "Drafts ad copy, landing page sections, emails, and product descriptions for human review.",
  specialization: "Conversion copy drafts",
  instructions: `You are the Copywriting Agent. Write draft copy for the brief in the task.
- Produce 2-4 variants across the channels requested (default: one ad, one landing page hero).
- Do not invent testimonials, statistics, prices, guarantees, or certifications. Where the brief implies a claim that needs proof, list it in complianceNotes.
- Drafts are never published by you; they go to the owner for approval.`,
  outputSchemaKey: "copywriting.v1",
  allowedTools: [],
  permissions: ["read:business"],
  maxOutputTokens: 8192,
  effort: "medium",
  budgetUsdPerRun: 0.25,
  timeoutMs: 120_000,
  maxAttempts: 3,
};

const financialAnalyst: ImplementedAgentTemplate = {
  implemented: true,
  key: "financial-analyst",
  name: "Financial Analyst",
  division: "Business Operations",
  description: "Revenue, cost and margin analysis with transparent formulas. Advisory only.",
  specialization: "Profitability and unit economics",
  instructions: `You are the Financial Analyst. Answer the financial question in the task using only figures provided in the task or business context.
- Show each calculation as a transparent formula with the inputs substituted.
- If a needed figure is missing, list it in missingData and do not guess it; you may show a scenario only if it is explicitly labelled as an assumption.
- Recommendations are advisory. Never instruct anyone to move money, invest, borrow, or pay.`,
  outputSchemaKey: "financial-analysis.v1",
  allowedTools: [],
  permissions: ["read:business"],
  maxOutputTokens: 8192,
  effort: "medium",
  budgetUsdPerRun: 0.25,
  timeoutMs: 120_000,
  maxAttempts: 3,
};

function planned(
  key: string,
  name: string,
  division: Division,
  description: string,
  specialization: string,
): PlannedAgentTemplate {
  return { implemented: false, key, name, division, description, specialization };
}

/** Full roster from the product brief. Planned entries become executable as their contracts are built. */
export const AGENT_TEMPLATES: AgentTemplate[] = [
  executiveCoordinator,
  planned(
    "operations-manager",
    "Operations Manager",
    "Executive",
    "Coordinates recurring processes, tracks deadlines, prepares status reports.",
    "Operational cadence",
  ),
  marketResearch,
  planned(
    "competitor-intelligence",
    "Competitor Intelligence Agent",
    "Research",
    "Competitor positioning, public pricing comparisons, offer analysis.",
    "Competitive analysis",
  ),
  planned(
    "product-research",
    "Product Research Agent",
    "Research",
    "Product opportunity analysis, supplier comparison, margin estimation.",
    "Product opportunities",
  ),
  planned(
    "marketing-strategist",
    "Marketing Strategist",
    "Marketing",
    "Campaign strategy, audience research, messaging, channel planning.",
    "Campaign strategy",
  ),
  copywriter,
  planned(
    "seo",
    "SEO Agent",
    "Marketing",
    "Keyword research, content briefs, technical SEO recommendations.",
    "Search optimisation",
  ),
  planned(
    "paid-ads-analyst",
    "Paid Advertising Analyst",
    "Marketing",
    "Campaign performance, CPA and ROAS analysis from connected ad data.",
    "Paid media analysis",
  ),
  planned(
    "content-strategist",
    "Content Strategist",
    "Content",
    "Content calendars, topic research, distribution plans.",
    "Content planning",
  ),
  planned(
    "video-scriptwriter",
    "Video Scriptwriter",
    "Content",
    "Short-form and YouTube scripts, hooks, storyboards.",
    "Video scripts",
  ),
  planned(
    "creative-production",
    "Creative Production Coordinator",
    "Content",
    "Coordinates authorised media-generation APIs and tracks assets.",
    "Creative production",
  ),
  planned(
    "publishing-coordinator",
    "Publishing Coordinator",
    "Content",
    "Draft scheduling and publication status, always behind approval.",
    "Publishing",
  ),
  planned(
    "software-architect",
    "Software Architect",
    "Development",
    "Technical designs, architecture decisions, implementation plans.",
    "Architecture",
  ),
  planned(
    "full-stack-developer",
    "Full-Stack Developer",
    "Development",
    "Feature implementation in isolated environments.",
    "Implementation",
  ),
  planned(
    "qa-engineer",
    "QA Engineer",
    "Development",
    "Test generation, bug reproduction, regression checks.",
    "Quality",
  ),
  planned(
    "security-reviewer",
    "Security Reviewer",
    "Development",
    "Dependency checks, permission reviews, security findings.",
    "Security",
  ),
  financialAnalyst,
  planned(
    "customer-support",
    "Customer Support Assistant",
    "Business Operations",
    "Classifies requests, drafts responses, escalates sensitive issues.",
    "Support drafts",
  ),
  planned(
    "business-analyst",
    "Business Analyst",
    "Business Operations",
    "KPI analysis, opportunity evaluation, operational recommendations.",
    "KPIs and opportunities",
  ),
];

export function getTemplate(key: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.key === key);
}

export function getImplementedTemplate(
  key: string | null | undefined,
): ImplementedAgentTemplate | undefined {
  if (!key) return undefined;
  const t = getTemplate(key);
  return t?.implemented ? t : undefined;
}

export const IMPLEMENTED_TEMPLATES = AGENT_TEMPLATES.filter(
  (t): t is ImplementedAgentTemplate => t.implemented,
);
