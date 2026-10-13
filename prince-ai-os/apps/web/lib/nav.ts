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
        status: "planned",
        milestone: 4,
        summary: "Visual multi-agent workflows with triggers, branches and approval checkpoints.",
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
        status: "planned",
        milestone: 4,
        summary: "Backend-enforced human approval queue for consequential actions.",
      },
      {
        href: "/calendar",
        label: "Calendar",
        icon: CalendarDays,
        status: "planned",
        milestone: 4,
        summary: "Scheduled jobs, recurring workflows and content dates.",
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
        status: "planned",
        milestone: 5,
        summary: "Product research, supplier records, margin calculation and store adapters.",
      },
      {
        href: "/content",
        label: "Content Studio",
        icon: Video,
        status: "planned",
        milestone: 5,
        summary: "Idea-to-publish content pipeline with review and approval.",
      },
      {
        href: "/marketing",
        label: "Marketing",
        icon: Megaphone,
        status: "planned",
        milestone: 5,
        summary: "Campaign planning, creative drafts and performance from connected ad platforms.",
      },
      {
        href: "/saas",
        label: "SaaS Projects",
        icon: Code2,
        status: "planned",
        milestone: 5,
        summary: "Requirements, backlog, build and deployment status for software projects.",
      },
      {
        href: "/research",
        label: "Research Lab",
        icon: FlaskConical,
        status: "planned",
        milestone: 5,
        summary: "Saved research briefs and source-backed reports.",
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
        status: "planned",
        milestone: 5,
        summary: "Cross-business KPI analytics with drill-downs.",
      },
      {
        href: "/finance",
        label: "Finance",
        icon: Wallet,
        status: "planned",
        milestone: 5,
        summary: "Revenue, expenses and profitability with every record's source.",
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
