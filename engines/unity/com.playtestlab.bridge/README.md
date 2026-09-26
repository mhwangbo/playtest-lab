# Playtest Lab Bridge for Unity

This package lets Playtest Lab bots play a Unity game headless over localhost, using the `playtest-bridge/1` protocol described in `lab/bridge.js`. It does nothing unless the game is launched with `-playtestPort <port>`.

## 1. Add the package

In `Packages/manifest.json`:

```json
"com.playtestlab.bridge": "https://github.com/mhwangbo/playtest-lab.git?path=/engines/unity/com.playtestlab.bridge"
```

## 2. Implement one target

```csharp
using PlaytestLab;
using UnityEngine;

public sealed class MyGamePlaytest : MonoBehaviour, IPlaytestTarget
{
    private void OnEnable() => PlaytestBridge.Register(this);
    private void OnDisable() => PlaytestBridge.Unregister(this);

    public bool IsReady => true;
    public bool IsDone => /* level over */ false;
    public void ResetGame(int seed) { /* reload level, seed ALL randomness from seed */ }
    public void ApplyAction(string json) { var a = JsonUtility.FromJson<MyAction>(json); /* feed into input layer */ }
    public string ObserveJson() => JsonUtility.ToJson(/* what a player can know */ new MyObs());
    public string MetricsJson() => JsonUtility.ToJson(/* flat numbers */ new MyMetrics());
}
```

The target should feed actions into your input layer, not move objects directly. That way bots exercise the same code players do.

Optionally, also implement `IPlaytestInvariants` to declare rules that must always hold. The bridge checks them after
every reset and step; a broken rule stops the bot run and becomes a bug with a replayable trace:

```csharp
public string InvariantsJson() => _hp < 0 ? "[{\"id\":\"hp-non-negative\",\"message\":\"hp is " + _hp + "\"}]" : "[]";
```

## 3. Build and point the lab at it

Make a Windows standalone build. It can run headless with `-batchmode -nographics`. Then in `<game>/.playtest/adapter.mjs`:

```js
export const meta = { name: 'MyGame', dt: 1 / 60, decisionEvery: 6, maxSeconds: 120 };
export const bridge = { command: 'Builds/Win/MyGame.exe', args: ['-batchmode', '-nographics', '-playtestPort', '{PORT}', '-logFile', '-'] };
export const policies = { greedy: (obs) => ({ move: Math.sign(obs.target - obs.x) }) };
export const idleAction = () => ({});
export const randomAction = (obs, rng) => ({ move: rng.pick([-1, 0, 1]) });
```

`-logFile -` sends the player log to stdout, so exceptions the game logs (and survives) become findings too.

Leave out `command` to attach to Play Mode instead: choose **Tools → Playtest Lab → Enable Bridge In Play Mode** and set `bridge.port: 7777`.

## Determinism

- While the bridge is active, time runs on a fixed step (`Time.captureDeltaTime`, 1/60 by default; override with `-playtestDt`).
- The main thread blocks between commands, so no frames run unless the lab asks for them.
- Seed your gameplay RNG in `ResetGame`, and avoid wall-clock time. The same seed with the same actions then gives the same result.
- In the Editor, a wait longer than 5 s lets one frame through, so that the Editor never locks up. Use player builds for exact results.
