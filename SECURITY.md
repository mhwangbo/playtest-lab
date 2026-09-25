# Security and safety

This page covers what the lab does on your machine.

## Network and processes

- **Localhost only.** The bridge, the persona host and the web harness listen on `127.0.0.1` only.
- **Launched processes.** The lab starts only the game command written in your adapter (`bridge.command` / `personaBridge.command`).
- **No telemetry.** The lab never sends data anywhere.

## Your game

- **Integrations stay inactive by default.** The Unity package and the Godot addon only turn on when the game is launched with `-playtestPort` / `--playtestPort=`. Shipped builds are unaffected, but you can also leave the integration out of release builds.
- **Saves and accounts.** Point persona runs at throwaway saves and accounts (for example an in-memory save when `-playtestPort` is present) so a persona never touches a real player save.

## AI personas

- **Allowed commands.** Personas are told to use only `lab.js play …` (engine builds) or `__live.*` (web builds).
  - `play` never looks for a project folder and never suggests setup commands. This was added after a persona followed an error hint and ran `init` on a real project.
- **What counts.** Reports are built only from what the lab recorded, never from what a persona says in its final message.
- **Unverified issues.** Persona issues stay unverified until someone reproduces them.

## Secrets and spend

- **No keys needed.** The lab has no API keys and needs none. If you add an external service (e.g. a decision API for bots), read keys from environment variables. Never put keys in adapter files or prompts.
- **Token cost.** Persona sessions cost model tokens; see the cost table in the README. Bots are free.

## Reporting

Report security issues privately via GitHub security advisories on this repository.
