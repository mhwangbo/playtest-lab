using PlaytestLab;
using UnityEngine;

/// <summary>
/// Tiny 1D sample game for the Playtest Lab Unity bridge: move along a line, grab coins,
/// dodge a hazard that relocates every few seconds. A run lasts <see cref="RunSeconds"/>.
/// </summary>
public sealed class CoinLineGame : MonoBehaviour, IPlaytestTarget, IPlaytestInvariants
{
    private const float LineLength = 20f;
    private const float MoveSpeed = 6f;
    private const float PickupRadius = 0.5f;
    private const float HazardRadius = 0.4f;
    private const float HazardRelocateSeconds = 5f;
    private const float HazardSafeDistance = 3f;
    private const float RunSeconds = 30f;

    [System.Serializable]
    private struct ActionInput { public float move; }

    [System.Serializable]
    private struct Observation { public float x; public float coin; public float hazard; public float timeLeft; public int score; }

    [System.Serializable]
    private struct Metrics { public int score; public int died; public float survivedSeconds; }

    private System.Random _rng = new System.Random(0);
    private float _x;
    private float _coin;
    private float _hazard;
    private float _hazardTimer;
    private float _elapsed;
    private float _move;
    private int _score;
    private bool _died;

    public bool IsReady => true;
    public bool IsDone => _died || _elapsed >= RunSeconds;

    private void OnEnable() => PlaytestBridge.Register(this);
    private void OnDisable() => PlaytestBridge.Unregister(this);

    private void Start() => ResetGame(1);

    private void Update()
    {
        if (IsDone) return;
        float dt = Time.deltaTime;
        _elapsed += dt;
        _x = Mathf.Clamp(_x + _move * MoveSpeed * dt, 0f, LineLength);

        if (Mathf.Abs(_x - _coin) < PickupRadius)
        {
            _score++;
            _coin = RandomPos();
        }

        _hazardTimer -= dt;
        if (_hazardTimer <= 0f) RelocateHazard();
        if (Mathf.Abs(_x - _hazard) < HazardRadius) _died = true;
    }

    /// <summary>Starts a fresh run; all randomness comes from <paramref name="seed"/>.</summary>
    public void ResetGame(int seed)
    {
        _rng = new System.Random(seed);
        _x = LineLength / 2f;
        _elapsed = 0f;
        _score = 0;
        _died = false;
        _move = 0f;
        _coin = RandomPos();
        RelocateHazard();
    }

    public void ApplyAction(string actionJson)
    {
        _move = Mathf.Clamp(JsonUtility.FromJson<ActionInput>(actionJson).move, -1f, 1f);
    }

    public string ObserveJson() => JsonUtility.ToJson(new Observation
    {
        x = _x, coin = _coin, hazard = _hazard, timeLeft = Mathf.Max(0f, RunSeconds - _elapsed), score = _score,
    });

    public string MetricsJson() => JsonUtility.ToJson(new Metrics
    {
        score = _score, died = _died ? 1 : 0, survivedSeconds = _elapsed,
    });

    /// <summary>Rules that must always hold; a broken one becomes a bug finding with a replayable trace.</summary>
    public string InvariantsJson()
    {
        var broken = new System.Collections.Generic.List<string>();
        if (_x < 0f || _x > LineLength) broken.Add("\"player-on-line\"");
        if (_coin < 0f || _coin > LineLength) broken.Add("\"coin-on-line\"");
        return "[" + string.Join(",", broken) + "]";
    }

    private float RandomPos() => (float)_rng.NextDouble() * LineLength;

    private void RelocateHazard()
    {
        do { _hazard = RandomPos(); } while (Mathf.Abs(_hazard - _x) < HazardSafeDistance);
        _hazardTimer = HazardRelocateSeconds;
    }
}
