namespace Collect.Core.Dtos;

/// <summary>
/// A group of tags that share the same type.
/// </summary>
public class TagGroupDto
{
    public string? Type { get; set; }
    public int Total { get; set; }
    public List<TagCountDto> Tags { get; set; } = new();
}

/// <summary>
/// A tag value with its usage count.
/// </summary>
public class TagCountDto
{
    public string Value { get; set; } = string.Empty;
    public int Count { get; set; }
}
