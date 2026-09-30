using System.Text.Json;

namespace Collect.Core.Models;

/// <summary>
/// Persisted in .collect/boosts.json. Records how many times each asset has been
/// boosted (up-voted) and the local date of the last boost, which enforces the
/// "one boost per asset per day" rule.
///
/// Kept out of <see cref="Asset"/> because asset state is rebuilt from the
/// filesystem on every scan — boost history has no filesystem representation.
/// </summary>
public class BoostsStore
{
    /// <summary>Maps asset IDs to their boost record.</summary>
    public Dictionary<string, BoostRecord> Boosts { get; set; } = new();

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private static string StorePath(string libraryPath) =>
        Path.Combine(libraryPath, ".collect", "boosts.json");

    /// <summary>
    /// Load the boosts store from the library's .collect directory.
    /// Returns an empty store if the file does not exist or fails to parse.
    /// </summary>
    public static BoostsStore Load(string libraryPath)
    {
        var path = StorePath(libraryPath);
        if (!File.Exists(path)) return new BoostsStore();
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<BoostsStore>(json) ?? new BoostsStore();
        }
        catch
        {
            return new BoostsStore();
        }
    }

    /// <summary>
    /// Save the boosts store to the library's .collect directory.
    /// Creates the directory if it does not exist.
    /// </summary>
    public void Save(string libraryPath)
    {
        var path = StorePath(libraryPath);
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);
        File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOptions));
    }

    /// <summary>Local date key (yyyy-MM-dd) used for the once-per-day rule.</summary>
    public static string TodayKey() => DateTime.Now.ToString("yyyy-MM-dd");
}

/// <summary>Boost state for a single asset.</summary>
public class BoostRecord
{
    public int Count { get; set; }

    /// <summary>Local date (yyyy-MM-dd) of the last boost, or null when never boosted.</summary>
    public string? LastBoostedDate { get; set; }
}
