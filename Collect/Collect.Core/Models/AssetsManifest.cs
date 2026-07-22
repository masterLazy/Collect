using System.Text.Json;

namespace Collect.Core.Models;

/// <summary>
/// Persisted in .collect/assets.json. Tracks all known asset IDs for
/// efficient add/removed detection and orphaned thumbnail cleanup.
/// </summary>
public class AssetsManifest
{
    public List<string> AssetIds { get; set; } = new();

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static AssetsManifest Load(string libraryPath)
    {
        var path = Path.Combine(libraryPath, ".collect", "assets.json");
        if (!File.Exists(path)) return new AssetsManifest();
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<AssetsManifest>(json) ?? new AssetsManifest();
        }
        catch
        {
            return new AssetsManifest();
        }
    }

    public void Save(string libraryPath)
    {
        var path = Path.Combine(libraryPath, ".collect", "assets.json");
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);
        File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOptions));
    }
}
