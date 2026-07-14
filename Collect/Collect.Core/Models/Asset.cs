namespace Collect.Core.Models;

/// <summary>
/// Represents a multimedia asset in the library.
/// Asset state is derived entirely from the filesystem; no JSON persistence.
/// </summary>
public class Asset
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string FileName { get; set; } = string.Empty;
    public string RelativePath { get; set; } = string.Empty;
    public long FileSize { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public string MimeType { get; set; } = string.Empty;
    public List<AssetTag> Tags { get; set; } = new();
    public DateTime ImportedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastModified { get; set; }
}

/// <summary>
/// A tag attached to an asset, optionally grouped by a type (e.g. "画师", "角色").
/// </summary>
public class AssetTag
{
    public string? Type { get; set; }
    public string Value { get; set; } = string.Empty;
}
