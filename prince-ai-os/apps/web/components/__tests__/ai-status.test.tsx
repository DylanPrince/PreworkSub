import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiStatusPanel, AiStatusPill, type AiStatusView } from "@/components/common/ai-status";
import { ProviderBadge } from "@/components/common/status-badge";

const w = (limitUsd: number, actualUsd: number, reservedUsd = 0) => {
  const committedUsd = actualUsd + reservedUsd;
  const remainingUsd = Math.max(0, limitUsd - committedUsd);
  return {
    limitUsd,
    actualUsd,
    reservedUsd,
    committedUsd,
    remainingUsd,
    reached: remainingUsd <= 0,
  };
};

const status = (over: Partial<AiStatusView> = {}): AiStatusView => {
  const day = w(5, 1.25, 0.25);
  const month = w(50, 10);
  return {
    mode: "live",
    anthropicConfigured: true,
    realCallsAvailable: true,
    mockAvailable: true,
    budget: { day, month, blocked: false },
    ...over,
  };
};

describe("AiStatusPill", () => {
  it("says Claude is live and shows today's committed spend against the limit", () => {
    render(<AiStatusPill status={status()} />);
    const link = screen.getByRole("link", { name: /AI status: Claude live/ });
    expect(link).toHaveAttribute("href", "/integrations#ai-status");
    expect(link).toHaveAccessibleName(/\$1\.50 of \$5\.00 daily limit/);
  });

  it("puts a reached limit ahead of everything else", () => {
    const day = w(5, 5);
    render(
      <AiStatusPill
        status={status({
          realCallsAvailable: false,
          budget: { day, month: w(50, 5), blocked: true },
        })}
      />,
    );
    expect(screen.getByText("Daily limit reached")).toBeInTheDocument();
  });

  it("distinguishes mock mode and missing configuration", () => {
    const { rerender } = render(<AiStatusPill status={status({ mode: "mock" })} />);
    expect(screen.getByText("Mock mode")).toBeInTheDocument();
    rerender(
      <AiStatusPill
        status={status({
          mode: "not_configured",
          anthropicConfigured: false,
          realCallsAvailable: false,
        })}
      />,
    );
    expect(screen.getByText("Claude not configured")).toBeInTheDocument();
  });
});

describe("AiStatusPanel", () => {
  it("answers the three owner questions in text, not just colour", () => {
    render(<AiStatusPanel status={status()} />);
    expect(screen.getByText(/Anthropic API key configured/)).toHaveTextContent("Yes");
    expect(screen.getByText(/Agents can make real Claude calls/)).toHaveTextContent("Yes");
    expect(screen.getByText(/Within spending limits/)).toHaveTextContent("Yes");
    expect(screen.getByRole("meter", { name: "Today (UTC) AI spend" })).toHaveAttribute(
      "aria-valuetext",
      "$1.50 of $5.00",
    );
    expect(screen.getByText(/not a billing cap/)).toBeInTheDocument();
  });

  it("explains why real calls are blocked when a limit is reached", () => {
    const day = w(5, 5.1);
    render(
      <AiStatusPanel
        status={status({
          realCallsAvailable: false,
          budget: { day, month: w(50, 6), blocked: true },
        })}
      />,
    );
    expect(screen.getByText(/Agents can make real Claude calls/)).toHaveTextContent("No");
    expect(screen.getByText(/Blocked because a spending limit is reached/)).toBeInTheDocument();
    expect(screen.getByText(/new paid runs are refused/)).toBeInTheDocument();
  });
});

describe("ProviderBadge", () => {
  it("labels real Claude output distinctly from mock output", () => {
    render(<ProviderBadge provider="anthropic" />);
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.queryByText("Mock output")).not.toBeInTheDocument();
  });
});
