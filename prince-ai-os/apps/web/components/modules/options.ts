export interface Option {
  value: string;
  label: string;
}

export const SOURCE_OPTIONS: Option[] = [
  { value: "user_entered", label: "Actual" },
  { value: "estimated", label: "Estimate" },
];

/** "short_video" → "Short video". */
export const humanize = (value: string) =>
  value === "todo" ? "To do" : value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");

export const toOptions = (values: readonly string[], labels?: Record<string, string>): Option[] =>
  values.map((v) => ({ value: v, label: labels?.[v] ?? humanize(v) }));

/** Today in the viewer's time zone as YYYY-MM-DD (date inputs; may differ from the server's). */
export const today = () => new Date().toLocaleDateString("en-CA");
