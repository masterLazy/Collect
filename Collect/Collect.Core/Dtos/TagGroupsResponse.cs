namespace Collect.Core.Dtos;

/// <summary>
/// Paginated response for tag groups.
/// </summary>
public class TagGroupsResponse
{
    public List<TagGroupDto> Groups { get; set; } = new();
    public int TotalGroups { get; set; }
}
