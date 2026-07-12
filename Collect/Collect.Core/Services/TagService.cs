using System.Text.Json;
using Collect.Core.Dtos;
using Collect.Core.Models;

namespace Collect.Core.Services;

/// <summary>
/// Provides tag query operations by reading from the assets store.
/// </summary>
public class TagService : ITagService
{
    private readonly ILibraryService _libraryService;

    public TagService(ILibraryService libraryService)
    {
        _libraryService = libraryService;
    }

    public Task<TagGroupsResponse> GetTagGroupsAsync(int page = 1, int size = 50, string? search = null)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null)
            return Task.FromResult(new TagGroupsResponse());

        var assetsPath = Path.Combine(libraryPath, ".collect", "assets.json");
        if (!File.Exists(assetsPath))
            return Task.FromResult(new TagGroupsResponse());

        var json = File.ReadAllText(assetsPath);
        var store = JsonSerializer.Deserialize<AssetsStore>(json);
        if (store is null)
            return Task.FromResult(new TagGroupsResponse());

        // Aggregate tags: count how many assets have each (type, value) pair
        var tagCounts = new Dictionary<(string? Type, string Value), int>();

        foreach (var asset in store.Assets)
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

        return Task.FromResult(new TagGroupsResponse
        {
            Groups = pagedGroups,
            TotalGroups = totalGroups
        });
    }
}
