import {
  ORACLE_QUESTIONS,
  taggedOracleQuestions,
  shuffleGamePhotos,
  type OracleQuestion,
  type PhotoGamePhoto,
} from "./photoGames";

export type PhotoCrosswordPuzzle = {
  size: 3 | 4;
  rows: OracleQuestion[];
  columns: OracleQuestion[];
  solution: PhotoGamePhoto[];
  tiles: PhotoGamePhoto[];
};

// An augmenting path moves earlier choices when a later square needs their photo.
export const assignCrosswordPhotos = (choices: PhotoGamePhoto[][]): PhotoGamePhoto[] | null => {
  const owners = new Map<string, number>();
  const assigned: PhotoGamePhoto[] = [];
  const visit = (cell: number, seen: Set<string>): boolean => {
    for (const photo of choices[cell]!) {
      if (seen.has(photo.path)) continue;
      seen.add(photo.path);
      const owner = owners.get(photo.path);
      if (owner === undefined || visit(owner, seen)) {
        owners.set(photo.path, cell);
        assigned[cell] = photo;
        return true;
      }
    }
    return false;
  };
  for (let cell = 0; cell < choices.length; cell++) if (!visit(cell, new Set())) return null;
  return assigned;
};

const TOPIC_CLUES: Record<string, string> = {
  people: "People",
  water: "Water",
  buildings: "Architecture",
  greenery: "Trees and plants",
  transport: "Vehicles",
  night: "Night",
  indoors: "Interiors",
  animals: "Animals",
  food: "Food",
  mountains: "Mountains",
  street: "Streets",
  sky: "Sky",
  reflection: "Reflections",
  sign: "Signs",
  bridge: "Bridges",
  snow: "Snow",
  windows: "Windows",
  doors: "Doorways",
  flowers: "Flowers",
  stairs: "Stairs",
  red: "Red",
  blue: "Blue",
  yellow: "Yellow",
};
export const crosswordClue = (question: OracleQuestion): string =>
  TOPIC_CLUES[question.id] ??
  question.label
    .replace(/^(?:Does it (?:show|feature)|Is there|Can you see|Is it)\s+/i, "")
    .replace(/\?$/, "")
    .replace(/^a /, "");
const clueFamily = (question: OracleQuestion): string => {
  const word = question.id.replace(/^tag:/, "").replace(/s$/, "");
  if (["building", "architecture"].includes(word)) return "architecture";
  if (
    [
      "window",
      "door",
      "flower",
      "bridge",
      "reflection",
      "sign",
      "mountain",
      "animal",
      "vehicle",
    ].includes(word)
  )
    return word;
  return crosswordClue(question).toLowerCase().replace(/s$/, "");
};

export const crosswordCellMatches = (
  puzzle: PhotoCrosswordPuzzle,
  cell: number,
  photo: PhotoGamePhoto,
): boolean =>
  puzzle.rows[Math.floor(cell / puzzle.size)]!.matches(photo) &&
  puzzle.columns[cell % puzzle.size]!.matches(photo);

export const checkPhotoCrossword = (
  puzzle: PhotoCrosswordPuzzle,
  cells: Array<PhotoGamePhoto | null>,
): boolean[] => {
  const counts = new Map<string, number>();
  for (const photo of cells) if (photo) counts.set(photo.path, (counts.get(photo.path) ?? 0) + 1);
  const available = new Set(puzzle.tiles.map((photo) => photo.path));
  return Array.from({ length: puzzle.size ** 2 }, (_, cell) => {
    const photo = cells[cell];
    return (
      !!photo &&
      available.has(photo.path) &&
      counts.get(photo.path) === 1 &&
      crosswordCellMatches(puzzle, cell, photo)
    );
  });
};

export const buildPhotoCrossword = (
  photos: PhotoGamePhoto[],
  size: 3 | 4 = 3,
  random: () => number = Math.random,
): PhotoCrosswordPuzzle | null => {
  const unique = [...new Map(photos.map((photo) => [photo.path, photo])).values()];
  if (unique.length < size ** 2) return null;
  const signatures = new Set<string>();
  const subjects = [...ORACLE_QUESTIONS, ...taggedOracleQuestions(unique)].filter((question) => {
    const signature = unique.map((photo) => +question.matches(photo)).join("");
    const count = signature.replaceAll("0", "").length;
    if (count < size || count > unique.length - size || signatures.has(signature)) return false;
    signatures.add(signature);
    return true;
  });
  if (subjects.length < size * 2) return null;
  const matches = new Map(
    subjects.map((question) => [
      question.id,
      new Set(unique.filter((photo) => question.matches(photo)).map((photo) => photo.path)),
    ]),
  );
  for (let attempt = 0; attempt < 360; attempt++) {
    const families = new Set<string>();
    const rows = shuffleGamePhotos(subjects, random)
      .filter((question) => {
        const family = clueFamily(question);
        if (families.has(family)) return false;
        families.add(family);
        return true;
      })
      .slice(0, size);
    const rowFamilies = new Set(rows.map(clueFamily));
    const columns = shuffleGamePhotos(
      subjects.filter(
        (column) =>
          !rows.includes(column) &&
          !rowFamilies.has(clueFamily(column)) &&
          rows.every((row) =>
            unique.some(
              (photo) =>
                matches.get(row.id)!.has(photo.path) && matches.get(column.id)!.has(photo.path),
            ),
          ),
      ),
      random,
    ).slice(0, size);
    if (columns.length !== size || new Set(columns.map(clueFamily)).size !== size) continue;
    const choices = rows.flatMap((row) =>
      columns.map((column) =>
        shuffleGamePhotos(
          unique.filter(
            (photo) =>
              matches.get(row.id)!.has(photo.path) && matches.get(column.id)!.has(photo.path),
          ),
          random,
        ),
      ),
    );
    const solution = assignCrosswordPhotos(choices);
    if (!solution) continue;
    const boardSignatures = [...rows, ...columns].map((question) =>
      solution.map((photo) => +question.matches(photo)).join(""),
    );
    if (new Set(boardSignatures).size !== size * 2) continue;
    return { size, rows, columns, solution, tiles: shuffleGamePhotos(solution, random) };
  }
  return null;
};
