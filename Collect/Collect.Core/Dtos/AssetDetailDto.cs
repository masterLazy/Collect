using Collect.Core.Models;

namespace Collect.Core.Dtos;

/// <summary>
/// Full detail response for a single asset.
/// </summary>
public class AssetDetailDto
{
    public string Id { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string RelativePath { get; set; } = string.Empty;
    public long FileSize { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public string MimeType { get; set; } = string.Empty;
    public List<AssetTag> Tags { get; set; } = new();
    public string ThumbnailUrl { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public DateTime ImportedAt { get; set; }
    public DateTime? LastModified { get; set; }
}
