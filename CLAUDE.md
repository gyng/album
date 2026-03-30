@AGENTS.md

## Claude-specific rules
Scoped detail rules live in `.claude/rules/` and are loaded automatically by glob:
- `conventions.md` — CSS Modules, class joining, attribute omission
- `testing.md` — TDD, jest commands
- `map.md` — MapLibre, MMap, route overlay patterns (scoped to `MapWorld*`, `mapRoute*`)
- `search.md` — SQLite, colour filter, bind-parameter limits (scoped to `search/**`)
