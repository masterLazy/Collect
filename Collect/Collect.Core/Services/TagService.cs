using Collect.Core.Dtos;
using Collect.Core.Models;

namespace Collect.Core.Services;

/// <summary>
/// Provides tag query operations by aggregating from the in-memory asset store.
/// </summary>
public class TagService : ITagService
{
    private readonly IAssetService _assetService;

    public TagService(IAssetService assetService)
    {
        _assetService = assetService;
    }

    public async Task<TagGroupsResponse> GetTagGroupsAsync(int page = 1, int size = 50, string? search = null)
    {
        var assets = await _assetService.GetAllAssetsAsync();

        // Aggregate tags: count how many assets have each (type, value) pair
        var tagCounts = new Dictionary<(string? Type, string Value), int>();

        foreach (var asset in assets)
        {
            foreach (var tag in asset.Tags)
            {
                var key = (tag.Type, tag.Value);
                tagCounts.TryGetValue(key, out var count);
                tagCounts[key] = count + 1;
            }
        }

        // Apply search filter if provided
        IEnumerable<KeyValuePair<(string? Type, string Value), int>> filtered = tagCounts;
        if (!string.IsNullOrWhiteSpace(search))
        {
            var searchLower = search.ToLowerInvariant();
            filtered = tagCounts.Where(kvp => kvp.Key.Value.Contains(searchLower, StringComparison.OrdinalIgnoreCase));
        }

        // Group by type
        var allGroups = filtered
            .GroupBy(kvp => kvp.Key.Type, kvp => new TagCountDto { Value = kvp.Key.Value, Count = kvp.Value })
            .Select(g => new TagGroupDto
            {
                Type = g.Key,
                Total = g.Count(),
                Tags = g.OrderByDescending(t => t.Count).ToList()
            })
            .OrderBy(g => g.Type ?? "zzz") // untyped tags last
            .ToList();

        var totalGroups = allGroups.Count;

        // Apply pagination to groups
        var pagedGroups = allGroups
            .Skip((page - 1) * size)
            .Take(size)
            .Select(g => new TagGroupDto
            {
                Type = g.Type,
                Total = g.Total,
                Tags = g.Tags
            })
            .ToList();

        return new TagGroupsResponse
        {
            Groups = pagedGroups,
            TotalGroups = totalGroups
        };
    }
}
