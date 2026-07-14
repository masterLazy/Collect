namespace Collect.Core.Models;

/// <summary>
/// Aggregated tag information showing how many assets share a tag.
/// </summary>
public class TagInfo
{
    public string? Type { get; set; }
    public string Value { get; set; } = string.Empty;
    public int Count { get; set; }
}
