---
description: Testing rules and commands
---

- Run `npx jest` from `src/` (not the repo root)
- Subset: `npx jest --testPathPatterns="MapWorld"` (plural `--testPathPatterns`)
- Run tests after every refactor before committing
- Red-green TDD for new features and bug fixes — write the failing test first
- Prefer unit > integration > e2e
- No perf changes without profiling/benchmarking evidence first
