using System.Text.Json;

namespace Collect.Core.Models;

/// <summary>
/// Persisted in .collect/palettes.json. Maps asset IDs to their computed
/// <see cref="ColorPalette"/> results, enabling lazy on-demand palette
/// computation and caching across sessions.
/// </summary>
public class PalettesStore
{
    /// <summary>
    /// Maps asset IDs to their computed color palettes.
    /// </summary>
    public Dictionary<string, ColorPalette> Palettes { get; set; } = new();

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    /// <summary>
    /// Load the palettes store from the library's .collect directory.
    /// Returns an empty store if the file does not exist or fails to parse.
    /// </summary>
    public static PalettesStore Load(string libraryPath)
    {
        var path = Path.Combine(libraryPath, ".collect", "palettes.json");
        if (!File.Exists(path)) return new PalettesStore();
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<PalettesStore>(json) ?? new PalettesStore();
        }
        catch
        {
            return new PalettesStore();
        }
    }

    /// <summary>
    /// Save the palettes store to the library's .collect directory.
    /// Creates the directory if it does not exist.
    /// </summary>
    public void Save(string libraryPath)
    {
        var path = Path.Combine(libraryPath, ".collect", "palettes.json");
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);
        File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOptions));
    }
}
