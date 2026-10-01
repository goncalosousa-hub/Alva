/** ABAP releases the local analysis (abaplint) can target. Kept apart so the UI does not pull in abaplint. */
export type AbapRelease = "v702" | "v740sp08" | "v750" | "v754" | "v757" | "v758" | "Cloud";

export const RELEASES: { id: AbapRelease; label: string }[] = [
  { id: "v758", label: "ABAP 7.58 / S/4HANA 2023+" },
  { id: "v757", label: "ABAP 7.57 / S/4HANA 2022" },
  { id: "v754", label: "ABAP 7.54 / S/4HANA 1909" },
  { id: "v750", label: "ABAP 7.50" },
  { id: "v740sp08", label: "ABAP 7.40 SP08" },
  { id: "v702", label: "ABAP 7.02" },
  { id: "Cloud", label: "ABAP Cloud (BTP / Public Cloud)" },
];
