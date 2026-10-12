export const COLOUR_FAMILIES = [
  // Lift the display swatch so dark tones remain visible on dark surfaces;
  // colour search still targets the original deep grey.
  { label: "Dark neutrals", rgb: [48, 48, 48], swatch: "#77716a" },
  { label: "Mid neutrals", rgb: [143, 138, 132], swatch: "#8f8a84" },
  { label: "Light neutrals", rgb: [225, 224, 219], swatch: "#e1e0db" },
  { label: "Red", rgb: [217, 83, 79], swatch: "#d9534f" },
  { label: "Orange", rgb: [223, 139, 57], swatch: "#df8b39" },
  { label: "Yellow", rgb: [215, 180, 74], swatch: "#d7b44a" },
  { label: "Green", rgb: [104, 163, 107], swatch: "#68a36b" },
  { label: "Cyan", rgb: [79, 168, 174], swatch: "#4fa8ae" },
  { label: "Blue", rgb: [93, 132, 214], swatch: "#5d84d6" },
  { label: "Purple", rgb: [143, 103, 199], swatch: "#8f67c7" },
  { label: "Pink", rgb: [216, 107, 167], swatch: "#d86ba7" },
] as const;
export type ColourFamily = (typeof COLOUR_FAMILIES)[number]["label"];
export const COLOUR_FAMILY_LABELS = COLOUR_FAMILIES.map((family) => family.label);
export const isNeutralFamily = (family: string): boolean => family.endsWith("neutrals");
