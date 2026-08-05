---
description: Testing rules and commands
---

- Run `npx jest` from `src/` (not the repo root)
- Subset: `npx jest --testPathPatterns="MapWorld"` (plural `--testPathPatterns`)
- Run tests after every refactor before committing
- Red-green TDD for new features and bug fixes — write the failing test first
- Prefer unit > integration > e2e
- No perf changes without profiling/benchmarking evidence first
- The e2e suite's managed server runs on **43110** (`PLAYWRIGHT_PORT` overrides). Not 3000: other
  projects' dev servers live there, and on WSL a Windows listener on 3000 collides through
  localhost forwarding without `ss` inside the distro showing anything. `test:e2e:reuse` defaults
  to 3000, since that is what `npm run dev` serves
- Specs that drive a control must navigate with `gotoHydrated` from `tests/hydrated.ts` — it waits
  for `html[data-app-hydrated]`, which `AppRuntime` sets on mount. Driving a control before then
  takes a value hydration throws away, and it reads as a logic bug rather than a race
- `npm run lint` includes `typecheck:tests`; it is the only gate that typechecks test files
- A taken e2e port self-heals (`bin/pickFreePort.cjs`), and the choice is handed to workers through
  `PLAYWRIGHT_E2E_PORT` — each worker re-evaluates the config, so picking per process breaks it
