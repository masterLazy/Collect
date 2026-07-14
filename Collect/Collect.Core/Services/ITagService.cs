using Collect.Core.Dtos;

namespace Collect.Core.Services;

/// <summary>
/// Tag query operations.
/// </summary>
public interface ITagService
{
    /// <summary>
    /// Get all tags grouped by type, with counts, with pagination and optional search.
    /// </summary>
    Task<TagGroupsResponse> GetTagGroupsAsync(int page = 1, int size = 50, string? search = null);
}
