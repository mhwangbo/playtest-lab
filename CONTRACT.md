# Playtest Lab contracts

Two interfaces. Everything else is internal.

## 1. Game adapter (input) — `<game>/.playtest/adapter.mjs`

ES module the bot runner imports in Node (no browser). Template: `templates/adapter.template.mjs`,
worked example: `examples/mothlight.adapter.mjs`.

| Export | Required | Purpose |
|---|---|---|
| `meta` `{name, dt, decisionEvery, maxSeconds}` | yes | step size, bot decision rate, softlock timeout |
| `create(seed)` (may be async) | yes | new session already in gameplay |
| `observe(sim)` | yes | compact JSON-able state for bots |
| `step(sim, action, dt)` | yes | advance one step |
| `done(sim)` | yes | session over |
| `metrics(sim)` → `{name: number}` | yes | aggregated across runs (mean, p10, p50, p90, min, max) |
| `idleAction(obs)` | recommended | baseline policy `idle` |
| `randomAction(obs, rng)` | recommended | baseline policy `random` |
| `policies` `{name: (obs, rng, memo, sim) => action}` | recommended | scripted skill levels |
| `actionMenu(obs)` → `[{id, label, action}]` | optional | discrete choices |
| `findings(policies)` → `[{title, severity, category, evidence}]` | optional | game-specific balance alarms |

Rules: seeded and deterministic; DOM-free; no network. If the game has no headless simulation,
skip bots and run personas only.

### 1b. Engine games (Unity, Godot; Unreal later) — bridge adapter

If the adapter exports `bridge`, the lab launches the game build and drives it over localhost TCP
(newline-delimited JSON, protocol `playtest-bridge/1`, spec in `lab/bridge.js`). The adapter then only
provides `meta`, `bridge`, `idleAction`, `randomAction`, `policies`, `findings` (optionally `actionMenu`);
`observe`/`step`/`done`/`metrics` come from the engine-side target.

```js
export const bridge = { command: 'Builds/Win/Game.exe', args: ['-batchmode','-nographics','-playtestPort','{PORT}'],
                        port: 0 /* auto */, startupTimeoutMs: 60000, stepTimeoutMs: 30000 };
```
Omit `command` (and set `port`) to attach to an already-running game, e.g. Unity Play Mode.

| Engine | Engine-side piece | Status |
|---|---|---|
| Unity | `engines/unity/com.playtestlab.bridge` (UPM package; implement `IPlaytestTarget`) | ✅ verified (sample `examples/unity-coinline`, deterministic) |
| Godot 4 | `engines/godot/addons/playtest_bridge` (autoload; node in group `playtest_target`) | ✅ verified (sample `examples/godot-coinline`, deterministic) |
| Unreal | C++ subsystem / Python | planned |

## 2. Playtest report (output) — `<game>/.playtest/runs/<RUN>/playtest-report.json`

```jsonc
{
  "contract": "playtest-report/1",
  "game": "Mothlight", "build": "http://localhost:8080/", "runId": "R1", "created": 0, "label": "",
  "bots": { "runsPerPolicy": 20, "seconds": 210,
            "policies": { "idle": { "runs": 20, "failures": 0, "metrics": { "points": {"mean":0,"p10":0,"p50":0,"p90":0,"min":0,"max":0,"n":20} } } } },
  "personas": [ { "name": "first-timer", "rating": 4, "summary": "…", "wouldReplay": "yes" } ],
  "notes":    [ { "source": "persona:first-timer", "text": "…", "category": "clarity", "sentiment": "negative" } ],
  "issues":   [ { "id": "R1-I1", "title": "…", "severity": "P0|P1|P2|P3",
                  "category": "bug|crash|softlock|balance|clarity|feel|ux|perf|accessibility|audio|other",
                  "source": "persona:x|bot:x", "evidence": "…", "repro": "…", "seeds": [1],
                  "suggestedTicket": { "title": "…", "team": "engineering|design|audio", "type": "bug|design",
                                       "priority": "P1", "accept": ["…"] } } ],
  "summary":  { "issues": {"P0":0,"P1":0,"P2":0,"P3":0}, "personaRating": 4.0, "verdict": "playable|needs-work|blocked" }
}
```

Consumers (e.g. game-studio) read `suggestedTicket` to create tickets. Breaking changes bump the
`contract` version; additive fields do not.
