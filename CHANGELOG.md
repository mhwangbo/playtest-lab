# Changelog

## 0.2.1 (2026-09-26)

Fixes from the first game a studio built end to end on the Godot bridge.

- **Faster Godot bridge:** no Nagle on either side, and the addon busy-polls while commands keep coming instead of
  sleeping 1 ms every idle frame. 80 CoinLine runs: 32.6 s → 4.0 s.
- **No stray frame after reset (Godot):** a ready target gets its reset reply without a frame running, so step 1
  starts on tick 0. Results of existing Godot baselines shift slightly; re-baseline once.
- **`bridge.cwd` default:** engine binaries (e.g. `godot` on PATH) now run from the game folder; built players inside
  the game folder still run from their own folder.
- **`lab.js determinism`:** runs the bots twice and compares every row and failing seed; exit 1 on any difference.
- **`lab.js check --seed N`:** check a holdout seed range, since a same-seed check right after a re-baseline passes
  by construction.
- **Personas:** `play input key=value --frames N` for real-time games; `play bot <policy> --frames N` to hand
  control to a bot; screenshots are named per persona and never overwrite each other; `done` requires at least
  3 recorded notes (`personas.minNotes`).
- Docs: reset timing, cwd rules, when to write `config.check`, and perception guidance for aiming games.

## 0.2.0 (2026-09-25)

The bug pack: free, deterministic ways to find bugs and keep them fixed.

- **Invariants:** adapters can export `invariants(sim)`; Godot targets can add `check_invariants()` and Unity
  targets can implement `IPlaytestInvariants`. A broken rule stops the run and becomes a bug finding.
- **Logged errors:** errors the game logs but survives count as findings. In-process games: `console.error`.
  Engine games: Unity/C# exceptions and Godot `ERROR:` / `SCRIPT ERROR:` lines in the game's output, per run.
- **Engine crashes:** a game process that dies mid-run is a P0 crash with the reason and the game's own frames
  from the crash dump, and the next seed runs on a fresh process (it used to fail every later seed).
- **Traces:** every failing run is saved to `runs/<RUN>/traces/` (`playtest-trace/1`). `lab.js replay <trace>`
  re-runs it exactly; `--expect fixed` exits 1 while it still reproduces. Bot findings now come with a
  replay command as the repro and as the suggested ticket's acceptance check.
- **Regression gate:** `lab.js baseline set` and `lab.js check`: rerun the baseline's seeds, compare failure
  counts and metric means (tolerances in `config.check`), exit 1 on regression. The report gains a `check`
  section (additive; the contract stays `playtest-report/1`).
- **Salience helpers** for web perception modules: `window.__labSalience` (`vague`, `snap`, `region`, `near`).
- Bot results record `failureKinds` per policy; crashed and invariant-broken runs are left out of metric
  aggregates because they stop early.
- Verified on Godot 4.6.1 and Unity 6000.4 with planted bugs: every kind is found, replays reproduce at the same
  step, and `--expect fixed` passes after the fix.

## 0.1.0 (2026-09-25)

First public release.

- **Lab CLI** with no dependencies: `init`, `run new`, `bots`, `bots --import`, `serve`, `host`, `play`, `report`.
- **Bot runner:** deterministic, over many seeds and policies. It reports crashes and never-ending runs, and supports balance alarms written by the game.
- **Engine bridge `playtest-bridge/1`:**
  - Unity package, including zero-code uGUI persona support via `-playtestUgui`.
  - Godot 4 addon.
- **Persona harnesses:**
  - Web live-lite: fake clock, player verbs, human-fidelity perception, and screenshots for the first 60 s.
  - Engine host: `play` commands and screenshots.
- **Persona guardrails:**
  - a required rubric with 3 unsure moments,
  - issues must be recorded,
  - persona issues stay unverified until reproduced,
  - personas may only use `play` commands.
- **Report contract `playtest-report/1`:** includes suggested tickets and per-level tables.
- **Optional ai-game-studio integration:** `integrations.gameStudio` in config, or the `PLAYTEST_STUDIO_CLI` environment variable.
- **Examples:** Mothlight (web), CoinLine (Unity and Godot).
- **Tests and CI:** Node 20/22 on Ubuntu and Windows.
