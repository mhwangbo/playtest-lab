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
