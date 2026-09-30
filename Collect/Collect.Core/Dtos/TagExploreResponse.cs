namespace Collect.Core.Dtos;

/// <summary>
/// Tag browser payload for the Explore page: every tag together with a randomly
/// sampled asset, so the UI can render an image tile per tag.
/// </summary>
public class TagExploreResponse
{
    public List<TagExploreGroupDto> Groups { get; set; } = new();

    /// <summary>Total number of tags in the library, before the per-request cap.</summary>
    public int TotalTags { get; set; }

    /// <summary>True when <see cref="TotalTags"/> exceeded the requested cap.</summary>
    public bool Truncated { get; set; }
}

/// <summary>A group of tags sharing the same type (e.g. "画师").</summary>
public class TagExploreGroupDto
{
    /// <summary>The tag type, or null for uncategorized tags.</summary>
    public string? Type { get; set; }

    public List<TagExploreItemDto> Tags { get; set; } = new();
}

/// <summary>A single tag plus the asset sampled to represent it.</summary>
public class TagExploreItemDto
{
    public string Value { get; set; } = string.Empty;

    /// <summary>How many assets carry this tag.</summary>
    public int Count { get; set; }

    public string AssetId { get; set; } = string.Empty;

    /// <summary>Server-relative thumbnail URL, already carrying the libraryId query parameter.</summary>
    public string ThumbnailUrl { get; set; } = string.Empty;

    public int Width { get; set; }

    public int Height { get; set; }
}
