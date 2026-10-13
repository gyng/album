// Spherical k-means groups the original embeddings, independently of the view.
export const clusterVectors = (vectors: readonly (readonly number[])[], k: number): number[][] => {
  if (!vectors.length || k < 1) return [];
  const normalise = (v: readonly number[]) => {
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  };
  const rows = vectors.map(normalise);
  const dot = (a: readonly number[], b: readonly number[]) =>
    a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);
  let centres = [rows[0]!];
  while (centres.length < Math.min(k, rows.length)) {
    let candidate = 0,
      distance = -1;
    rows.forEach((row, index) => {
      const nearest = Math.min(...centres.map((centre) => 1 - dot(row, centre)));
      if (nearest > distance) {
        distance = nearest;
        candidate = index;
      }
    });
    if (distance < 1e-8) break;
    centres.push(rows[candidate]!);
  }
  let members: number[][] = [];
  for (let step = 0; step < 16; step++) {
    members = centres.map(() => []);
    rows.forEach((row, index) => {
      let best = 0,
        similarity = -Infinity;
      centres.forEach((centre, group) => {
        const score = dot(row, centre);
        if (score > similarity) {
          best = group;
          similarity = score;
        }
      });
      members[best]!.push(index);
    });
    centres = centres.map((centre, group) =>
      members[group]!.length
        ? normalise(
            centre.map((_x, dimension) =>
              members[group]!.reduce((sum, index) => sum + rows[index]![dimension]!, 0),
            ),
          )
        : centre,
    );
  }
  return members.filter((group) => group.length);
};
