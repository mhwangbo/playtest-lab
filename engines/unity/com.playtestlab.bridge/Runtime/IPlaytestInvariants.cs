namespace PlaytestLab
{
    /// <summary>
    /// Optional: implement next to <see cref="IPlaytestTarget"/> to declare rules that must always hold
    /// (hp never negative, player inside the level, coins conserved...). The bridge checks them after every
    /// reset and step; a broken rule stops the bot run, becomes a bug finding and is saved as a replayable trace.
    /// </summary>
    public interface IPlaytestInvariants
    {
        /// <summary>
        /// JSON array of broken rules, or null / "" / "[]" when all hold. Items are strings (the rule id) or
        /// objects {"id":"hp-non-negative","message":"hp is -3","severity":"P1"}.
        /// </summary>
        string InvariantsJson();
    }
}
