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

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif"
    };

    private string? _libraryPath;

    public async Task<LibraryInfo> InitializeAsync(string path, string? name = null)
    {
        var collectDir = Path.Combine(path, ".collect");
        var thumbnailsDir = Path.Combine(collectDir, "thumbnails");
        Directory.CreateDirectory(thumbnailsDir);

        var infoPath = Path.Combine(collectDir, "library.json");

        LibraryInfo info;

        // Check if this path already has a library
        if (File.Exists(infoPath))
        {
            // Load existing library - don't overwrite settings
            var json = await File.ReadAllTextAsync(infoPath);
            var existingInfo = JsonSerializer.Deserialize<LibraryInfo>(json, JsonOptions);
            if (existingInfo is not null)
            {
                existingInfo.Path = path; // ensure path is up to date
                // Ensure existing library has an Id (backfill for older libraries)
                if (string.IsNullOrEmpty(existingInfo.Id))
                {
                    existingInfo.Id = Guid.NewGuid().ToString("N");
                    await File.WriteAllTextAsync(infoPath, JsonSerializer.Serialize(existingInfo, JsonOptions));
                }
                _libraryPath = path;

                // Register this library
                await RegisterLibraryAsync(existingInfo);
                return existingInfo;
            }
        }

        // New library - create fresh
        info = new LibraryInfo
        {
            Id = Guid.NewGuid().ToString("N"),
            Version = 1,
            Name = name ?? Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)),
            Path = path,
            CreatedAt = DateTime.UtcNow,
            AssetCount = 0
        };
        await File.WriteAllTextAsync(infoPath, JsonSerializer.Serialize(info, JsonOptions));

        _libraryPath = path;

        // Register this library
        await RegisterLibraryAsync(info);
        return info;
    }

    public Task<LibraryInfo?> CheckPathAsync(string path)
    {
        try
        {
            var infoPath = Path.Combine(path, ".collect", "library.json");
            if (!File.Exists(infoPath))
                return Task.FromResult<LibraryInfo?>(null);

            var json = File.ReadAllText(infoPath);
            var info = JsonSerializer.Deserialize<LibraryInfo>(json, JsonOptions);

            if (info is not null)
                info.Path = path;

            return Task.FromResult(info);
        }
        catch
        {
            return Task.FromResult<LibraryInfo?>(null);
        }
    }

    public async Task<LibraryInfo?> GetInfoAsync()
    {
        if (_libraryPath is null)
            return null;

        var infoPath = Path.Combine(_libraryPath, ".collect", "library.json");
        if (!File.Exists(infoPath))
            return null;

        var json = await File.ReadAllTextAsync(infoPath);
        var info = JsonSerializer.Deserialize<LibraryInfo>(json, JsonOptions);

        if (info is not null)
        {
            // Count image files on disk (excluding .collect directory)
            var collectDir = Path.Combine(_libraryPath, ".collect");
            info.AssetCount = Directory.EnumerateFiles(_libraryPath, "*.*", SearchOption.AllDirectories)
                .Count(f => !f.StartsWith(collectDir, StringComparison.OrdinalIgnoreCase)
                    && ImageExtensions.Contains(Path.GetExtension(f)));

            // Persist the count back to library.json and the registry
            await File.WriteAllTextAsync(infoPath, JsonSerializer.Serialize(info, JsonOptions));
            await RegisterLibraryAsync(info);
        }

        return info;
    }

    public string? GetLibraryPath() => _libraryPath;

    public Task<DirectoryNode> GetDirectoryTreeAsync()
    {
        if (_libraryPath is null)
            return Task.FromResult(new DirectoryNode());

        var collectDir = Path.Combine(_libraryPath, ".collect");

        var root = BuildDirectoryNode(_libraryPath, _libraryPath, collectDir);
        return Task.FromResult(root);
    }

    private static DirectoryNode BuildDirectoryNode(string absolutePath, string rootPath, string collectDir)
    {
        var relative = Path.GetRelativePath(rootPath, absolutePath);
        var node = new DirectoryNode
        {
            Name = Path.GetFileName(absolutePath),
            Path = relative == "." ? "" : relative,
            AssetCount = Directory.EnumerateFiles(absolutePath, "*.*", SearchOption.TopDirectoryOnly)
                .Count(f => ImageExtensions.Contains(Path.GetExtension(f))),
            Children = new List<DirectoryNode>()
        };

        foreach (var dir in Directory.GetDirectories(absolutePath))
        {
            if (string.Equals(dir, collectDir, StringComparison.OrdinalIgnoreCase))
                continue;

            var child = BuildDirectoryNode(dir, rootPath, collectDir);
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

    public Task<string> RenameDirectoryAsync(string oldRelativePath, string newName)
    {
        if (_libraryPath is null)
            throw new InvalidOperationException("Library not initialized.");

        // Validate no .. or .collect
        if (oldRelativePath.Contains("..") || newName.Contains(".."))
            throw new ArgumentException("Path must not contain '..'.");

        if (newName.StartsWith(".collect", StringComparison.OrdinalIgnoreCase) ||
            oldRelativePath.StartsWith(".collect", StringComparison.OrdinalIgnoreCase) ||
            oldRelativePath.Split('/', '\\').First().Equals(".collect", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Cannot rename .collect directory.");

        var oldFullPath = Path.Combine(_libraryPath, oldRelativePath);

        if (!Directory.Exists(oldFullPath))
            throw new DirectoryNotFoundException($"Directory not found: {oldRelativePath}");

        var parentDir = Path.GetDirectoryName(oldFullPath)!;
        var newFullPath = Path.Combine(parentDir, newName);

        if (Directory.Exists(newFullPath) || File.Exists(newFullPath))
            throw new IOException($"A file or directory named '{newName}' already exists in the target location.");

        Directory.Move(oldFullPath, newFullPath);

        var parentRelative = Path.GetDirectoryName(oldRelativePath.Replace('\\', '/'))?.Replace('\\', '/') ?? "";
        var newRelativePath = string.IsNullOrEmpty(parentRelative)
            ? newName
            : $"{parentRelative}/{newName}";

        return Task.FromResult(newRelativePath);
    }

    public Task<bool> DeleteDirectoryAsync(string relativePath)
    {
        if (_libraryPath is null)
            throw new InvalidOperationException("Library not initialized.");

        // Validate no .. or .collect
        if (relativePath.Contains(".."))
            throw new ArgumentException("Relative path must not contain '..'.");

        if (string.IsNullOrWhiteSpace(relativePath))
            throw new ArgumentException("Relative path must not be empty.");

        if (relativePath.StartsWith(".collect", StringComparison.OrdinalIgnoreCase) ||
            relativePath.Split('/', '\\').First().Equals(".collect", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Cannot delete .collect directory.");

        var fullPath = Path.Combine(_libraryPath, relativePath);

        if (!Directory.Exists(fullPath))
            return Task.FromResult(false);

        var parentPath = Path.GetDirectoryName(fullPath)!;

        // Move all files to parent
        foreach (var file in Directory.EnumerateFiles(fullPath))
        {
            var destFileName = Path.Combine(parentPath, Path.GetFileName(file));
            // If a file with the same name exists in the parent, add a suffix
            if (File.Exists(destFileName))
            {
                var nameWithoutExt = Path.GetFileNameWithoutExtension(file);
                var ext = Path.GetExtension(file);
                var counter = 1;
                do
                {
                    destFileName = Path.Combine(parentPath, $"{nameWithoutExt}_{counter}{ext}");
                    counter++;
                } while (File.Exists(destFileName));
            }
            File.Move(file, destFileName);
        }

        // Move all subdirectories to parent
        foreach (var subDir in Directory.EnumerateDirectories(fullPath))
        {
            var destDirName = Path.Combine(parentPath, Path.GetFileName(subDir));
            if (Directory.Exists(destDirName))
            {
                // If a directory with the same name exists, merge contents recursively
                MergeDirectory(subDir, destDirName);
            }
            else
            {
                Directory.Move(subDir, destDirName);
            }
        }

        // Delete the now-empty directory
        Directory.Delete(fullPath);

        return Task.FromResult(true);
    }

    /// <summary>
    /// Recursively moves contents of sourceDir into destDir (both must exist).
    /// </summary>
    private static void MergeDirectory(string sourceDir, string destDir)
    {
        foreach (var file in Directory.EnumerateFiles(sourceDir))
        {
            var destFile = Path.Combine(destDir, Path.GetFileName(file));
            if (File.Exists(destFile))
            {
                var nameWithoutExt = Path.GetFileNameWithoutExtension(file);
                var ext = Path.GetExtension(file);
                var counter = 1;
                do
                {
                    destFile = Path.Combine(destDir, $"{nameWithoutExt}_{counter}{ext}");
                    counter++;
                } while (File.Exists(destFile));
            }
            File.Move(file, destFile);
        }

        foreach (var subDir in Directory.EnumerateDirectories(sourceDir))
        {
            var destSubDir = Path.Combine(destDir, Path.GetFileName(subDir));
            if (Directory.Exists(destSubDir))
            {
                MergeDirectory(subDir, destSubDir);
            }
            else
            {
                Directory.Move(subDir, destSubDir);
            }
        }

        Directory.Delete(sourceDir);
    }

    // ──────────────────────────────────────────────
    //  Libraries Registry
    // ──────────────────────────────────────────────

    private static string LibrariesRegistryPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Collect",
        "libraries.json");

    public async Task<List<LibraryInfo>> GetLibrariesAsync()
    {
        var filePath = LibrariesRegistryPath;
        if (!File.Exists(filePath))
            return new List<LibraryInfo>();

        var json = await File.ReadAllTextAsync(filePath);
        var libraries = JsonSerializer.Deserialize<List<LibraryInfo>>(json, JsonOptions);
        return libraries ?? new List<LibraryInfo>();
    }

    /// <summary>
    /// Find a library by exact ID or by prefix (short ID). Returns null if no match.
    /// For prefix matching, the first match wins. If prefix matches multiple, prefers exact.
    /// </summary>
    private static LibraryInfo? FindLibraryById(List<LibraryInfo> libraries, string id)
    {
        // 1. Exact match
        var exact = libraries.FirstOrDefault(l => l.Id == id);
        if (exact is not null)
            return exact;

        // 2. Prefix match (short ID like "eed3d01f")
        var matches = libraries.Where(l => l.Id.StartsWith(id, StringComparison.OrdinalIgnoreCase)).ToList();
        return matches.Count == 1 ? matches[0] : null;
    }

    public async Task<bool> RemoveLibraryAsync(string id)
    {
        var filePath = LibrariesRegistryPath;
        if (!File.Exists(filePath))
            return false;

        var json = await File.ReadAllTextAsync(filePath);
        var libraries = JsonSerializer.Deserialize<List<LibraryInfo>>(json, JsonOptions);
        if (libraries is null)
            return false;

        var match = FindLibraryById(libraries, id);
        if (match is null)
            return false;

        var removed = libraries.Remove(match);
        if (removed)
            await File.WriteAllTextAsync(filePath, JsonSerializer.Serialize(libraries, JsonOptions));

        return removed;
    }

    /// <summary>
    /// Lightweight read of library.json from a given path — no file scanning, no registry writes.
    /// </summary>
    private static LibraryInfo? ReadInfoFromPath(string path)
    {
        var infoPath = Path.Combine(path, ".collect", "library.json");
        if (!File.Exists(infoPath))
            return null;
        try
        {
            var json = File.ReadAllText(infoPath);
            var info = JsonSerializer.Deserialize<LibraryInfo>(json, JsonOptions);
            if (info is not null)
                info.Path = path;
            return info;
        }
        catch
        {
            return null;
        }
    }

    public async Task<LibraryInfo?> LoadByIdAsync(string id)
    {
        // 1. Check in-memory library first (lightweight read, no side effects)
        if (_libraryPath is not null)
        {
            var currentInfo = ReadInfoFromPath(_libraryPath);
            if (currentInfo is not null &&
                (currentInfo.Id == id || currentInfo.Id.StartsWith(id, StringComparison.OrdinalIgnoreCase)))
            {
                return currentInfo;
            }
        }

        // 2. Fall back to registry lookup
        var libraries = await GetLibrariesAsync();
        var entry = FindLibraryById(libraries, id);
        if (entry is null)
            return null;

        // 3. Set in-memory path and return lightweight info
        _libraryPath = entry.Path;
        return ReadInfoFromPath(entry.Path) ?? entry;
    }

    private async Task RegisterLibraryAsync(LibraryInfo info)
    {
        var filePath = LibrariesRegistryPath;
        var dir = Path.GetDirectoryName(filePath)!;
        Directory.CreateDirectory(dir);

        var libraries = await GetLibrariesAsync();
        var existing = libraries.FirstOrDefault(l => l.Id == info.Id);
        if (existing is not null)
        {
            // Update existing entry
            existing.Name = info.Name;
            existing.Path = info.Path;
            existing.AssetCount = info.AssetCount;
        }
        else
        {
            libraries.Add(info);
        }

        await File.WriteAllTextAsync(filePath, JsonSerializer.Serialize(libraries, JsonOptions));
    }

    public async Task UpdateAssetCountAsync(int count)
    {
        var infoPath = GetInfoPath();
        if (infoPath is null) return;

        if (!File.Exists(infoPath))
            return;

        var json = await File.ReadAllTextAsync(infoPath);
        var info = JsonSerializer.Deserialize<LibraryInfo>(json, JsonOptions);
        if (info is null) return;

        info.AssetCount = count;
        await File.WriteAllTextAsync(infoPath, JsonSerializer.Serialize(info, JsonOptions));

        // Also update the registry entry
        await RegisterLibraryAsync(info);
    }

    public async Task<List<string>?> GetCategoryOrderAsync()
    {
        var infoPath = GetInfoPath();
        if (infoPath is null) return null;

        if (!File.Exists(infoPath))
            return null;

        var json = await File.ReadAllTextAsync(infoPath);
        var info = JsonSerializer.Deserialize<LibraryInfo>(json, JsonOptions);
        return info?.CategoryOrder;
    }

    public async Task SetCategoryOrderAsync(List<string> order)
    {
        var infoPath = GetInfoPath();
        if (infoPath is null)
            throw new InvalidOperationException("Library not initialized.");

        if (!File.Exists(infoPath))
            throw new InvalidOperationException("Library metadata file not found.");

        var json = await File.ReadAllTextAsync(infoPath);
        var info = JsonSerializer.Deserialize<LibraryInfo>(json, JsonOptions);
        if (info is null)
            throw new InvalidOperationException("Failed to read library metadata.");

        info.CategoryOrder = order;
        await File.WriteAllTextAsync(infoPath, JsonSerializer.Serialize(info, JsonOptions));
    }

    private string? GetInfoPath()
    {
        if (_libraryPath is null) return null;
        return Path.Combine(_libraryPath, ".collect", "library.json");
    }

    // ──────────────────────────────────────────────
    //  Recent Libraries
    // ──────────────────────────────────────────────

    private static string RecentLibrariesFilePath
        => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Collect",
            "recent.json");

    public Task<List<RecentLibraryEntry>> GetRecentLibrariesAsync()
    {
        var filePath = RecentLibrariesFilePath;
        if (!File.Exists(filePath))
            return Task.FromResult(new List<RecentLibraryEntry>());

        var json = File.ReadAllText(filePath);
        var libraries = JsonSerializer.Deserialize<List<RecentLibraryEntry>>(json, JsonOptions);
        return Task.FromResult(libraries ?? new List<RecentLibraryEntry>());
    }

    public Task SaveRecentLibrariesAsync(List<RecentLibraryEntry> libraries)
    {
        var filePath = RecentLibrariesFilePath;
        var dir = Path.GetDirectoryName(filePath)!;
        Directory.CreateDirectory(dir);

        var json = JsonSerializer.Serialize(libraries, JsonOptions);
        File.WriteAllText(filePath, json);
        return Task.CompletedTask;
    }
}
