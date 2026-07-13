namespace Collect.Core.Dtos;

/// <summary>
/// Summary response for an asset in list views.
/// </summary>
public class AssetDto
{
    public string Id { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string MimeType { get; set; } = string.Empty;
    public long FileSize { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public string ThumbnailUrl { get; set; } = string.Empty;
    public DateTime ImportedAt { get; set; }
    public DateTime? LastModified { get; set; }
}
