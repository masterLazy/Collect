using Collect.Core.Dtos;
using Collect.Core.Models;

namespace Collect.Core.Services;

/// <summary>
/// Provides tag query operations by aggregating from the in-memory asset store.
/// </summary>
public class TagService : ITagService
{
    private readonly IAssetService _assetService;
    private readonly ILibraryService _libraryService;

    public TagService(IAssetService assetService, ILibraryService libraryService)
    {
        _assetService = assetService;
        _libraryService = libraryService;
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
            .ToList();

        // Apply category order if available
        var categoryOrder = await _libraryService.GetCategoryOrderAsync();
        allGroups = SortGroupsByOrder(allGroups, categoryOrder);

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

    /// <summary>
    /// Sort tag groups by a custom category order.
    /// Groups with a type in <paramref name="categoryOrder"/> are sorted by their position.
    /// Groups not in the order list come after, sorted alphabetically.
    /// The uncategorized group (type=null) always comes last.
    /// </summary>
    private static List<TagGroupDto> SortGroupsByOrder(List<TagGroupDto> groups, List<string>? categoryOrder)
    {
        if (categoryOrder == null || categoryOrder.Count == 0)
        {
            return groups.OrderBy(g => g.Type ?? "zzz").ToList();
        }

        var orderIndex = categoryOrder
            .Select((name, index) => (name, index))
            .ToDictionary(x => x.name, x => x.index, StringComparer.OrdinalIgnoreCase);

        return groups
            .OrderBy(g => g.Type == null ? 1 : 0) // uncategorized last
            .ThenBy(g => g.Type != null && orderIndex.TryGetValue(g.Type, out var idx) ? idx : int.MaxValue)
            .ThenBy(g => g.Type ?? "") // alphabetical for uncategorized ones
            .ToList();
    }
}
