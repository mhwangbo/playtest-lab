namespace PlaytestLab
{
    /// <summary>
    /// Implement on one MonoBehaviour in your game so Playtest Lab bots can play it.
    /// Register it with <see cref="PlaytestBridge.Register"/> in OnEnable and
    /// <see cref="PlaytestBridge.Unregister"/> in OnDisable (or let the bridge find it).
    /// All methods are called on the main thread.
    /// </summary>
    public interface IPlaytestTarget
    {
        /// <summary>False while loading/resetting; the bridge waits for true before answering reset.</summary>
        bool IsReady { get; }

        /// <summary>True when the session (level, run, night…) is over.</summary>
        bool IsDone { get; }

        /// <summary>Start a fresh session skipping menus. Seed ALL gameplay randomness from <paramref name="seed"/>.</summary>
        void ResetGame(int seed);

        /// <summary>Apply the bot's input. JSON shape is defined by your adapter (e.g. {"move":1,"jump":true}).
        /// The action stays in effect until the next call.</summary>
        void ApplyAction(string actionJson);

        /// <summary>Compact JSON object of what a player could know (positions, hp, score…). JsonUtility.ToJson is fine.</summary>
        string ObserveJson();

        /// <summary>Flat JSON object of numbers to aggregate across runs, e.g. {"score":12,"deaths":1}.</summary>
        string MetricsJson();
    }
}
