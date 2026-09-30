namespace Collect.Core.Dtos;

/// <summary>Result of a boost attempt (see POST /api/assets/{id}/boost).</summary>
public class BoostResultDto
{
    public string AssetId { get; set; } = string.Empty;

    /// <summary>Total number of boosts for this asset.</summary>
    public int Count { get; set; }

    /// <summary>True when the asset has already been boosted today.</summary>
    public bool BoostedToday { get; set; }

    /// <summary>
    /// True when this call was rejected by the once-per-day rule
    /// (the count is unchanged in that case).
    /// </summary>
    public bool AlreadyBoosted { get; set; }

    /// <summary>
    /// True when the stored boost state actually changed. False for a call that
    /// was a no-op (already boosted today, nothing to undo, or no boosts to clear).
    /// </summary>
    public bool Changed { get; set; }
}
