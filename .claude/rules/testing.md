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
