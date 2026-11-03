# Lizard — notes for agents

- `solver/` is an imported snapshot of michaellhan/gto-solver (see `solver/UPSTREAM.json`). Keep it byte-identical to
  upstream except the patches declared there; put Lizard code outside it.
- Never run `solver/scripts/deploy.sh` or `solver/scripts/deploy_library.sh` (they publish the legacy site). Never
  push to `michaellhan/gto-solver-library` or `michaellhan/michaellhan.github.io`.
- `/Users/mhan/Desktop/projects/gtosolver` is another project with long precomputation builds running in `.work/`.
  Read its `.work/hu-lib` and `.work/hu-lp-lib` only (via `scripts/library/assemble.py`); never write, move or
  delete anything there, and never run git commands in that checkout or its `gto-wt/*` worktrees.
- While those builds run: route anything over about a minute of CPU (the solver test suites, benchmarks, solves)
  through `/Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh`. Never use `quiet.sh` (it pauses the builds).
  Keep processes under about 1 GB of RAM.
- Every number shown to users must carry its provenance (`web/src/solver/provenance.ts`); never present the preflop
  charts or rule fallbacks as solved.
- Before claiming a feature works, check it in `docs/FEATURE_MATRIX.md` terms (WORKING / PARTIAL / APPROXIMATE /
  NOT IMPLEMENTED) and update that file.
