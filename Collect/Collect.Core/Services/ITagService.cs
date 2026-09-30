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

    /// <summary>
    /// Get every tag grouped by type, each with a randomly sampled asset attached,
    /// for the Explore page. <paramref name="maxTags"/> caps the response, keeping
    /// the most-used tags first.
    /// </summary>
    Task<TagExploreResponse> GetTagExploreAsync(int maxTags = 400, string? search = null);
}
