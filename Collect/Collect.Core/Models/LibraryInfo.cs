namespace Collect.Core.Models;

/// <summary>
/// Metadata about a library stored in .collect/library.json.
/// </summary>
public class LibraryInfo
{
    public string Id { get; set; } = string.Empty;
    public int Version { get; set; } = 1;
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int AssetCount { get; set; }

    /// <summary>
    /// Custom display order for tag categories (types).
    /// When set, tag groups are sorted by this order instead of alphabetically.
    /// </summary>
    public List<string>? CategoryOrder { get; set; }
}
