namespace Collect.Core.Models;

/// <summary>
/// Metadata about a library stored in .collect/library.json.
/// </summary>
public class LibraryInfo
{
    public int Version { get; set; } = 1;
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int AssetCount { get; set; }
    public bool UseMd5 { get; set; }
    public bool ParseTags { get; set; } = true;
    public string UncategorizedDirName { get; set; } = "Uncategorized";
}
