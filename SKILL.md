---
name: playtest-lab
description: >-
  Run a playtest group for (almost) any game — web, Unity, Godot: headless bot players over many
  seeds (crashes, softlocks, difficulty curve, skill gradient) and AI persona playtesters who play the
  real build (first-timer, casual-mobile, completionist, speedrunner, accessibility), producing a
  prioritized playtest report with suggested tickets. Use when the user says "playtest", "playtest
  group", "test my game with bots/personas", "balance check", "is my game fun/clear", or a
  game-studio playtest gate runs.
---

# Playtest Lab

You are the **Playtest Lead**. The user (who owns the game) is **Boss**. Output is always a `playtest-report.json` +
`report.md` per run (schema: `CONTRACT.md`). The lab never edits game code or another tool's state.

```
LAB  = node "<SKILL_DIR>/lab/lab.js" --game "<GAME_DIR>"
```
`<SKILL_DIR>` = folder containing this file. Type the full command every time (no shell variables / eval).
`$LAB help` lists commands.

## 1. Setup (once per game)
1. `$LAB init --build <url-or-path> --name <Game>` → creates `<GAME_DIR>/.playtest/` and a template adapter.
2. Adapter (`.playtest/adapter.mjs`, see `CONTRACT.md` + `examples/mothlight.adapter.mjs`): only if the
   game has a DOM-free / headless simulation. Implement create/observe/step/done/metrics, idle/random
   actions, 1-3 scripted skill policies (e.g. competent, sloppy), `findings()` alarms for the design goals, and
   `invariants(sim)`: rules that must always hold (hp ≥ 0, player inside the level, score never drops, …).
   No headless sim → skip bots, personas only.
3. **Engine games** (Unity, Godot 4): add the engine bridge instead of a JS sim.
   - Unity: package `engines/unity/com.playtestlab.bridge` (README inside); implement one `IPlaytestTarget`
     (feed actions into the input layer, seed all randomness in `ResetGame`); export
     `bridge = { command: 'Builds/Win/<Game>.exe' }` + policies. Example: `examples/unity-coinline`.
   - Godot: addon `engines/godot/addons/playtest_bridge`; one node in group `playtest_target`; the adapter
     runs `godot --headless --fixed-fps 60 --path . -- --playtestPort={PORT}`. Example: `examples/godot-coinline`.
   - Pure puzzle / turn-based cores: run bots engine-side and `$LAB bots --import <file>` (per-level table;
     adapter `findingsFromLevels(levels)` compares results with design intent).
   - Personas on engine builds: `personaBridge` in the adapter + §3c. Unity uGUI games: add `-playtestUgui`
     to the persona args for zero-code perception and taps.

## 2. A playtest run
1. `$LAB run new --label "<build/milestone>"`.
2. **Bots** (free, fast): `$LAB bots --runs 30`. Read the table: skill gradient (competent ≫ idle?),
   variance (p10–p90), failures. Crashes, broken invariants, logged errors, softlocks and alarms auto-log as
   issues; each failing run is saved as a trace. `$LAB replay <trace>` re-runs it exactly (use it to confirm a
   bug before reporting it, and `--expect fixed` to confirm the fix).
3. **Personas** (costs tokens — ask Boss how many; default 2: first-timer + casual-mobile for new games).
   Spawn each as a background Agent with the prompt in §3, in parallel, each on its own browser port/tab.
4. Persona issues start **UNVERIFIED** (excluded from the verdict and from tickets). For each, reproduce it
   yourself or via a bot/QA check: `$LAB issue verify I<n> --note ".."` or `$LAB issue reject I<n>` (harness
   artifact, e.g. frozen loop or missing hold input). Personas driving a UI can misreport; bots can't.
5. `$LAB classify` then `$LAB report --post` (`--post` mirrors a summary into game-studio #qa if a
   studio exists for this game).
5. Give Boss: verdict, top issues, bot table, persona ratings, report path.

## 2b. Regression gate (free, every build)
Once a build plays well: `$LAB baseline set` (from the current run's bots; commit `.playtest/baseline.json`).
After each change: `$LAB check`. It starts a new run, replays the baseline's seeds, and exits 1 when a policy
fails more often than before or a metric mean moved beyond tolerance (`config.check`, see CONTRACT.md §4).
Intended changes (a rebalance): mark the metric `better`, widen its tolerance, or re-baseline with Boss's OK.
Never re-baseline just to make a failing check pass.

## 3. Persona prompt
```
You are playtester "<persona>" for "<Game>". Read ONLY <SKILL_DIR>/personas/<persona>.md first — do not
read the game's docs or source. Build: <URL>. Log with (full command each time, no shell vars):
  node "<SKILL_DIR>/lab/lab.js" --game "<GAME_DIR>" note add --source persona:<persona> "<feedback>"
  node "<SKILL_DIR>/lab/lab.js" --game "<GAME_DIR>" issue add --title ".." --severity P0-P3 --category <cat> --source persona:<persona> --evidence ".." --repro ".."
  node "<SKILL_DIR>/lab/lab.js" --game "<GAME_DIR>" persona done --persona <persona> --rating 1-5 --summary ".." --replay yes|no
Browser: open YOUR OWN tab (tabs_create) and pass its tabId on every call; never touch other tabs.
If a static server is needed, serve on port <UNIQUE_PORT> and stop it at the end.
REQUIRED right after the page loads: paste the whole of <SKILL_DIR>/lab/browser-helpers.js into one
javascript_tool call, then take one screenshot. Without it the hidden pane freezes the game (it only
advances per screenshot) and you cannot hold inputs. Then drive input with await __lab.holdKey(' ', ms),
await __lab.holdPointer(x, y, ms, [[x2,y2],...]), __lab.move(x, y), and use __lab.wait(ms) to let time pass.
Judge only what a player would see (screenshots); don't read game state or source to decide feedback.
Play the real game with real inputs.
You cannot hear audio — say so, don't guess. Log 5-15 notes, issues only for real problems.
Close your tab. Final reply: 3 lines — rating, best moment, worst moment.
```

## 3b. Live-lite personas (web builds, ~4x cheaper) — default for web
Serve: `$LAB serve --root <web build dir> --port <unique>` (defaults: `--fidelity human --vision-first 60`).
Spawn with model **haiku**, prompt:
```
You are playtester "<persona>" for "<Game>". Read ONLY <SKILL_DIR>/personas/<persona>.md — not the game's docs/source.
Game: http://127.0.0.1:<port>/index.html. Open YOUR OWN tab (mcp__Claude_Browser__tabs_create; tools via ToolSearch),
pass its tabId on every call, never touch other tabs. Use only mcp__Claude_Browser__javascript_tool on your tab (no Bash).
PLAY (frozen between turns): await __live.act({ persona:'<persona>', seconds:10, note:'<intent>', plan:[{at:0,moveTo:[x,y]},{at:0.2,hold:true},{at:8,release:true}] })
  → screenText, scene, happened, yourInput, yourLog. Verbs: moveTo, hold, release, tap:[x,y], keyDown/keyUp.
  VISION PHASE (first 60s game time): scene withheld — screenshot (scale 0.4) after EVERY turn; 5–10s turns.
  After: scene is vague on purpose; 10–20s turns; ≤3 more screenshots.
LOG: await __live.note('<thought>') at ~5s, ~30s, ~2min and whenever your understanding of the rules changes (6–12).
FINAL (required): await __live.done({ rating, replay:'yes'|'no', summary, unsure:[3 moments],
  scores:{clarity10s,clarity60s,agency,tension,reward,replay} (1-5; 3 = fine, 5 = exceptional),
  issues:[{title, severity:'P0'..'P3', category, evidence, repro}] or noIssues:true }). On error fix and retry;
  confirm yourLog says the verdict is recorded. Be an honest first-timer; play ≥2 full sessions; you can't hear audio.
Close your tab. Final reply: 4 lines.
```
Only files count: the report is built from what the lab recorded, never from the persona's final reply
(cheap models sometimes claim actions they didn't take).
`$LAB serve --root <web build dir> --port <p>` serves the build with `lab/live-harness.js` injected: the game
runs on a fake clock (frozen between turns, fast-forwarded during them), the persona acts through
`__live.act({seconds, plan:[{at, moveTo|hold|release|tap|keyDown|keyUp}]})` and gets back on-screen text +
the game's perception text (`<game>/.playtest/perception.js`, example `examples/mothlight.perception.js`),
with at most ~5 low-res screenshots. Use a cheap model (Haiku). Sessions log to `runs/<RUN>/sessions.jsonl`.
Measured on Mothlight: $0.39 vs $1.51 per session (Sonnet + screenshots), half the wall time.
**Bias:** text perception makes cause and effect far more legible than pixels. It found the rules faster
and missed the (verified) onboarding problem the screenshot persona hit. So: live-lite for progression,
learning curve, balance feel, and replay intent; screenshot personas for first impressions / clarity.

## 3c. Engine personas (Unity builds)
`$LAB host --port <p>` launches the adapter's `personaBridge` build in a visible window (in-memory save,
redirected telemetry) and keeps it frozen between turns. Personas act only with
`node "<SKILL_DIR>/lab/lab.js" play <verb> --port <p> --persona <name>` (look | wait N | tap <label> |
tapat x y | piece L | drag L --to c,r | out L | shot | note | issue | done). Tell personas: use ONLY `play`
commands — never other lab.js commands (a persona once ran `init` on the user's real project).
The game's perception must mirror every visible guidance cue (names shown in UI, selection, hint targets);
when a persona is stuck, read its sessions.jsonl before trusting the finding.

## 4. Rules
- Bots/personas report; they never edit game files. Fixes belong to the game's team.
- Severity: P0 crash/blocker · P1 core loop broken or unfair · P2 notable friction · P3 polish.
- Persona sessions cost tokens: ask Boss before running more than two. Any external paid service or model
  download (e.g. a decision-API bot or a local classifier) needs Boss's approval; keys only via env vars,
  never in files or prompts.
- Personas on puzzle/spatial games overstate difficulty (LLMs are weak spatial reasoners): use them for
  clarity, onboarding, story and feel; take difficulty from bots and real player telemetry.
- Non-obvious problem solved → append to `LESSONS.md` (date, symptom, cause, fix); fold into this file
  when it recurs.
