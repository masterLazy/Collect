using System.Text.Json;
using System.Text.RegularExpressions;
using Collect.Core.Dtos;
using Collect.Core.Models;
using SkiaSharp;

namespace Collect.Core.Services;

/// <summary>
/// Implements asset CRUD, scanning, tag parsing, search, and thumbnail management.
/// Persistence is via a JSON file in .collect/assets.json.
/// </summary>
public partial class AssetService : IAssetService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif"
    };

    [GeneratedRegex(@"^\[(?<type>[^\]]+)\](?<value>.+)$")]
    private static partial Regex TaggedSegmentRegex();

    private readonly ILibraryService _libraryService;
    private readonly IThumbnailService _thumbnailService;

    public AssetService(ILibraryService libraryService, IThumbnailService thumbnailService)
    {
        _libraryService = libraryService;
        _thumbnailService = thumbnailService;
    }

    // ──────────────────────────────────────────────
    //  Tag Parsing
    // ──────────────────────────────────────────────

    /// <summary>
    /// Parse tags from a filename following the convention:
    /// [画师]yaungpeng-人物-伪厚涂 → [{Type:"画师",Value:"yaungpeng"}, {Type:null,Value:"人物"}, ...]
    /// Edge cases:
    /// - No brackets → type=null, value=segment
    /// - [Type]Value → type="Type", value="Value"
    /// - Pure numbers → skip
    /// </summary>
    public static List<AssetTag> ParseTags(string fileNameWithoutExtension)
    {
        var tags = new List<AssetTag>();
        var segments = fileNameWithoutExtension.Split('-', StringSplitOptions.RemoveEmptyEntries);

        foreach (var segment in segments)
        {
            var trimmed = segment.Trim();
            if (string.IsNullOrEmpty(trimmed))
                continue;

            // Skip pure numeric segments (e.g. version numbers, IDs)
            if (trimmed.All(char.IsDigit))
                continue;

            var match = TaggedSegmentRegex().Match(trimmed);
            if (match.Success)
            {
                var value = match.Groups["value"].Value;
                // Skip if the value part is empty or pure numbers
                if (string.IsNullOrEmpty(value) || value.All(char.IsDigit))
                    continue;

                tags.Add(new AssetTag
                {
                    Type = match.Groups["type"].Value,
                    Value = value
                });
            }
            else
            {
                tags.Add(new AssetTag
                {
                    Type = null,
                    Value = trimmed
                });
            }
        }

        return tags;
    }

    // ──────────────────────────────────────────────
    //  Scan
    // ──────────────────────────────────────────────

    public async Task<ScanResult> ScanAsync()
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null)
            throw new InvalidOperationException("Library not initialized. Call /api/library/init first.");

        var collectDir = Path.Combine(libraryPath, ".collect");
        var assetsPath = Path.Combine(collectDir, "assets.json");
        var libraryInfoPath = Path.Combine(collectDir, "library.json");

        // Read library info to get useMd5 and parseTags flags
        var useMd5 = false;
        var parseTags = true;
        if (File.Exists(libraryInfoPath))
        {
            var libInfo = JsonSerializer.Deserialize<LibraryInfo>(await File.ReadAllTextAsync(libraryInfoPath), JsonOptions);
            if (libInfo is not null)
            {
                useMd5 = libInfo.UseMd5;
                parseTags = libInfo.ParseTags;
            }
        }

        var store = File.Exists(assetsPath)
            ? JsonSerializer.Deserialize<AssetsStore>(await File.ReadAllTextAsync(assetsPath), JsonOptions) ?? new AssetsStore()
            : new AssetsStore();

        var existingAssets = new Dictionary<string, Asset>(StringComparer.OrdinalIgnoreCase);
        foreach (var asset in store.Assets)
        {
            existingAssets[asset.RelativePath] = asset;
        }

        var scannedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var added = 0;

        // Recursively find image files
        var files = Directory.EnumerateFiles(libraryPath, "*.*", SearchOption.AllDirectories)
            .Where(f => !f.StartsWith(collectDir, StringComparison.OrdinalIgnoreCase) && ImageExtensions.Contains(Path.GetExtension(f)));

        foreach (var filePath in files)
        {
            // Handle MD5 rename before creating relative path
            var effectivePath = filePath;
            if (useMd5)
            {
                var fileName = Path.GetFileNameWithoutExtension(filePath);
                // Only rename if name doesn't look like an MD5 hash (32 hex chars)
                if (fileName.Length != 32 || fileName.Any(c => !Uri.IsHexDigit(c)))
                {
                    var md5 = CalculateMd5(filePath);
                    var ext = Path.GetExtension(filePath);
                    var dir = Path.GetDirectoryName(filePath)!;
                    var newFileName = md5 + ext;
                    var newPath = Path.Combine(dir, newFileName);

                    if (!filePath.Equals(newPath, StringComparison.OrdinalIgnoreCase))
                    {
                        File.Move(filePath, newPath);
                        effectivePath = newPath;
                    }
                }
            }

            var relativePath = Path.GetRelativePath(libraryPath, effectivePath);
            scannedPaths.Add(relativePath);

            if (existingAssets.TryGetValue(relativePath, out var existing))
            {
                // Check if file has been modified
                var lastWrite = File.GetLastWriteTimeUtc(effectivePath);
                if (existing.LastModified is null || existing.LastModified.Value != lastWrite)
                {
                    UpdateAssetMetadata(existing, effectivePath, relativePath);
                    existing.LastModified = lastWrite;
                }

                // Update MD5 hash if needed
                if (useMd5 && string.IsNullOrEmpty(existing.Md5Hash))
                {
                    existing.Md5Hash = CalculateMd5(effectivePath);
                }
            }
            else
            {
                // New asset
                var asset = CreateAssetFromFile(effectivePath, relativePath, parseTags);
                if (useMd5)
                {
                    asset.Md5Hash = CalculateMd5(effectivePath);
                }
                store.Assets.Add(asset);
                added++;

                // Generate thumbnail for new asset
                var thumbDir = Path.Combine(collectDir, "thumbnails");
                var thumbPath = Path.Combine(thumbDir, $"{asset.Id}.webp");
                _thumbnailService.TryGenerateThumbnail(effectivePath, thumbPath);
            }
        }

        // Remove assets whose files no longer exist
        var removed = store.Assets.RemoveAll(a => !scannedPaths.Contains(a.RelativePath));

        // Persist
        await File.WriteAllTextAsync(assetsPath, JsonSerializer.Serialize(store, JsonOptions));

        // Update library info
        if (File.Exists(libraryInfoPath))
        {
            var info = JsonSerializer.Deserialize<LibraryInfo>(await File.ReadAllTextAsync(libraryInfoPath), JsonOptions);
            if (info is not null)
            {
                info.AssetCount = store.Assets.Count;
                await File.WriteAllTextAsync(libraryInfoPath, JsonSerializer.Serialize(info, JsonOptions));
            }
        }

        return new ScanResult
        {
            Added = added,
            Removed = removed,
            Total = store.Assets.Count
        };
    }

    private static Asset CreateAssetFromFile(string filePath, string relativePath, bool parseTags = true)
    {
        var fileInfo = new FileInfo(filePath);
        var nameWithoutExt = Path.GetFileNameWithoutExtension(filePath);

        var asset = new Asset
        {
            Id = Guid.NewGuid().ToString("N"),
            FileName = fileInfo.Name,
            StorageFileName = fileInfo.Name,
            RelativePath = relativePath,
            FileSize = fileInfo.Length,
            MimeType = GetMimeType(filePath),
            ImportedAt = DateTime.UtcNow,
            LastModified = fileInfo.LastWriteTimeUtc,
            Tags = parseTags ? ParseTags(nameWithoutExt) : new List<AssetTag>()
        };

        // Try to get image dimensions using SkiaSharp
        try
        {
            using var input = File.OpenRead(filePath);
            using var codec = SKCodec.Create(input);
            if (codec != null)
            {
                var info = codec.Info;
                asset.Width = info.Width;
                asset.Height = info.Height;
            }
        }
        catch
        {
            // Non-image or corrupt file — dimensions stay 0
        }

        return asset;
    }

    private static void UpdateAssetMetadata(Asset asset, string filePath, string relativePath)
    {
        var fileInfo = new FileInfo(filePath);
        asset.FileSize = fileInfo.Length;
        asset.RelativePath = relativePath;
        asset.LastModified = fileInfo.LastWriteTimeUtc;

        // Try to get image dimensions using SkiaSharp
        try
        {
            using var input = File.OpenRead(filePath);
            using var codec = SKCodec.Create(input);
            if (codec != null)
            {
                var info = codec.Info;
                asset.Width = info.Width;
                asset.Height = info.Height;
            }
        }
        catch
        {
            // keep existing dimensions
        }
    }

    // ──────────────────────────────────────────────
    //  Read / List / Detail
    // ──────────────────────────────────────────────

    public async Task<PaginatedResponse<AssetDto>> GetAssetsAsync(int page, int pageSize, string sort, string? folder = null)
    {
        var store = await LoadStoreAsync();
        if (store is null)
            return new PaginatedResponse<AssetDto>();

        var filtered = store.Assets.AsEnumerable();

        // Filter by folder prefix if provided
        if (!string.IsNullOrEmpty(folder))
        {
            var folderPrefix = folder.Replace('\\', '/').TrimEnd('/') + "/";
            filtered = filtered.Where(a =>
                a.RelativePath.StartsWith(folderPrefix, StringComparison.OrdinalIgnoreCase));
        }

        var assets = sort switch
        {
            "oldest" => filtered.OrderBy(a => a.ImportedAt).ToList(),
            "name" => filtered.OrderBy(a => a.FileName).ToList(),
            "size" => filtered.OrderByDescending(a => a.FileSize).ToList(),
            _ => filtered.OrderByDescending(a => a.ImportedAt).ToList() // newest default
        };

        var total = assets.Count;
        var paged = assets
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => MapToDto(a))
            .ToList();

        return new PaginatedResponse<AssetDto>
        {
            Items = paged,
            Total = total,
            Page = page,
            PageSize = pageSize
        };
    }

    public async Task<AssetDetailDto?> GetAssetDetailAsync(string id)
    {
        var store = await LoadStoreAsync();
        if (store is null) return null;

        var asset = store.Assets.FirstOrDefault(a => a.Id == id);
        return asset is null ? null : MapToDetailDto(asset);
    }

    public async Task<Asset?> GetAssetAsync(string id)
    {
        var store = await LoadStoreAsync();
        return store?.Assets.FirstOrDefault(a => a.Id == id);
    }

    // ──────────────────────────────────────────────
    //  Update Tags
    // ──────────────────────────────────────────────

    public async Task<bool> UpdateTagsAsync(string id, List<AssetTag> tags)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return false;

        var assetsPath = Path.Combine(libraryPath, ".collect", "assets.json");
        var store = await LoadStoreAsync();
        if (store is null) return false;

        var asset = store.Assets.FirstOrDefault(a => a.Id == id);
        if (asset is null) return false;

        asset.Tags = tags;
        await File.WriteAllTextAsync(assetsPath, JsonSerializer.Serialize(store, JsonOptions));
        return true;
    }

    // ──────────────────────────────────────────────
    //  Search
    // ──────────────────────────────────────────────

    public async Task<PaginatedResponse<AssetDto>> SearchAsync(string query, int page, int pageSize)
    {
        var store = await LoadStoreAsync();
        if (store is null)
            return new PaginatedResponse<AssetDto>();

        IEnumerable<Asset> results = store.Assets;

        // Parse query for tags: prefix
        var tagMatch = System.Text.RegularExpressions.Regex.Match(query, @"tags:(\S+)");
        if (tagMatch.Success)
        {
            var tagQuery = tagMatch.Groups[1].Value;
            var requiredTags = tagQuery.Split('+', StringSplitOptions.RemoveEmptyEntries)
                .Select(t => t.Trim())
                .Where(t => t.Length > 0)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            results = results.Where(a =>
                requiredTags.All(rt => a.Tags.Any(t =>
                    t.Value.Equals(rt, StringComparison.OrdinalIgnoreCase))));

            // Remove the tags: prefix from the query for further filename filtering
            query = query.Replace(tagMatch.Value, "").Trim();
        }

        // Plain text filename search
        if (!string.IsNullOrWhiteSpace(query))
        {
            var searchText = query;
            results = results.Where(a =>
                a.FileName.Contains(searchText, StringComparison.OrdinalIgnoreCase));
        }

        var allResults = results.OrderByDescending(a => a.ImportedAt).ToList();
        var total = allResults.Count;
        var paged = allResults
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(MapToDto)
            .ToList();

        return new PaginatedResponse<AssetDto>
        {
            Items = paged,
            Total = total,
            Page = page,
            PageSize = pageSize
        };
    }

    // ──────────────────────────────────────────────
    //  Upload
    // ──────────────────────────────────────────────

    private static readonly HashSet<string> AllowedUploadExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"
    };

    public async Task<UploadResult> UploadAssetsAsync(List<IFormFile> files, string targetDir, bool parseTags)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null)
            throw new InvalidOperationException("Library not initialized.");

        var result = new UploadResult();
        var collectDir = Path.Combine(libraryPath, ".collect");
        var assetsPath = Path.Combine(collectDir, "assets.json");

        var store = File.Exists(assetsPath)
            ? JsonSerializer.Deserialize<AssetsStore>(await File.ReadAllTextAsync(assetsPath), JsonOptions) ?? new AssetsStore()
            : new AssetsStore();

        var targetPath = Path.Combine(libraryPath, targetDir);
        Directory.CreateDirectory(targetPath);

        foreach (var file in files)
        {
            var ext = Path.GetExtension(file.FileName);
            if (!AllowedUploadExtensions.Contains(ext))
            {
                result.Errors.Add(new UploadError
                {
                    FileName = file.FileName,
                    Reason = $"Unsupported file type '{ext}'. Allowed: {string.Join(", ", AllowedUploadExtensions)}"
                });
                continue;
            }

            try
            {
                // Determine unique file name
                var destFileName = file.FileName;
                var destPath = Path.Combine(targetPath, destFileName);
                var counter = 1;

                while (File.Exists(destPath))
                {
                    var nameWithoutExt = Path.GetFileNameWithoutExtension(file.FileName);
                    destFileName = $"{nameWithoutExt}_({counter}){ext}";
                    destPath = Path.Combine(targetPath, destFileName);
                    counter++;
                }

                // Save file
                await using (var stream = new FileStream(destPath, FileMode.Create))
                {
                    await file.CopyToAsync(stream);
                }

                // Create asset entry
                var relativePath = Path.GetRelativePath(libraryPath, destPath);
                var asset = CreateAssetFromFile(destPath, relativePath, parseTags);

                store.Assets.Add(asset);
                result.Added++;

                // Generate thumbnail
                var thumbDir = Path.Combine(collectDir, "thumbnails");
                var thumbPath = Path.Combine(thumbDir, $"{asset.Id}.webp");
                _thumbnailService.TryGenerateThumbnail(destPath, thumbPath);
            }
            catch (Exception ex)
            {
                result.Errors.Add(new UploadError
                {
                    FileName = file.FileName,
                    Reason = ex.Message
                });
            }
        }

        // Persist store
        await File.WriteAllTextAsync(assetsPath, JsonSerializer.Serialize(store, JsonOptions));

        return result;
    }

    // ──────────────────────────────────────────────
    //  File Paths & Thumbnails
    // ──────────────────────────────────────────────

    public string? GetAssetFilePath(string id)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return null;

        // Load directly from file to avoid stale in-memory state
        var assetsPath = Path.Combine(libraryPath, ".collect", "assets.json");
        if (!File.Exists(assetsPath)) return null;

        var json = File.ReadAllText(assetsPath);
        var store = JsonSerializer.Deserialize<AssetsStore>(json);
        var asset = store?.Assets.FirstOrDefault(a => a.Id == id);
        if (asset is null) return null;

        return Path.Combine(libraryPath, asset.RelativePath);
    }

    public async Task<string?> GetThumbnailPathAsync(string id)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return null;

        var asset = await GetAssetAsync(id);
        if (asset is null) return null;

        var sourcePath = Path.Combine(libraryPath, asset.RelativePath);
        if (!File.Exists(sourcePath))
            return null;

        var thumbDir = Path.Combine(libraryPath, ".collect", "thumbnails");
        var thumbPath = Path.Combine(thumbDir, $"{id}.webp");

        // Check if thumbnail is valid (exists and up-to-date)
        var thumbValid = File.Exists(thumbPath) &&
            File.GetLastWriteTimeUtc(thumbPath) >= File.GetLastWriteTimeUtc(sourcePath);

        if (!thumbValid)
        {
            if (!_thumbnailService.TryGenerateThumbnail(sourcePath, thumbPath))
                return null;
        }

        return thumbPath;
    }

    // ──────────────────────────────────────────────
    //  Helpers
    // ──────────────────────────────────────────────

    private async Task<AssetsStore?> LoadStoreAsync()
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return null;

        var assetsPath = Path.Combine(libraryPath, ".collect", "assets.json");
        if (!File.Exists(assetsPath)) return null;

        var json = await File.ReadAllTextAsync(assetsPath);
        return JsonSerializer.Deserialize<AssetsStore>(json, JsonOptions);
    }

    private AssetDto MapToDto(Asset asset)
    {
        return new AssetDto
        {
            Id = asset.Id,
            FileName = asset.FileName,
            MimeType = asset.MimeType,
            FileSize = asset.FileSize,
            Width = asset.Width,
            Height = asset.Height,
            ThumbnailUrl = $"/api/assets/{asset.Id}/thumbnail",
            ImportedAt = asset.ImportedAt
        };
    }

    private AssetDetailDto MapToDetailDto(Asset asset)
    {
        return new AssetDetailDto
        {
            Id = asset.Id,
            FileName = asset.FileName,
            StorageFileName = asset.StorageFileName,
            RelativePath = asset.RelativePath,
            FileSize = asset.FileSize,
            Width = asset.Width,
            Height = asset.Height,
            MimeType = asset.MimeType,
            Tags = asset.Tags,
            ThumbnailUrl = $"/api/assets/{asset.Id}/thumbnail",
            ImageUrl = $"/api/assets/{asset.Id}/image",
            ImportedAt = asset.ImportedAt,
            LastModified = asset.LastModified
        };
    }

    private static string CalculateMd5(string filePath)
    {
        using var stream = File.OpenRead(filePath);
        return Convert.ToHexString(System.Security.Cryptography.MD5.HashData(stream)).ToLowerInvariant();
    }

    private static string GetMimeType(string filePath)
    {
        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        return ext switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".gif" => "image/gif",
            ".bmp" => "image/bmp",
            ".webp" => "image/webp",
            ".tiff" or ".tif" => "image/tiff",
            _ => "application/octet-stream"
        };
    }
}
