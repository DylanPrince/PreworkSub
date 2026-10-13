import { z } from "zod";

/**
 * Structured output contracts. Each implemented agent returns one of these, validated by the
 * provider (structured outputs) and again by the executor before anything is persisted.
 * Keep to features supported by Claude structured outputs: objects, arrays, strings, numbers, enums.
 */

const confidence = z
  .enum(["low", "medium", "high"])
  .describe("How confident the agent is, given its inputs");

export const executivePlanSchema = z.object({
  objective: z.string().describe("The objective restated in one sentence"),
  summary: z.string(),
  workstreams: z.array(
    z.object({
      title: z.string(),
      owner: z.string().describe("Name of the agent role best suited to this workstream"),
      description: z.string(),
      dependsOn: z.array(z.string()).describe("Titles of workstreams that must finish first"),
      requiresHumanApproval: z.boolean(),
    }),
  ),
  risks: z.array(z.string()),
  decisionsForOwner: z.array(z.string()).describe("Decisions only the human owner can make"),
});

export const marketResearchSchema = z.object({
  question: z.string(),
  summary: z.string(),
  findings: z.array(
    z.object({
      claim: z.string(),
      basis: z
        .string()
        .describe("What the claim rests on: provided context, general knowledge, or assumption"),
      confidence,
      needsVerification: z.boolean(),
    }),
  ),
  opportunities: z.array(z.string()),
  risks: z.array(z.string()),
  suggestedNextSteps: z.array(z.string()),
  limitations: z.string().describe("What this report could not verify, e.g. no live web access"),
});

export const copywritingSchema = z.object({
  brief: z.string(),
  audience: z.string(),
  variants: z.array(
    z.object({
      channel: z.string(),
      headline: z.string(),
      body: z.string(),
      callToAction: z.string(),
    }),
  ),
  complianceNotes: z
    .array(z.string())
    .describe("Claims that need substantiation or disclosures to add"),
});

export const financialAnalysisSchema = z.object({
  question: z.string(),
  summary: z.string(),
  calculations: z.array(
    z.object({
      label: z.string(),
      formula: z.string().describe("Transparent formula using the provided figures"),
      result: z.string(),
    }),
  ),
  assumptions: z.array(z.string()),
  missingData: z.array(z.string()).describe("Figures that were needed but not provided"),
  recommendation: z.string().describe("Advisory only; never an instruction to move money"),
});

export const OUTPUT_SCHEMAS = {
  "executive-plan.v1": executivePlanSchema,
  "market-research.v1": marketResearchSchema,
  "copywriting.v1": copywritingSchema,
  "financial-analysis.v1": financialAnalysisSchema,
} as const;

export type OutputSchemaKey = keyof typeof OUTPUT_SCHEMAS;

export function isOutputSchemaKey(key: string): key is OutputSchemaKey {
  return key in OUTPUT_SCHEMAS;
}
