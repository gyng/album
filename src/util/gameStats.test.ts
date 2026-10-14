import { currentStreak, EMPTY_GAME_STATS, parseGameStats, recordGameResult } from "./gameStats";

test("counts games, wins and the best score", () => {
  let stats = recordGameResult(EMPTY_GAME_STATS, { won: true, score: 40 }, "2026-10-14");
  stats = recordGameResult(stats, { won: false, score: 70 }, "2026-10-14");
  stats = recordGameResult(stats, { won: true, score: 10 }, "2026-10-14");
  expect(stats).toMatchObject({ played: 3, won: 2, best: 70 });
});

test("a streak counts consecutive days and restarts after a gap", () => {
  let stats = recordGameResult(EMPTY_GAME_STATS, { won: true }, "2026-10-30");
  stats = recordGameResult(stats, { won: false }, "2026-10-30");
  stats = recordGameResult(stats, { won: true }, "2026-10-31");
  stats = recordGameResult(stats, { won: true }, "2026-11-01");
  expect(stats).toMatchObject({ streak: 3, bestStreak: 3 });
  stats = recordGameResult(stats, { won: true }, "2026-11-03");
  expect(stats).toMatchObject({ streak: 1, bestStreak: 3 });
});

test("a streak lapses when neither today nor yesterday was played", () => {
  const stats = recordGameResult(EMPTY_GAME_STATS, { won: true }, "2026-10-14");
  expect(currentStreak(stats, "2026-10-14")).toBe(1);
  expect(currentStreak(stats, "2026-10-15")).toBe(1);
  expect(currentStreak(stats, "2026-10-16")).toBe(0);
});

test("only the first finish of a daily is kept", () => {
  const daily = { day: "2026-10-14", summary: "1 mistake" };
  let stats = recordGameResult(EMPTY_GAME_STATS, { won: true, score: 3, daily }, "2026-10-14");
  stats = recordGameResult(
    stats,
    { won: true, score: 4, daily: { ...daily, summary: "no mistakes" } },
    "2026-10-14",
  );
  expect(stats.dailies["2026-10-14"]).toEqual({ won: true, score: 3, summary: "1 mistake" });
});

test("old dailies are pruned", () => {
  let stats = EMPTY_GAME_STATS;
  for (let day = 1; day <= 70; day++) {
    const key = `2027-${String(Math.ceil(day / 28)).padStart(2, "0")}-${String(((day - 1) % 28) + 1).padStart(2, "0")}`;
    stats = recordGameResult(stats, { won: true, daily: { day: key, summary: "" } }, key);
  }
  expect(Object.keys(stats.dailies)).toHaveLength(60);
  expect(stats.dailies["2027-01-01"]).toBeUndefined();
});

test("malformed storage falls back field by field", () => {
  expect(parseGameStats(null)).toEqual(EMPTY_GAME_STATS);
  expect(
    parseGameStats({
      played: 4,
      won: 9,
      best: "high",
      streak: -1,
      bestStreak: 2,
      lastDay: "yesterday",
      dailies: { "2026-10-14": { won: true, summary: "ok" }, nope: {}, "2026-10-13": { won: 1 } },
    }),
  ).toEqual({
    played: 4,
    won: 4,
    streak: 0,
    bestStreak: 2,
    dailies: { "2026-10-14": { won: true, summary: "ok" } },
  });
});
