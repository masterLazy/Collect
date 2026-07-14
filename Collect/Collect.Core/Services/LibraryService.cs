using System.Collections.Concurrent;
using System.Text.Json;
using Collect.Core.Models;

namespace Collect.Core.Services;

/// <summary>
/// Manages library initialization and metadata persistence.
/// The library path is stored in-memory and in .collect/library.json on disk.
/// Supports encrypted libraries with AES-256-GCM (key held in memory after unlock).
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

    private readonly IEncryptionService _encryptionService;

    private string? _libraryPath;
    private readonly ConcurrentDictionary<string, UnlockSession> _sessions = new();
    // All keys ever created — never cleared, used for repair decryption
    private readonly List<byte[]> _allSessionKeys = new();

    private record UnlockSession(byte[] EncryptionKey, DateTime UnlockedAt);

    public LibraryService(IEncryptionService encryptionService)
    {
        _encryptionService = encryptionService;
    }

    public async Task<LibraryInfo> InitializeAsync(string path, string? name = null, string? password = null)
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
                // Clear sessions when switching to a non-encrypted library
                if (!existingInfo.IsEncrypted)
                    _sessions.Clear();

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

        // Handle optional encryption
        if (!string.IsNullOrEmpty(password))
        {
            var (salt, verificationHash, encryptionKey) = _encryptionService.CreateKey(password);
            info.IsEncrypted = true;
            info.Salt = Convert.ToBase64String(salt);
            info.VerificationHash = Convert.ToBase64String(verificationHash);
            var token = Guid.NewGuid().ToString("N");
            _sessions[token] = new UnlockSession(encryptionKey, DateTime.UtcNow);
            _allSessionKeys.Add(encryptionKey);
        }

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
                // If encrypted and no valid session, clear sessions
                if (currentInfo.IsEncrypted)
                {
                    if (!IsLibraryUnlocked())
                        _sessions.Clear();
                }
                else
                {
                    _sessions.Clear();
                }

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

        var info = ReadInfoFromPath(entry.Path) ?? entry;

        // If encrypted within 10-min window, keep the key; otherwise clear it
        if (info.IsEncrypted)
        {
            if (!IsLibraryUnlocked())
                _sessions.Clear();
        }
        else
        {
            _sessions.Clear();
        }

        return info;
    }

    // ──────────────────────────────────────────────
    //  Encryption Support
    // ──────────────────────────────────────────────

    /// <summary>
    /// Unlock an encrypted library by verifying the password against the stored salt and hash.
    /// On success, a session token is created and the encryption key is held in memory
    /// for 10 minutes. Returns (info, token).
    /// </summary>
    public async Task<(LibraryInfo? Info, string? Token)> UnlockAsync(string password)
    {
        var info = await GetInfoAsync();
        if (info is null || !info.IsEncrypted)
            return (info, null)!;

        if (string.IsNullOrEmpty(info.Salt) || string.IsNullOrEmpty(info.VerificationHash))
            return (null, null!);

        var salt = Convert.FromBase64String(info.Salt);
        var storedHash = Convert.FromBase64String(info.VerificationHash);

        var (valid, encryptionKey) = _encryptionService.VerifyPassword(password, salt, storedHash);
        if (!valid || encryptionKey is null)
            return (null, null!);

        var token = Guid.NewGuid().ToString("N");
        _sessions[token] = new UnlockSession(encryptionKey, DateTime.UtcNow);
        _allSessionKeys.Add(encryptionKey);
        return (info, token);
    }

    /// <summary>
    /// Check if the current library is unlocked and get remaining unlock time.
    /// When token is provided, checks that specific session; otherwise checks any valid session.
    /// </summary>
    public Task<(bool Unlocked, int RemainingSeconds)> GetUnlockStatusAsync(string? token = null)
    {
        if (token is not null)
        {
            if (!_sessions.TryGetValue(token, out var session))
                return Task.FromResult((false, 0));
            var elapsed = DateTime.UtcNow - session.UnlockedAt;
            var remaining = (int)(600 - elapsed.TotalSeconds);
            if (remaining <= 0)
            {
                _sessions.TryRemove(token, out _);
                return Task.FromResult((false, 0));
            }
            return Task.FromResult((true, remaining));
        }

        // Check any valid session (backward compatibility)
        foreach (var kvp in _sessions)
        {
            var elapsed = DateTime.UtcNow - kvp.Value.UnlockedAt;
            var remaining = (int)(600 - elapsed.TotalSeconds);
            if (remaining > 0)
                return Task.FromResult((true, remaining));
        }
        return Task.FromResult((false, 0));
    }

    /// <summary>
    /// Check if the current library is encrypted by reading its metadata.
    /// </summary>
    public bool IsEncryptedLibrary()
    {
        var info = ReadInfoFromPath(_libraryPath ?? "");
        return info?.IsEncrypted ?? false;
    }

    /// <summary>
    /// Check if the encryption key is available (library is unlocked for this session).
    /// When token is provided, checks that specific session; otherwise checks any valid session.
    /// Key persists for 10 minutes in memory after unlock.
    /// </summary>
    public bool IsLibraryUnlocked(string? token = null)
    {
        if (token is not null)
        {
            if (!_sessions.TryGetValue(token, out var session)) return false;
            if (DateTime.UtcNow - session.UnlockedAt > TimeSpan.FromMinutes(10))
            {
                _sessions.TryRemove(token, out _);
                return false;
            }
            return true;
        }

        // Check any valid session (backward compatibility)
        foreach (var kvp in _sessions)
        {
            if (DateTime.UtcNow - kvp.Value.UnlockedAt <= TimeSpan.FromMinutes(10))
                return true;
        }
        return false;
    }

    /// <summary>
    /// Get the current encryption key, or null if not available.
    /// When token is provided, returns the key for that specific session;
    /// otherwise returns the first valid key (backward compatibility).
    /// </summary>
    public byte[]? GetEncryptionKey(string? token = null)
    {
        if (token is not null)
        {
            if (_sessions.TryGetValue(token, out var session))
                return session.EncryptionKey;
            return null;
        }

        // Return first valid key (backward compatibility)
        foreach (var kvp in _sessions)
        {
            if (DateTime.UtcNow - kvp.Value.UnlockedAt <= TimeSpan.FromMinutes(10))
                return kvp.Value.EncryptionKey;
        }
        return null;
    }

    /// <summary>
    /// Lock the library by clearing the encryption key from memory.
    /// When token is provided, only that session is locked; otherwise all sessions are cleared.
    /// The library remains the current library, but asset access requires re-unlock.
    /// </summary>
    public void LockLibrary(string? token = null)
    {
        if (token is not null)
            _sessions.TryRemove(token, out _);
        else
            _sessions.Clear();
    }
    /// <summary>
    /// Get all encryption keys that have been created in this session (for repair decryption).
    /// </summary>
    public IEnumerable<byte[]> GetAllKnownKeys() => _allSessionKeys;
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
            existing.IsEncrypted = info.IsEncrypted;
            if (!info.IsEncrypted)
            {
                existing.Salt = null;
                existing.VerificationHash = null;
            }
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
