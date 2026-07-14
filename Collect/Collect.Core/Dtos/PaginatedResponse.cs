namespace Collect.Core.Dtos;

/// <summary>
/// Generic paginated response wrapper.
/// </summary>
public class PaginatedResponse<T>
{
    public List<T> Items { get; set; } = new();
    public int Total { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
}
