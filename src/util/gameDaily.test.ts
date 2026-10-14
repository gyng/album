import { dailyNumber, dailySeed, isNextDay, localDayKey } from "./gameDaily";
import { seededRandom } from "./seededRandom";

test("the day key follows the local calendar, not UTC", () => {
  expect(localDayKey(new Date(2026, 0, 2, 0, 30))).toBe("2026-01-02");
  expect(localDayKey(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
});

test("daily numbers count calendar days from the first daily", () => {
  expect(dailyNumber("2026-10-14")).toBe(1);
  expect(dailyNumber("2026-10-15")).toBe(2);
  expect(dailyNumber("2027-03-29")).toBe(167);
});

test("consecutive days cross month, year and DST boundaries", () => {
  expect(isNextDay("2026-10-31", "2026-11-01")).toBe(true);
  expect(isNextDay("2026-12-31", "2027-01-01")).toBe(true);
  expect(isNextDay("2027-03-27", "2027-03-28")).toBe(true);
  expect(isNextDay("2026-10-14", "2026-10-16")).toBe(false);
  expect(isNextDay("2026-10-14", "2026-10-14")).toBe(false);
});

test("a daily seed gives every player the same sequence, and each game its own", () => {
  const a = seededRandom(dailySeed("connections", "2026-10-14"));
  const b = seededRandom(dailySeed("connections", "2026-10-14"));
  const other = seededRandom(dailySeed("hindsight", "2026-10-14"));
  const first = [a(), a(), a()];
  expect([b(), b(), b()]).toEqual(first);
  expect([other(), other(), other()]).not.toEqual(first);
  for (const value of first) expect(value).toBeGreaterThanOrEqual(0);
  for (const value of first) expect(value).toBeLessThan(1);
});
