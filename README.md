**English** | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md)

# playtest-lab

[![ci](https://github.com/mhwangbo/playtest-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/mhwangbo/playtest-lab/actions/workflows/ci.yml)

**A playtest group for your game: bot players, AI persona playtesters, and a prioritized report.**
It works with web games, Unity and Godot today. It is a [Claude Code](https://claude.com/claude-code) skill and also a zero-dependency Node CLI.

It answers two different questions, cheaply:

| Question | Who answers it | Cost |
|---|---|---|
| **Is it broken / balanced?** Crashes, softlocks, difficulty curve, skill gradient, dominant strategies | **Bots**: headless, deterministic, thousands of runs | free (CPU) |
| **Is it clear / fun?** Onboarding, confusion, feel, "would I play again" | **Personas**: AI playtesters playing the real build, with a rubric and mandatory criticism | about $0.40–1.30 per session |

Both write into one versioned report: `playtest-report.json` plus `report.md`. It contains prioritized issues, a suggested ticket for each issue, and per-level tables.

---

## What's in the box

- **Bot runner** (`lab/bots.js`)
  - Plays your game through a small **adapter** over many seeds, with idle, random and your own skill policies.
  - Aggregates metrics as mean and p10/p50/p90.
  - Reports crashes and never-ending runs as P0/P1 issues, and supports your own balance alarms.
- **Engine bridge** (`playtest-bridge/1`)
  - Newline JSON over localhost.
  - The game advances **only** when the lab asks for frames, on a fixed timestep, so runs are **deterministic per seed**.
  - Ships as a **Unity** package and a **Godot** addon.
- **Personas**, which play real builds:
  - **Web (live-lite):** the page gets a harness injected. The game runs on a fake clock (frozen between turns, fast-forwarded during them), the persona acts with player verbs, and it perceives on-screen text plus a "human-fidelity" scene description with deliberately vague counts and no cause-and-effect wording. It gets screenshots for the first 60 s.
  - **Engine builds:** `lab.js host` launches the build in a window. The persona acts with plain commands (`play tap Play`, `play drag B --to 2,1`, `play shot`). Unity uGUI games get this with **zero code** (`-playtestUgui`).
  - **Rubric:** every persona must rate clarity at 10 s and 60 s, agency, tension, reward and replay, and must name its 3 most-unsure moments. Issues must be recorded, not just claimed.
- **Report builder**
  - Persona issues stay **unverified**, and out of the verdict, until someone reproduces them.
  - Bot findings count immediately because they reproduce by seed.
- **Optional [ai-game-studio](https://github.com/mhwangbo/ai-game-studio) integration**
  - Mirrors summaries into the studio's `#qa` chat.
  - The studio's playtest gate turns `suggestedTicket`s into tickets.
  - Turn it off with `integrations.gameStudio: "off"`.

## Engine support

| Engine | Bots | Personas | How |
|---|---|---|---|
| **Web** (JS/TS, Canvas, Phaser, …) | ✅ | ✅ live-lite | adapter imports your DOM-free sim · `lab.js serve` injects the harness |
| **Unity** | ✅ | ✅ (uGUI zero-code, or your own target) | `engines/unity/com.playtestlab.bridge` (UPM) |
| **Godot 4** | ✅ | ✅ (implement observe/act; screenshots need a window) | `engines/godot/addons/playtest_bridge` |
| Turn-based / puzzle cores | ✅ (engine-side runner + `bots --import`) | ✅ | see "Engine-side bots" below |
| Unreal, Android, any unmodified .exe | — | — | [roadmap](#roadmap) |

## Install

```bash
git clone https://github.com/mhwangbo/playtest-lab.git
cd playtest-lab && npm test          # no dependencies; Node 20+
```

As a Claude Code skill, make the folder available as `~/.claude/skills/playtest-lab` (symlink or junction). Then ask Claude to "playtest my game".

## Quick start

### 1. Web game

```bash
node lab/lab.js init --game path/to/game --build http://localhost:5173/
# write path/to/game/.playtest/adapter.mjs  (template copied for you; example: examples/mothlight.adapter.mjs)
node lab/lab.js --game path/to/game run new --label "M1"
node lab/lab.js --game path/to/game bots --runs 30
node lab/lab.js --game path/to/game report
```

The adapter exports `create(seed)`, `observe`, `step`, `done`, `metrics`, `idleAction`, `randomAction`, `policies` and optional `findings`. The full contract is in [CONTRACT.md](CONTRACT.md).

Personas on a web build:

```bash
node lab/lab.js --game path/to/game serve --root dist --port 8120
```

Then spawn a persona with the prompt in [SKILL.md §3b](SKILL.md). Write a `.playtest/perception.js` to describe what's on screen; the example is [examples/mothlight.perception.js](examples/mothlight.perception.js).

### 2. Unity

1. Add the package:
   ```json
   "com.playtestlab.bridge": "https://github.com/mhwangbo/playtest-lab.git?path=/engines/unity/com.playtestlab.bridge"
   ```
2. **Bots:** implement one `IPlaytestTarget` (reset with a seed, apply action, observe, done, metrics), make a Windows build, and point the adapter at it:
   ```js
   export const bridge = { command: 'Builds/Win/MyGame.exe', args: ['-batchmode', '-nographics', '-playtestPort', '{PORT}'] };
   ```
   The worked example is [examples/unity-coinline](examples/unity-coinline): 80 headless runs in about 6 s, deterministic.
3. **Personas:** add
   ```js
   export const personaBridge = { command: 'Builds/Win/MyGame.exe', hideWindow: false, args: ['-screen-fullscreen', '0', '-screen-width', '405', '-screen-height', '720', '-playtestPort', '{PORT}', '-playtestUgui'] };
   ```
   Then run `lab.js host`. With `-playtestUgui` any uGUI game works with no code. For board or game state, subclass `PlaytestUguiTarget`.

### 3. Godot 4

1. Copy `engines/godot/addons/playtest_bridge` into your project and enable the plugin. It registers the `PlaytestBridge` autoload.
2. Put one node in group `playtest_target` with `reset_game(seed)`, `apply_action(dict)`, `observe()`, `is_done()` and `metrics()`.
3. Point the adapter at Godot:
   ```js
   export const bridge = { command: process.env.GODOT_BIN || 'godot', cwd: '.', args: ['--headless', '--fixed-fps', '60', '--path', '.', '--', '--playtestPort={PORT}'] };
   ```
   The worked example is [examples/godot-coinline](examples/godot-coinline). It gives the same results as the Unity sample and is deterministic.

### Engine-side bots (puzzles, turn-based, big games)

If your game has a pure logic core, run bots inside the engine (e.g. Unity `-batchmode -executeMethod`). Write per-level results as `{levels:[{id, …, policies:[{policy, runs, solvedPct, movesP50, …}]}]}` and import them:

```bash
node lab/lab.js --game . bots --import .playtest/my_bots.json
```

`findingsFromLevels(levels)` in your adapter can then compare the results with your design intent, for example intended solve-time bands against bot effort, tier outliers, or rules that don't matter.

## What it costs (measured)

These are API list prices, from real sessions on a small web game and a Unity puzzle game:

| Mode | Model | Cost / session | Notes |
|---|---|---|---|
| Bots | — | $0 | Web: 80 nights in about 8 s. Unity: 80 runs in about 6 s. Puzzle core: 30 levels × 3 policies × 30 seeds in about 4 min |
| Web persona, screenshots every turn | Sonnet | $1.51 | the baseline we started from |
| Web persona, live-lite (human fidelity, vision-first 60 s) | Haiku | **$0.39–0.49** | found the same verified onboarding issue as the baseline |
| Engine persona (Unity build, `play` commands) | Haiku | $0.86–1.30 | costs rise when a persona gets stuck on one level |

## Honest limits

- **LLM personas are weak at spatial puzzles.** Their struggle overstates human difficulty. Use them for clarity, onboarding, story and feel, and leave difficulty to bots plus real player telemetry.
- **Perception can be too kind.** An exact state dump made the game look clearer than pixels do (a persona rated 5/5 and missed a real onboarding issue). Hence the human-fidelity mode and screenshots for the first minute.
- **Perception can also hide guidance.** A persona couldn't use hints because the hint's on-screen highlight wasn't described. Mirror every visible cue.
- **Cheap models sometimes claim actions they didn't take.** Only what the lab recorded counts.
- **Personas can't hear audio.**

These came from real runs and are recorded in [LESSONS.md](LESSONS.md).

## Roadmap

- **No-integration mode:** personas drive any unmodified desktop game with screenshots and real mouse and keyboard (computer-use). Slower, but zero integration.
- **Unreal** bridge (C++ subsystem or Python), and **Android** (emulator or device via adb).
- **Bug pack**, all free and deterministic:
  - invariant hooks
  - engine error-log capture
  - record, replay and automatic minimization of failing action traces
  - chaos and novelty bots
  - coverage reports
  - a `lab check` regression gate against the last baseline
- **Fun metrics report:** skill gradient, luck vs skill share, dominant strategies, tension curve, learning curve.
- **Replay-review personas:** cheaper still; they critique recorded keyframes instead of playing live.
- **Human telemetry import:** calibrate bots and personas against real players.
- **Model-based feedback classification** as a plugin (e.g. a local classifier such as [laya](https://github.com/NandhaKishorM/laya)).
- **External decision-API bots** as a plugin (e.g. fast action-selection models such as Jev) using the adapter's `actionMenu`.
- TextMeshPro support in the uGUI helper; a per-level action cap for personas.

## Docs

- [SKILL.md](SKILL.md): how an agent runs the lab, including persona prompts.
- [CONTRACT.md](CONTRACT.md): the adapter API and the report schema.
- [SECURITY.md](SECURITY.md): what runs on your machine, and the persona guardrails.
- [LESSONS.md](LESSONS.md): what broke and how it was fixed.

## License

[MIT](LICENSE)
