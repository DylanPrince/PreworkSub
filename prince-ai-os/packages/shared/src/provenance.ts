/**
 * Every metric shown in the UI declares where it came from so that demo or estimated
 * numbers can never be mistaken for real business performance.
 */
export const DATA_SOURCES = ["actual", "imported", "user_entered", "estimated", "demo"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  actual: "Actual",
  imported: "Imported",
  user_entered: "User-entered",
  estimated: "Estimated",
  demo: "Demo",
};
