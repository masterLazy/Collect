using System.Text.Json;
using Collect.Core.Models;

namespace Collect.Core.Services;

/// <summary>
/// Manages library initialization and metadata persistence.
/// The library path is stored in-memory and in .collect/library.json on disk.
/// </summary>
public class LibraryService : ILibraryService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private string? _libraryPath;

    public Task<LibraryInfo> InitializeAsync(string path, string? name = null, bool useMd5 = false, bool parseTags = true)
    {
        var collectDir = Path.Combine(path, ".collect");
        var thumbnailsDir = Path.Combine(collectDir, "thumbnails");
        Directory.CreateDirectory(thumbnailsDir);

        // Create Uncategorized/ directory
        Directory.CreateDirectory(Path.Combine(path, "Uncategorized"));

        var info = new LibraryInfo
        {
            Version = 1,
            Name = name ?? Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)),
            Path = path,
            CreatedAt = DateTime.UtcNow,
            AssetCount = 0,
            UseMd5 = useMd5,
            ParseTags = parseTags
        };

        var infoPath = Path.Combine(collectDir, "library.json");
        File.WriteAllText(infoPath, JsonSerializer.Serialize(info, JsonOptions));

        // Initialize empty asset store
        var assetsPath = Path.Combine(collectDir, "assets.json");
        if (!File.Exists(assetsPath))
        {
            var store = new AssetsStore();
            File.WriteAllText(assetsPath, JsonSerializer.Serialize(store, JsonOptions));
        }

        _libraryPath = path;
        return Task.FromResult(info);
    }

    public Task<LibraryInfo?> GetInfoAsync()
    {
        if (_libraryPath is null)
            return Task.FromResult<LibraryInfo?>(null);

        var infoPath = Path.Combine(_libraryPath, ".collect", "library.json");
        if (!File.Exists(infoPath))
            return Task.FromResult<LibraryInfo?>(null);

        var json = File.ReadAllText(infoPath);
        var info = JsonSerializer.Deserialize<LibraryInfo>(json, JsonOptions);

        // Update asset count from current store
        var assetsPath = Path.Combine(_libraryPath, ".collect", "assets.json");
        if (File.Exists(assetsPath))
        {
            var store = JsonSerializer.Deserialize<AssetsStore>(File.ReadAllText(assetsPath), JsonOptions);
            if (info is not null && store is not null)
                info.AssetCount = store.Assets.Count;
        }

        return Task.FromResult(info);
    }

    public string? GetLibraryPath() => _libraryPath;

    public Task<DirectoryNode> GetDirectoryTreeAsync()
    {
        if (_libraryPath is null)
            return Task.FromResult(new DirectoryNode());

        var collectDir = Path.Combine(_libraryPath, ".collect");

        // Load assets to count by directory
        var assetsPath = Path.Combine(collectDir, "assets.json");
        var assets = new List<Asset>();
        if (File.Exists(assetsPath))
        {
            var store = JsonSerializer.Deserialize<AssetsStore>(File.ReadAllText(assetsPath), JsonOptions);
            if (store is not null)
                assets = store.Assets;
        }

        var root = BuildDirectoryNode(_libraryPath, _libraryPath, collectDir, assets);
        return Task.FromResult(root);
    }

    private static DirectoryNode BuildDirectoryNode(string absolutePath, string rootPath, string collectDir, List<Asset> assets)
    {
        var relative = Path.GetRelativePath(rootPath, absolutePath);
        var relativePrefix = relative == "." ? "" : relative.Replace('\\', '/') + "/";

        var node = new DirectoryNode
        {
            Name = Path.GetFileName(absolutePath),
            Path = relative == "." ? "" : relative,
            AssetCount = string.IsNullOrEmpty(relativePrefix)
                ? assets.Count(a => !a.RelativePath.Contains('/') && !a.RelativePath.Contains('\\'))
                : assets.Count(a => a.RelativePath.StartsWith(relativePrefix, StringComparison.OrdinalIgnoreCase)),
            Children = new List<DirectoryNode>()
        };

        foreach (var dir in Directory.GetDirectories(absolutePath))
        {
            // Exclude .collect directory
            if (string.Equals(dir, collectDir, StringComparison.OrdinalIgnoreCase))
                continue;

            var child = BuildDirectoryNode(dir, rootPath, collectDir, assets);
            node.Children.Add(child);
        }

        // Sort children: folders with assets first, then alphabetical
        node.Children = node.Children
            .OrderByDescending(c => c.AssetCount)
            .ThenBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return node;
    }

    public Task<string> CreateDirectoryAsync(string relativePath)
    {
        if (_libraryPath is null)
            throw new InvalidOperationException("Library not initialized.");

        // Validate path doesn't contain .. or start with .collect
        if (relativePath.Contains(".."))
            throw new ArgumentException("Relative path must not contain '..'.");

        if (relativePath.StartsWith(".collect", StringComparison.OrdinalIgnoreCase) ||
            relativePath.Split('/', '\\').First().Equals(".collect", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Cannot create directory under .collect.");

        var fullPath = Path.Combine(_libraryPath, relativePath);
        Directory.CreateDirectory(fullPath);

        var result = relativePath.Replace('\\', '/');
        return Task.FromResult(result);
    }
}
