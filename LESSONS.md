# Playtest Lab lessons (append-only)

Format: date · symptom · cause · fix · status (NEW / FOLDED into <file>).

### 2026-09-25 · persona saw a frozen game ("Space does nothing", "no score ever")
- cause: browser pane hidden → requestAnimationFrame never fires; the game advanced only when a screenshot forced a frame. Agents also lack a sustained key/mouse hold, so "hold to start" never triggered.
- fix: lab/browser-helpers.js (rAF → setTimeout, __lab.holdKey / holdPointer) injected right after page load; persona issues are UNVERIFIED by default and excluded from the verdict until reproduced. Rejected R1 persona issues I1/I2 as harness artifacts (verified: Space hold starts night, HUD present).
- status: FOLDED into SKILL.md §3 persona prompt + lab.js verified flag

### 2026-09-25 · live-lite persona (Haiku + text perception) rated 5/5 and missed the verified onboarding issue
- cause: perception text gives superhuman eyes — exact speck counts/positions and causal event lines ("a speck flew into the big white circle and vanished") make the rules legible in a way the pixels don't
- fix: use live-lite for progression/balance/replay; keep screenshot personas for first impressions; next: salience-limited perception (no exact counts, events only near the player's focus) and a vision-first opening minute
- status: FOLDED into SKILL.md §3b (bias note); salience filter FOLDED into examples/mothlight.perception.js (focus radius, vague counts) and generalized as `window.__labSalience` in lab/live-harness.js (0.2.0)

### 2026-09-25 · Haiku personas skip or fake logging steps
- symptom: v2 never called `persona done` (0 issues, 4 notes); v3 reported "3 issues logged" but never called `__live.issue()`
- cause: cheap models follow multi-step side instructions loosely and summarize intentions as actions
- fix: logging inside the page (same tool as play); issues required inside `__live.done()` (or explicit `noIssues:true`); rubric validated server-side; reports built only from recorded files; `yourLog` counters in every act() result
- status: FOLDED into SKILL.md §3b + lab.js record handler

### 2026-09-25 · engine persona could not use the game's hints (a Unity puzzle game, level 4)
- symptom: persona tapped "Show a move" twice, game said "Try moving Plum here", persona kept guessing and logged "level 4 unclear"
- cause: perception named pieces only by letter and did not describe on-screen highlights (hint glow, selection); a human sees both
- fix: perception must mirror every visible cue the game uses to guide the player (names shown in UI, selected piece, hint target); when a persona gets stuck, check its session log for guidance it could not perceive before trusting the finding
- status: FOLDED into the game's persona target + SKILL.md §3c (generic rule for engine perception)

### 2026-09-25 · persona ran `lab.js init` on the user's real project
- symptom: an untracked .playtest/ folder appeared in the user's main project working copy
- cause: a `play` call from the wrong folder errored with "run lab.js init", and the Haiku persona obeyed the hint
- fix: `play` no longer looks for a game folder at all; persona prompts allow only `play` commands; stray folder removed
- status: FOLDED into lab.js + SKILL.md §3c

### 2026-09-25 · an engine that crashed mid-run made every later seed "crash" too
- cause: the bridge kept the dead connection; on Windows the death arrives as ECONNRESET (a socket error), not a clean close
- fix: mark the client closed on error or close, start a fresh game process for the next seed, and put the crash reason in the finding
- status: FOLDED into lab/bridge.js (0.2.0)

### 2026-09-25 · crash findings showed only native stack noise
- cause: the last lines of a Unity or Godot crash dump are OS frames and symbol-lookup errors
- fix: keep the reason lines and the game's own frames (Mono JIT, `res://`, `.cs`/`.gd` lines) from the recent output; identify an engine crash by "the process died", not by its dump text, so replays still match
- status: FOLDED into lab/bridge.js + lab/bots.js (0.2.0)

### 2026-09-25 · first studio game on the Godot bridge (NIGHTBEAM) — feedback from the engine programmer
- symptom: (1) 120 bridge runs of a 180 s night took ~226 s, so a per-ticket check costs ~4 min; (2) a clean build has no failing trace, so "same seed replays identically" cannot be shown with replay; (3) the bridge runs one unpaused frame after reset (to poll is_ready), which added a stray tick to a target that steps in _physics_process; (4) bridge.cwd defaults to the binary folder, so Godot adapters must set cwd: '.'
- cause: one TCP round trip per decision + 1 ms idle sleep; replay only covers failing runs; reset/is_ready behaviour and cwd default undocumented
- fix: no Nagle + busy-poll in the Godot addon (8x faster), `lab.js determinism`, Godot replies to reset without a frame when ready (documented in CONTRACT §1b), cwd defaults to the game folder for engine binaries
- status: FOLDED into lab/bridge.js, engines/godot, lab/lab.js, CONTRACT.md (0.2.1)

### 2026-09-28 · first non-score game on the fun report (a deterministic narrative puzzle on the Unity bridge)
- symptom: (1) `lab.js fun` printed "best is NaN% above idle" once the game declared a skillOrder without idle; (2) every engine-side policy was flagged "mostly one action"; (3) luck 0% / skill 100% on every run
- cause: (1) the floor was picked from all policies that ran, not from the declared order; (2) engine-side bots only send `{"policy": name}`, so the lab never sees their real choices; (3) a deterministic puzzle has no luck by construction
- fix: (1) floor and random comparison use only policies in the order; (2) action mix skipped for engine-side policies; (3) nothing to fix — for puzzles the useful numbers are days-to-solve, wrong-answer recovery and the reaction mix; the game reported a composite `insight_score` and put its targets in `check`
- status: FOLDED into lab/fun.js (0.3.1)

### 2026-09-28 · persona `play shot` failed on a Unity D3D12 build ("screenshot file never appeared")
- symptom: every persona screenshot failed; the player log said `Failed to capture screen shot.`
- cause: the bridge spawns engine builds with a hidden window by default (right for headless bots); a hidden window cannot be captured on D3D12
- fix: `lab.js host` launches `personaBridge` builds visible (`hideWindow: false` default), the Unity bridge's error hints at a hidden/minimized window, CONTRACT §1b documents `hideWindow`
- status: FOLDED into lab/host.js, engines/unity PlaytestBridge.cs, CONTRACT.md (0.3.1)
