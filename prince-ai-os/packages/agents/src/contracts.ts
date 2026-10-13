import type { z } from "zod";
import { OUTPUT_SCHEMAS, isOutputSchemaKey, type OutputSchemaKey } from "./schemas";

/**
 * An output contract is everything the executor needs besides the prompt: the schema the model
 * must satisfy, deterministic mock output for development, and semantic checks beyond the schema.
 * Contracts are shared by built-in and Agent Builder agents, so a custom agent gets the same
 * validation as the template it resembles.
 */
export interface OutputContract {
  key: OutputSchemaKey;
  label: string;
  description: string;
  /** Deterministic, obviously-labelled output for the mock provider. Never shown as real. */
  mockOutput: (task: { title: string; instructions: string }) => unknown;
  /** Returns human-readable problems; an empty array means the output passed. */
  evaluate: (output: unknown) => string[];
}

export const MOCK_NOTE = "[MOCK OUTPUT: generated locally without an AI model; not real analysis]";

function parse<K extends OutputSchemaKey>(
  key: K,
  output: unknown,
): z.infer<(typeof OUTPUT_SCHEMAS)[K]> | null {
  const r = OUTPUT_SCHEMAS[key].safeParse(output);
  return r.success ? (r.data as z.infer<(typeof OUTPUT_SCHEMAS)[K]>) : null;
}

export const OUTPUT_CONTRACTS: Record<OutputSchemaKey, OutputContract> = {
  "executive-plan.v1": {
    key: "executive-plan.v1",
    label: "Execution plan",
    description:
      "Workstreams with owners, dependencies, approval flags, risks and owner decisions.",
    mockOutput: (task) => ({
      objective: `${MOCK_NOTE} ${task.title}`,
      summary: `${MOCK_NOTE} Placeholder plan for local testing.`,
      workstreams: [
        {
          title: "Research",
          owner: "Market Research Agent",
          description: "Mock research workstream",
          dependsOn: [],
          requiresHumanApproval: false,
        },
        {
          title: "Financial check",
          owner: "Financial Analyst",
          description: "Mock financial review",
          dependsOn: ["Research"],
          requiresHumanApproval: false,
        },
        {
          title: "Launch copy",
          owner: "Copywriting Agent",
          description: "Mock launch copy (flagged: it would be published)",
          dependsOn: ["Financial check"],
          requiresHumanApproval: true,
        },
      ],
      risks: ["Mock output: no real analysis performed"],
      decisionsForOwner: ["Whether to configure a real AI provider"],
    }),
    evaluate: (output) => {
      const o = parse("executive-plan.v1", output);
      if (!o) return ["Output does not match executive-plan.v1"];
      const problems: string[] = [];
      if (o.workstreams.length === 0) problems.push("Plan has no workstreams");
      const titles = new Set(o.workstreams.map((w) => w.title));
      for (const w of o.workstreams) {
        for (const d of w.dependsOn)
          if (!titles.has(d)) problems.push(`"${w.title}" depends on unknown workstream "${d}"`);
        if (w.dependsOn.includes(w.title)) problems.push(`"${w.title}" depends on itself`);
      }
      return problems;
    },
  },
  "market-research.v1": {
    key: "market-research.v1",
    label: "Research brief",
    description: "Findings with stated basis and confidence, opportunities, risks and limitations.",
    mockOutput: (task) => ({
      question: task.title,
      summary: `${MOCK_NOTE} No research was performed.`,
      findings: [
        { claim: "Mock finding", basis: "assumption", confidence: "low", needsVerification: true },
      ],
      opportunities: ["Mock opportunity"],
      risks: ["Mock risk"],
      suggestedNextSteps: ["Configure ANTHROPIC_API_KEY to run real research"],
      limitations: "Mock provider: nothing here is real.",
    }),
    evaluate: (output) => {
      const o = parse("market-research.v1", output);
      if (!o) return ["Output does not match market-research.v1"];
      const problems: string[] = [];
      if (o.findings.length === 0) problems.push("Report has no findings");
      if (!o.limitations.trim()) problems.push("Report must state its limitations");
      return problems;
    },
  },
  "copywriting.v1": {
    key: "copywriting.v1",
    label: "Copy variants",
    description: "Channel-specific headline, body and call to action drafts plus compliance notes.",
    mockOutput: (task) => ({
      brief: task.title,
      audience: "Mock audience",
      variants: [
        { channel: "ad", headline: MOCK_NOTE, body: "Mock body copy.", callToAction: "Learn more" },
      ],
      complianceNotes: ["Mock output: not for publication"],
    }),
    evaluate: (output) => {
      const o = parse("copywriting.v1", output);
      if (!o) return ["Output does not match copywriting.v1"];
      return o.variants.length === 0 ? ["No copy variants produced"] : [];
    },
  },
  "financial-analysis.v1": {
    key: "financial-analysis.v1",
    label: "Financial analysis",
    description: "Transparent formulas, assumptions, missing data and an advisory recommendation.",
    mockOutput: (task) => ({
      question: task.title,
      summary: `${MOCK_NOTE} No figures were analysed.`,
      calculations: [
        { label: "Mock margin", formula: "(price - cost) / price", result: "n/a (mock)" },
      ],
      assumptions: ["Mock output"],
      missingData: ["All real figures"],
      recommendation: "Advisory placeholder from the mock provider.",
    }),
    evaluate: (output) => {
      const o = parse("financial-analysis.v1", output);
      if (!o) return ["Output does not match financial-analysis.v1"];
      return /\b(transfer|wire|pay now|send payment)\b/i.test(o.recommendation)
        ? ["Recommendation reads as a payment instruction; financial output must stay advisory"]
        : [];
    },
  },
  "general-report.v1": {
    key: "general-report.v1",
    label: "General report",
    description: "Titled sections, recommendations, assumptions and open questions for the owner.",
    mockOutput: (task) => ({
      title: `${MOCK_NOTE} ${task.title}`,
      summary: `${MOCK_NOTE} No model was called.`,
      sections: [{ heading: "Mock section", content: "Placeholder content for local testing." }],
      recommendations: ["Mock recommendation"],
      assumptions: ["Mock output"],
      openQuestions: ["Mock question"],
    }),
    evaluate: (output) => {
      const o = parse("general-report.v1", output);
      if (!o) return ["Output does not match general-report.v1"];
      return o.sections.length === 0 ? ["Report has no sections"] : [];
    },
  },
};

export function getContract(key: string): OutputContract | undefined {
  return isOutputSchemaKey(key) ? OUTPUT_CONTRACTS[key] : undefined;
}
