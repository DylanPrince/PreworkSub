import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stat } from "@/components/common/stat";
import { ProviderBadge } from "@/components/common/status-badge";
import { StructuredOutput } from "@/components/tasks/structured-output";

describe("Stat", () => {
  it("shows 'Not tracked yet' instead of a fabricated zero", () => {
    render(<Stat label="Revenue" value={null} source="not_tracked" />);
    expect(screen.getByText("Not tracked yet")).toBeInTheDocument();
    expect(screen.getByText("Not tracked")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("labels non-actual data sources", () => {
    render(<Stat label="Revenue" value="$10" source="demo" />);
    expect(screen.getByText("Demo")).toBeInTheDocument();
  });
});

describe("ProviderBadge", () => {
  it("flags mock output", () => {
    render(<ProviderBadge provider="mock" />);
    expect(screen.getByText("Mock output")).toBeInTheDocument();
  });
});

describe("StructuredOutput", () => {
  it("renders nested objects, arrays and booleans readably", () => {
    render(
      <StructuredOutput
        value={{
          summary: "Hello",
          needsVerification: true,
          findings: [{ claim: "A" }],
          risks: ["r1", "r2"],
        }}
      />,
    );
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Needs Verification")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
