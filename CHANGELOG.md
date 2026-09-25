# Changelog

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
