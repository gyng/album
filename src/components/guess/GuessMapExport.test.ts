jest.mock("./GuessMap", () => ({
  GuessMap: jest.fn(),
}));

import GuessMapDefault from "./GuessMapExport";
import { GuessMap } from "./GuessMap";

it("provides the default export required by the dynamic map loader", () => {
  expect(GuessMapDefault).toBe(GuessMap);
});
