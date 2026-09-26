# Playtest Lab contracts

Two interfaces, plus two files the lab writes for you (traces and the baseline). Everything else is internal.

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
| `invariants(sim)` → `[]` or `[string | {id, message, severity}]` | optional | rules that must always hold, checked at every bot decision |

Rules: seeded and deterministic; DOM-free; no network. If the game has no headless simulation,
skip bots and run personas only.

What counts as a failing run (each becomes a finding, and the run is saved as a trace):

| Kind | When | Severity |
|---|---|---|
| `crash` | the game or adapter threw; for engine games, the process died | P0 |
| `invariant` | `invariants()` or the engine returned a broken rule (the run stops there) | P1, or the rule's own severity |
| `error` | the game logged an error but kept going: `console.error` for in-process games, the engine's output for bridge games | P1 |
| `softlock` | not done after `maxSeconds` | P1 |

### 1b. Engine games (Unity, Godot; Unreal later) — bridge adapter

If the adapter exports `bridge`, the lab launches the game build and drives it over localhost TCP
(newline-delimited JSON, protocol `playtest-bridge/1`, spec in `lab/bridge.js`). The adapter then only
provides `meta`, `bridge`, `idleAction`, `randomAction`, `policies`, `findings` (optionally `actionMenu`, and
`invariants(obs)`, which gets the observation); `observe`/`step`/`done`/`metrics` come from the engine-side target.
Engine-side rules: Godot `check_invariants() -> Array` on the target node, Unity `IPlaytestInvariants`. They arrive
as an optional `violations` array in reset/step replies.

```js
export const bridge = { command: 'Builds/Win/Game.exe', args: ['-batchmode','-nographics','-playtestPort','{PORT}'],
                        port: 0 /* auto */, startupTimeoutMs: 60000, stepTimeoutMs: 30000 };
```
Omit `command` (and set `port`) to attach to an already-running game, e.g. Unity Play Mode.

Logged errors: the lab reads the game's stdout/stderr per run. Defaults match C#/Unity exceptions
(`SomethingException:`) and Godot `ERROR:` / `SCRIPT ERROR:` / `USER ERROR:` lines. Unity needs `-logFile -`
in `args` to print its log to stdout. Override with `bridge.errorPatterns` / `bridge.ignoreErrors` (regex strings);
`bridge.logSettleMs` (default 15) is how long to wait for late output after a run.

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

Additive in 0.2: `check` (`{status: "pass"|"fail", baselineRun, regressions, improved, rows}` when the run came
from `lab.js check`, else null) and `issues[].traces` (paths of saved failing runs).

Consumers (e.g. game-studio) read `suggestedTicket` to create tickets. Breaking changes bump the
`contract` version; additive fields do not.

## 3. Trace — `<game>/.playtest/runs/<RUN>/traces/<policy>-s<seed>-<kind>.json`

```jsonc
{ "trace": "playtest-trace/1", "game": "CoinLine", "policy": "careful", "seed": 4,
  "dt": 0.0167, "decisionEvery": 6, "maxSteps": 2400,
  "outcome": { "kind": "crash|invariant|error|softlock", "message": "…", "id": "…", "step": 84 },
  "actions": [[0, {"move": 1}], [42, {"move": -1}]] }   // [step, action]; only changes are stored
```

`lab.js replay <trace>` feeds the same actions at the same steps with the same seed, and says whether the same
failure happens (same kind, and same invariant id or error message, ignoring numbers). `--expect fixed` exits 1
while it still reproduces, which makes a good acceptance check for the fix ticket.

## 4. Baseline — `<game>/.playtest/baseline.json` (commit it)

`lab.js baseline set` stores the current run's per-policy failure counts and metric means, and the seeds used.
`lab.js check` reruns the bots on those seeds in a new run, compares, writes `check.json`, and exits 1 on a regression:

- a policy failing more often than before, for any kind, always fails;
- a metric mean that moved more than the tolerance fails, unless it moved the `better` way.

Tolerances live in `.playtest/config.json`:
```jsonc
"check": { "tolerance": 0.1, "abs": 0,
           "metrics": { "score": { "better": "higher" }, "careful.died": { "max": 0.1 }, "survivedSeconds": { "ignore": true } } }
```
