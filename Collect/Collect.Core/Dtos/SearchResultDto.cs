namespace Collect.Core.Dtos;

/// <summary>
/// Result of a search operation with items and metadata.
/// </summary>
public class SearchResultDto
{
    public List<AssetDto> Items { get; set; } = new();
    public int Total { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
}
