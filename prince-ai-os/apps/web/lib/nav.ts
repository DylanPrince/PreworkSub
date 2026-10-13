import {
  Activity,
  BarChart3,
  Bot,
  Briefcase,
  CalendarDays,
  CheckSquare,
  Code2,
  FlaskConical,
  LayoutDashboard,
  Megaphone,
  MessageSquareText,
  Plug,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Video,
  Wallet,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavStatus = "live" | "planned";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  status: NavStatus;
  /** Roadmap milestone that delivers this page (see docs/implementation-plan.md). */
  milestone: number;
  summary: string;
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Operate",
    items: [
      {
        href: "/",
        label: "Overview",
        icon: LayoutDashboard,
        status: "live",
        milestone: 2,
        summary: "Executive overview of businesses, agents, runs and AI spend.",
      },
      {
        href: "/command",
        label: "AI Command Center",
        icon: MessageSquareText,
        status: "live",
        milestone: 3,
        summary:
          "Conversational interface that plans, estimates, requests approval and dispatches agent work.",
      },
      {
        href: "/agents",
        label: "Agent Workforce",
        icon: Bot,
        status: "live",
        milestone: 2,
        summary: "Agent registry, configuration versions and run history.",
      },
      {
        href: "/agent-builder",
        label: "Agent Builder",
        icon: Wrench,
        status: "live",
        milestone: 3,
        summary: "Create, version and sandbox-test custom agents without code changes.",
      },
      {
        href: "/workflows",
        label: "Workflows",
        icon: Workflow,
        status: "live",
        milestone: 4,
        summary: "Saved multi-agent workflows with dependencies and approval checkpoints.",
      },
      {
        href: "/tasks",
        label: "Tasks",
        icon: CheckSquare,
        status: "live",
        milestone: 2,
        summary: "Create tasks, run agents and inspect execution.",
      },
      {
        href: "/approvals",
        label: "Approvals",
        icon: ShieldCheck,
        status: "live",
        milestone: 4,
        summary: "Backend-enforced human approval queue for consequential actions.",
      },
      {
        href: "/calendar",
        label: "Calendar",
        icon: CalendarDays,
        status: "live",
        milestone: 5,
        summary:
          "Month view of publication dates, campaign dates, approval deadlines and workflow runs.",
      },
    ],
  },
  {
    title: "Businesses",
    items: [
      {
        href: "/businesses",
        label: "Businesses",
        icon: Briefcase,
        status: "live",
        milestone: 2,
        summary: "Isolated business workspaces.",
      },
      {
        href: "/ecommerce",
        label: "E-commerce",
        icon: ShoppingBag,
        status: "live",
        milestone: 5,
        summary:
          "Products, suppliers and unit economics with visible formulas. No store connected.",
      },
      {
        href: "/content",
        label: "Content Studio",
        icon: Video,
        status: "live",
        milestone: 5,
        summary: "Idea-to-publish pipeline; approval clears exact text. People publish it.",
      },
      {
        href: "/marketing",
        label: "Marketing",
        icon: Megaphone,
        status: "live",
        milestone: 5,
        summary:
          "Campaign plans with launch approval for budget and dates. No ad platform connected.",
      },
      {
        href: "/saas",
        label: "SaaS Projects",
        icon: Code2,
        status: "live",
        milestone: 5,
        summary: "Requirements and a prioritised backlog for software projects.",
      },
      {
        href: "/research",
        label: "Research Lab",
        icon: FlaskConical,
        status: "live",
        milestone: 5,
        summary: "Research briefs from agents, with claims marked for verification.",
      },
    ],
  },
  {
    title: "Insight",
    items: [
      {
        href: "/analytics",
        label: "Analytics",
        icon: BarChart3,
        status: "live",
        milestone: 5,
        summary: "Agent utilization, workflow success, monthly P&L and pipelines.",
      },
      {
        href: "/finance",
        label: "Finance",
        icon: Wallet,
        status: "live",
        milestone: 5,
        summary: "Profit and loss from recorded entries plus measured AI cost.",
      },
      {
        href: "/activity",
        label: "Activity Logs",
        icon: Activity,
        status: "live",
        milestone: 2,
        summary: "Append-only audit trail of user, agent and system actions.",
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        href: "/integrations",
        label: "Integrations",
        icon: Plug,
        status: "live",
        milestone: 3,
        summary: "Connection status for external services.",
      },
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        status: "live",
        milestone: 1,
        summary: "Appearance, account and spend limits.",
      },
    ],
  },
];

export const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

export function navItem(href: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav item ${href}`);
  return item;
}
