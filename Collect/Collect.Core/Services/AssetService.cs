using System.Text.RegularExpressions;
using Collect.Core.Dtos;
using Collect.Core.Models;
using SkiaSharp;

namespace Collect.Core.Services;

/// <summary>
/// Implements asset CRUD, scanning, tag parsing, search, and thumbnail management.
/// Asset state is derived entirely from the filesystem on each scan; no JSON persistence.
/// </summary>
public partial class AssetService : IAssetService
{
    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif"
    };

    [GeneratedRegex(@"^\[(?<type>[^\]]+)\](?<value>.+)$")]
    private static partial Regex TaggedSegmentRegex();

    private readonly ILibraryService _libraryService;
    private readonly IThumbnailService _thumbnailService;
    private readonly ILogger<AssetService> _logger;
    private readonly SemaphoreSlim _semaphore = new(1, 1);

    private List<Asset> _assets = new();

    public AssetService(ILibraryService libraryService, IThumbnailService thumbnailService, ILogger<AssetService> logger)
    {
        _libraryService = libraryService;
        _thumbnailService = thumbnailService;
        _logger = logger;
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

        await _semaphore.WaitAsync();
        try
        {
            var newAssets = new List<Asset>();
            var added = 0;
            var scannedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Recursively find image files
            var files = Directory.EnumerateFiles(libraryPath, "*.*", SearchOption.AllDirectories)
                .Where(f => !f.StartsWith(collectDir, StringComparison.OrdinalIgnoreCase)
                    && ImageExtensions.Contains(Path.GetExtension(f)));

            foreach (var filePath in files)
            {
                var relativePath = Path.GetRelativePath(libraryPath, filePath);
                scannedPaths.Add(relativePath);

                var existing = _assets.FirstOrDefault(a =>
                    a.RelativePath.Equals(relativePath, StringComparison.OrdinalIgnoreCase));

                if (existing is not null)
                {
                    // Update metadata if file has been modified
                    var lastWrite = File.GetLastWriteTimeUtc(filePath);
                    if (existing.LastModified is null || existing.LastModified.Value != lastWrite)
                    {
                        UpdateAssetMetadata(existing, filePath, relativePath);
                        existing.LastModified = lastWrite;
                    }
                    newAssets.Add(existing);
                }
                else
                {
                    // New asset
                    var asset = CreateAssetFromFile(filePath, relativePath);
                    newAssets.Add(asset);
                    added++;

                    // Generate thumbnail for new asset (deduplicated by content hash)
                    _thumbnailService.GetOrCreateContentHashThumbnail(libraryPath, filePath);
                }
            }

            var removed = _assets.Count - newAssets.Count;
            _assets = newAssets;

            // Clean up orphaned thumbnails (from renamed/deleted files)
            var currentFilePaths = _assets.Select(a => Path.Combine(libraryPath, a.RelativePath)).ToList();
            _thumbnailService.CleanupOrphanedThumbnails(libraryPath, currentFilePaths);

            // ──────────────────────────────────────────────
            //  Tag normalization: auto-add type prefix for tags
            //  that exist both with and without a type
            // ──────────────────────────────────────────────
            var tagConflicts = await NormalizeTagsAsync();

            // Update AssetCount in library.json
            await _libraryService.UpdateAssetCountAsync(_assets.Count);

            return new ScanResult
            {
                Added = added,
                Removed = removed,
                Total = _assets.Count,
                TagConflicts = tagConflicts
            };
        }
        finally
        {
            _semaphore.Release();
        }
    }

    private static Asset CreateAssetFromFile(string filePath, string relativePath)
    {
        var fileInfo = new FileInfo(filePath);
        var nameWithoutExt = Path.GetFileNameWithoutExtension(filePath);

        var asset = new Asset
        {
            Id = Guid.NewGuid().ToString("N"),
            FileName = fileInfo.Name,
            RelativePath = relativePath,
            FileSize = fileInfo.Length,
            MimeType = GetMimeType(filePath),
            ImportedAt = DateTime.UtcNow,
            LastModified = fileInfo.LastWriteTimeUtc,
            Tags = ParseTags(nameWithoutExt)
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

    public async Task<PaginatedResponse<AssetDto>> GetAssetsAsync(int page, int pageSize, string sort, string? folder = null, bool subfolders = true)
    {
        await EnsureScannedAsync();

        var filtered = _assets.AsEnumerable();

        // Filter by folder
        if (!string.IsNullOrEmpty(folder))
        {
            if (folder == "__root__")
            {
                // Root: assets with no directory separator in their relative path
                filtered = filtered.Where(a =>
                    !a.RelativePath.Contains(Path.DirectorySeparatorChar) &&
                    !a.RelativePath.Contains(Path.AltDirectorySeparatorChar));
            }
            else if (subfolders)
            {
                // Recursive mode: all files under the folder prefix
                var folderPrefix = folder.Replace('\\', '/').TrimEnd('/') + "/";
                filtered = filtered.Where(a =>
                    a.RelativePath.Replace('\\', '/').StartsWith(folderPrefix, StringComparison.OrdinalIgnoreCase));
            }
            else
            {
                // Non-recursive: only files directly in this folder (no subdirectories)
                var normalizedFolder = folder.Replace('\\', '/').TrimEnd('/');
                filtered = filtered.Where(a =>
                {
                    var rel = a.RelativePath.Replace('\\', '/');
                    var dir = Path.GetDirectoryName(rel)?.Replace('\\', '/') ?? "";
                    return string.Equals(dir, normalizedFolder, StringComparison.OrdinalIgnoreCase);
                });
            }
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
        await EnsureScannedAsync();
        var asset = _assets.FirstOrDefault(a => a.Id == id);
        return asset is null ? null : MapToDetailDto(asset);
    }

    public async Task<Asset?> GetAssetAsync(string id)
    {
        await EnsureScannedAsync();
        return _assets.FirstOrDefault(a => a.Id == id);
    }

    public async Task<List<Asset>> GetAllAssetsAsync()
    {
        await EnsureScannedAsync();
        return _assets;
    }

    // ──────────────────────────────────────────────
    //  Update Tags
    // ──────────────────────────────────────────────

    public async Task<bool> UpdateTagsAsync(string id, List<AssetTag> tags)
    {
        await EnsureScannedAsync();

        await _semaphore.WaitAsync();
        try
        {
            var asset = _assets.FirstOrDefault(a => a.Id == id);
            if (asset is null) return false;

            var libraryPath = _libraryService.GetLibraryPath();
            if (libraryPath is null) return false;

            // Reorder: categorized tags before uncategorized tags
            tags = ReorderTags(tags);

            var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
            var oldExt = Path.GetExtension(asset.FileName);

            // Build new filename from tags
            var newFileName = BuildFileNameFromTags(tags, oldExt);
            var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
            var newRelativePath = string.IsNullOrEmpty(oldDir) ? newFileName : oldDir + Path.DirectorySeparatorChar + newFileName;
            var newFilePath = Path.Combine(libraryPath, newRelativePath);

            // Only rename if the filename actually changed
            if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
            {
                // If current filename already has a disambiguation suffix, skip rename
                if (HasDisambiguationSuffix(asset.FileName, newFileName))
                {
                    // Already has suffix, no rename needed for tag-based name
                }
                else if (!File.Exists(newFilePath))
                {
                    // No collision, rename directly
                    _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath);
                    File.Move(oldFilePath, newFilePath);
                    asset.FileName = newFileName;
                    asset.RelativePath = newRelativePath;
                }
                else
                {
                    // Collision: try numeric suffixes
                    var baseWithoutExt = Path.GetFileNameWithoutExtension(newFileName);
                    bool found = false;
                    for (int i = 1; i <= 999; i++)
                    {
                        var suffixedName = $"{baseWithoutExt}-{i:D2}{oldExt}";
                        var suffixedRelPath = string.IsNullOrEmpty(oldDir) ? suffixedName : oldDir + Path.DirectorySeparatorChar + suffixedName;
                        var suffixedPath = Path.Combine(libraryPath, suffixedRelPath);
                        if (!File.Exists(suffixedPath))
                        {
                            try { _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath); } catch { }
                            try
                            {
                                File.Move(oldFilePath, suffixedPath);
                                asset.FileName = suffixedName;
                                asset.RelativePath = suffixedRelPath;
                                found = true;
                                break;
                            }
                            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { break; }
                        }
                    }
                    if (!found)
                        return false;
                }
            }

            asset.Tags = tags;
            return true;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    /// <summary>
    /// Reorder tags so that categorized tags (with a type) come before uncategorized tags.
    /// Categorized tags are sorted by their type name, then by their value.
    /// Uncategorized tags maintain their original relative order.
    /// Returns the original list reference if already in order.
    /// </summary>
    private static List<AssetTag> ReorderTags(List<AssetTag> tags)
    {
        var categorized = tags.Where(t => t.Type != null)
            .OrderBy(t => t.Type, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Value, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var uncategorized = tags.Where(t => t.Type == null).ToList();
        if (categorized.Count == 0 || uncategorized.Count == 0)
            return tags;

        // Check if already in order (all categorized before all uncategorized, sorted by type)
        bool alreadyOrdered = true;
        int catIdx = 0;
        foreach (var tag in tags)
        {
            if (tag.Type == null)
            {
                // All categorized should come before any uncategorized
                // Once we see an uncategorized, the rest must be uncategorized
                break;
            }
            else
            {
                // Check that this categorized tag matches the expected sorted order
                if (catIdx < categorized.Count &&
                    (!string.Equals(tag.Type, categorized[catIdx].Type, StringComparison.OrdinalIgnoreCase) ||
                     !string.Equals(tag.Value, categorized[catIdx].Value, StringComparison.OrdinalIgnoreCase)))
                {
                    alreadyOrdered = false;
                    break;
                }
                catIdx++;
            }
        }
        // Also verify no categorized tags appear after uncategorized
        if (alreadyOrdered)
        {
            bool seenUncategorized = false;
            foreach (var tag in tags)
            {
                if (tag.Type == null)
                    seenUncategorized = true;
                else if (seenUncategorized)
                {
                    alreadyOrdered = false;
                    break;
                }
            }
        }
        if (alreadyOrdered && catIdx == categorized.Count)
            return tags;

        var reordered = new List<AssetTag>(categorized.Count + uncategorized.Count);
        reordered.AddRange(categorized);
        reordered.AddRange(uncategorized);
        return reordered;
    }

    private static string BuildFileNameFromTags(List<AssetTag> tags, string extension)
    {
        var segments = new List<string>();
        foreach (var tag in tags)
        {
            var segment = tag.Type is not null ? $"[{tag.Type}]{tag.Value}" : tag.Value;
            segments.Add(segment);
        }
        return string.Join("-", segments) + extension;
    }

    /// <summary>
    /// Check if a filename differs from another only by a numeric disambiguation suffix
    /// (e.g., "tag-01.jpg" vs "tag.jpg" → true; "tag-other.jpg" vs "tag.jpg" → false)
    /// </summary>
    private static bool HasDisambiguationSuffix(string currentFileName, string baseFileName)
    {
        var currentWithoutExt = Path.GetFileNameWithoutExtension(currentFileName);
        var baseWithoutExt = Path.GetFileNameWithoutExtension(baseFileName);
        if (currentWithoutExt.Length <= baseWithoutExt.Length)
            return false;
        if (!currentWithoutExt.StartsWith(baseWithoutExt, StringComparison.OrdinalIgnoreCase))
            return false;
        var suffix = currentWithoutExt.Substring(baseWithoutExt.Length);
        return suffix.Length >= 3 && suffix[0] == '-' && suffix.Substring(1).All(char.IsDigit);
    }

    // ──────────────────────────────────────────────
    //  Search
    // ──────────────────────────────────────────────

    public async Task<PaginatedResponse<AssetDto>> SearchAsync(string query, int page, int pageSize, string? folder = null)
    {
        await EnsureScannedAsync();

        IEnumerable<Asset> results = _assets;

        // Filter by folder prefix if provided
        if (!string.IsNullOrEmpty(folder))
        {
            var folderPrefix = folder.Replace('\\', '/').TrimEnd('/') + "/";
            results = results.Where(a =>
                a.RelativePath.Replace('\\', '/').StartsWith(folderPrefix, StringComparison.OrdinalIgnoreCase));
        }

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

    public async Task<UploadResult> UploadAssetsAsync(List<IFormFile> files, string targetDir)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null)
            throw new InvalidOperationException("Library not initialized.");

        await EnsureScannedAsync();

        var result = new UploadResult();
        var targetPath = Path.Combine(libraryPath, targetDir);
        Directory.CreateDirectory(targetPath);

        await _semaphore.WaitAsync();
        try
        {
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
                    var asset = CreateAssetFromFile(destPath, relativePath);

                    _assets.Add(asset);
                    result.Added++;

                    // Generate thumbnail (deduplicated by content hash)
                    _thumbnailService.GetOrCreateContentHashThumbnail(libraryPath, destPath);
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
        }
        finally
        {
            _semaphore.Release();
        }

        // Update AssetCount in library.json
        await _libraryService.UpdateAssetCountAsync(_assets.Count);

        return result;
    }

    // ──────────────────────────────────────────────
    //  Move Asset
    // ──────────────────────────────────────────────

    public async Task<AssetDetailDto?> MoveAssetAsync(string id, string targetFolder)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return null;

        await EnsureScannedAsync();

        await _semaphore.WaitAsync();
        try
        {
            var asset = _assets.FirstOrDefault(a => a.Id == id);
            if (asset is null) return null;

            var oldRelativeDir = Path.GetDirectoryName(asset.RelativePath.Replace('\\', '/')) ?? "";
            var targetDir = string.IsNullOrEmpty(targetFolder) ? "" : targetFolder.Replace('\\', '/').Trim('/');

            // No-op if already in the target folder
            if (string.Equals(oldRelativeDir, targetDir, StringComparison.OrdinalIgnoreCase))
                return MapToDetailDto(asset);

            var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
            var fileName = Path.GetFileName(asset.RelativePath);

            // Determine new path
            var newRelativePath = string.IsNullOrEmpty(targetDir) ? fileName : targetDir.Replace('/', Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar + fileName;
            var newFilePath = Path.Combine(libraryPath, newRelativePath);

            // Handle name collision
            if (File.Exists(newFilePath))
                return null;

            // Ensure target directory exists
            var targetFullDir = Path.GetDirectoryName(newFilePath)!;
            if (!Directory.Exists(targetFullDir))
                Directory.CreateDirectory(targetFullDir);

            // Delete old thumbnail before moving
            _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath);

            // Move file on disk
            File.Move(oldFilePath, newFilePath);

            // Update asset metadata (under lock so ScanAsync doesn't interfere)
            asset.RelativePath = newRelativePath;
            asset.FileName = fileName;

            return MapToDetailDto(asset);
        }
        finally
        {
            _semaphore.Release();
        }
    }

    // ──────────────────────────────────────────────
    //  File Paths & Thumbnails
    // ──────────────────────────────────────────────

    public string? GetAssetFilePath(string id)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return null;

        var asset = _assets.FirstOrDefault(a => a.Id == id);
        if (asset is null) return null;

        return Path.Combine(libraryPath, asset.RelativePath);
    }

    // ──────────────────────────────────────────────
    //  Clipboard Image
    // ──────────────────────────────────────────────

    public async Task<byte[]?> GetClipboardImageAsync(string id)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return null;

        var asset = await GetAssetAsync(id);
        if (asset is null) return null;

        var filePath = Path.Combine(libraryPath, asset.RelativePath);
        if (!File.Exists(filePath)) return null;

        try
        {
            using var input = File.OpenRead(filePath);
            using var codec = SKCodec.Create(input);
            if (codec is null) return null;

            var info = codec.Info;
            var maxDim = Math.Max(info.Width, info.Height);

            using var original = SKBitmap.Decode(codec);
            if (original is null) return null;

            SKBitmap? finalBitmap;
            if (maxDim > 2000)
            {
                float scale = 2000f / maxDim;
                int newWidth = Math.Max(1, (int)(info.Width * scale));
                int newHeight = Math.Max(1, (int)(info.Height * scale));
                finalBitmap = original.Resize(new SKSizeI(newWidth, newHeight), new SKSamplingOptions(SKFilterMode.Linear));
                if (finalBitmap is null) return null;
            }
            else
            {
                finalBitmap = original;
            }

            using var image = SKImage.FromBitmap(finalBitmap);
            using var data = image.Encode(SKEncodedImageFormat.Png, 100);
            var bytes = data.ToArray();

            if (finalBitmap != original)
                finalBitmap.Dispose();

            return bytes;
        }
        catch
        {
            return null;
        }
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

        return _thumbnailService.GetOrCreateContentHashThumbnail(libraryPath, sourcePath);
    }

    // ──────────────────────────────────────────────
    //  Helpers
    // ──────────────────────────────────────────────

    /// <summary>
    /// Auto-convert untyped tags that have a matching typed tag elsewhere,
    /// reorder tags (categorized first), and rename files on disk.
    /// Returns a list of unresolved conflicts (values with multiple possible types).
    /// </summary>
    private async Task<List<TagConflict>> NormalizeTagsAsync()
    {
        var tagConflicts = new List<TagConflict>();

        // Build map: value_lowercase → set<type> from all assets
        var valueToTypes = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var asset in _assets)
        {
            foreach (var tag in asset.Tags)
            {
                if (tag.Type != null)
                {
                    if (!valueToTypes.ContainsKey(tag.Value))
                        valueToTypes[tag.Value] = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    valueToTypes[tag.Value].Add(tag.Type);
                }
            }
        }

        // Record conflicts for values with multiple possible types
        foreach (var kvp in valueToTypes)
        {
            if (kvp.Value.Count > 1)
            {
                tagConflicts.Add(new TagConflict
                {
                    TagValue = kvp.Key,
                    PossibleTypes = kvp.Value.OrderBy(t => t).ToList()
                });
            }
        }

        // Auto-convert untyped tags and reorder
        var libraryPathForRename = _libraryService.GetLibraryPath();
        foreach (var asset in _assets)
        {
            // Save original tags so we can revert if file rename fails
            var originalTags = asset.Tags.Select(t => new AssetTag { Type = t.Type, Value = t.Value }).ToList();

            for (int i = 0; i < asset.Tags.Count; i++)
            {
                var tag = asset.Tags[i];
                if (tag.Type != null) continue;
                if (!valueToTypes.TryGetValue(tag.Value, out var types)) continue;
                if (types.Count != 1) continue;

                // Auto-convert: exactly one possible type
                asset.Tags[i] = new AssetTag { Type = types.First(), Value = tag.Value };
            }

            // Reorder: categorized tags before uncategorized tags, sorted by type name
            var reordered = ReorderTags(asset.Tags);
            if (!ReferenceEquals(reordered, asset.Tags))
                asset.Tags = reordered;

            // Always try to persist the current tag order to the filename,
            // even if only the order changed (no type changes).
            // This ensures sorted tags are reflected on disk.
            if (libraryPathForRename != null)
            {
                var oldFilePath = Path.Combine(libraryPathForRename, asset.RelativePath);
                var oldExt = Path.GetExtension(asset.FileName);
                var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                var newRelativePath = string.IsNullOrEmpty(oldDir) ? newFileName : oldDir + Path.DirectorySeparatorChar + newFileName;
                var newFilePath = Path.Combine(libraryPathForRename, newRelativePath);

                _logger.LogDebug(
                    "[NormalizeTagsAsync] Asset {AssetId}: oldFileName={OldFile}, newFileName={NewFile}, " +
                    "oldFilePath={OldPath}, newFilePath={NewPath}, " +
                    "fileNameEquals={FileNameEquals}, targetExists={TargetExists}",
                    asset.Id, asset.FileName, newFileName,
                    oldFilePath, newFilePath,
                    string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase),
                    File.Exists(newFilePath));

                if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                {
                    // If current filename already has a disambiguation suffix, skip rename
                    if (HasDisambiguationSuffix(asset.FileName, newFileName))
                    {
                        _logger.LogTrace(
                            "[NormalizeTagsAsync] Asset {AssetId}: fileName {FileName} already has a disambiguation suffix for {NewFile}, skipping rename.",
                            asset.Id, asset.FileName, newFileName);
                    }
                    else if (!File.Exists(newFilePath))
                    {
                        // No collision, rename directly
                        try
                        {
                            _thumbnailService.DeleteThumbnail(libraryPathForRename, oldFilePath);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex,
                                "[NormalizeTagsAsync] DeleteThumbnail failed for asset {AssetId}: {OldPath}. Continuing with rename.",
                                asset.Id, oldFilePath);
                        }
                        try
                        {
                            File.Move(oldFilePath, newFilePath);
                            _logger.LogInformation(
                                "[NormalizeTagsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {NewFile}",
                                asset.Id, asset.FileName, newFileName);
                            asset.FileName = newFileName;
                            asset.RelativePath = newRelativePath;
                        }
                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                        {
                            _logger.LogError(ex,
                                "[NormalizeTagsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {NewPath}. Reverting tags.",
                                asset.Id, oldFilePath, newFilePath);
                            // Revert in-memory tags to match disk state
                            asset.Tags = originalTags;
                        }
                    }
                    else
                    {
                        // Collision: try numeric suffixes
                        var baseWithoutExt = Path.GetFileNameWithoutExtension(newFileName);
                        bool found = false;
                        for (int i = 1; i <= 999; i++)
                        {
                            var suffixedName = $"{baseWithoutExt}-{i:D2}{oldExt}";
                            var suffixedRelPath = string.IsNullOrEmpty(oldDir) ? suffixedName : oldDir + Path.DirectorySeparatorChar + suffixedName;
                            var suffixedPath = Path.Combine(libraryPathForRename, suffixedRelPath);
                            if (!File.Exists(suffixedPath))
                            {
                                try { _thumbnailService.DeleteThumbnail(libraryPathForRename, oldFilePath); } catch { }
                                try
                                {
                                    File.Move(oldFilePath, suffixedPath);
                                    _logger.LogInformation(
                                        "[NormalizeTagsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {SuffixedName}",
                                        asset.Id, asset.FileName, suffixedName);
                                    asset.FileName = suffixedName;
                                    asset.RelativePath = suffixedRelPath;
                                    found = true;
                                    break;
                                }
                                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                {
                                    _logger.LogError(ex,
                                        "[NormalizeTagsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {SuffixedPath}. Reverting tags.",
                                        asset.Id, oldFilePath, suffixedPath);
                                    break;
                                }
                            }
                        }
                        if (!found)
                        {
                            _logger.LogWarning(
                                "[NormalizeTagsAsync] Could not find unique suffixed name for asset {AssetId}: {NewPath}. Reverting tags.",
                                asset.Id, newFilePath);
                            // Could not find a unique name — revert in-memory tags to match disk
                            asset.Tags = originalTags;
                        }
                    }
                }
                else
                {
                    _logger.LogTrace(
                        "[NormalizeTagsAsync] No rename needed for asset {AssetId}: fileName already matches.",
                        asset.Id);
                }
            }
        }

        return tagConflicts;
    }

    private async Task EnsureScannedAsync()
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return;

        var collectDir = Path.Combine(libraryPath, ".collect");

        if (_assets.Count == 0)
        {
            await ScanAsync();
            return;
        }

        // Lightweight check: count image files on disk and compare with in-memory count.
        // This catches files added externally (e.g. manual copy) without a full scan every time.
        var diskCount = Directory.EnumerateFiles(libraryPath, "*.*", SearchOption.AllDirectories)
            .Count(f => !f.StartsWith(collectDir, StringComparison.OrdinalIgnoreCase)
                && ImageExtensions.Contains(Path.GetExtension(f)));
        if (diskCount != _assets.Count)
        {
            await ScanAsync();
        }
        // else: disk count matches, nothing to do
        // NormalizeTagsAsync is only called from ScanAsync to avoid infinite retry
        // loops when tag auto-conversion causes filename collisions on disk.
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

    public async Task<List<TagConflict>> GetTagConflictsAsync()
    {
        await EnsureScannedAsync();

        // After normalization, check for any remaining conflicts
        var valueToTypes = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var asset in _assets)
        {
            foreach (var tag in asset.Tags)
            {
                if (tag.Type != null)
                {
                    if (!valueToTypes.ContainsKey(tag.Value))
                        valueToTypes[tag.Value] = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    valueToTypes[tag.Value].Add(tag.Type);
                }
            }
        }

        var conflicts = new List<TagConflict>();
        foreach (var kvp in valueToTypes)
        {
            if (kvp.Value.Count > 1)
            {
                conflicts.Add(new TagConflict
                {
                    TagValue = kvp.Key,
                    PossibleTypes = kvp.Value.OrderBy(t => t).ToList()
                });
            }
        }

        return conflicts;
    }

    public async Task<bool> ResolveTagConflictsAsync(List<TagConflictResolution> resolutions)
    {
        await _semaphore.WaitAsync();
        try
        {
            foreach (var resolution in resolutions)
            {
                foreach (var asset in _assets)
                {
                    // Save original tags to revert if rename fails
                    var originalTags = asset.Tags.Select(t => new AssetTag { Type = t.Type, Value = t.Value }).ToList();

                    bool tagsChanged = false;
                    for (int i = 0; i < asset.Tags.Count; i++)
                    {
                        var tag = asset.Tags[i];
                        // Update ALL tags with this value to the chosen type,
                        // regardless of whether they already have a type (or a different one)
                        if (!string.Equals(tag.Value, resolution.TagValue, StringComparison.OrdinalIgnoreCase))
                            continue;
                        if (string.Equals(tag.Type, resolution.ChosenType, StringComparison.OrdinalIgnoreCase))
                            continue; // already has the chosen type, skip

                        asset.Tags[i] = new AssetTag { Type = resolution.ChosenType, Value = tag.Value };
                        tagsChanged = true;
                    }

                    if (tagsChanged)
                    {
                        // Reorder: categorized tags before uncategorized tags
                        var reordered = ReorderTags(asset.Tags);
                        if (!ReferenceEquals(reordered, asset.Tags))
                            asset.Tags = reordered;

                        var libraryPath = _libraryService.GetLibraryPath();
                        if (libraryPath == null)
                        {
                            asset.Tags = originalTags;
                            continue;
                        }

                        var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                        var oldExt = Path.GetExtension(asset.FileName);
                        var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                        var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                        var newRelativePath = string.IsNullOrEmpty(oldDir)
                            ? newFileName
                            : oldDir + Path.DirectorySeparatorChar + newFileName;
                        var newFilePath = Path.Combine(libraryPath, newRelativePath);

                        _logger.LogDebug(
                            "[ResolveTagConflictsAsync] Asset {AssetId}: oldFileName={OldFile}, newFileName={NewFile}, " +
                            "oldFilePath={OldPath}, newFilePath={NewPath}, " +
                            "fileNameEquals={FileNameEquals}, targetExists={TargetExists}",
                            asset.Id, asset.FileName, newFileName,
                            oldFilePath, newFilePath,
                            string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase),
                            File.Exists(newFilePath));

                        if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                        {
                            // If current filename already has a disambiguation suffix, skip rename
                            if (HasDisambiguationSuffix(asset.FileName, newFileName))
                            {
                                _logger.LogTrace(
                                    "[ResolveTagConflictsAsync] Asset {AssetId}: fileName {FileName} already has a disambiguation suffix for {NewFile}, skipping rename.",
                                    asset.Id, asset.FileName, newFileName);
                            }
                            else if (!File.Exists(newFilePath))
                            {
                                // No collision, rename directly
                                try
                                {
                                    _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath);
                                }
                                catch (Exception ex)
                                {
                                    _logger.LogWarning(ex,
                                        "[ResolveTagConflictsAsync] DeleteThumbnail failed for asset {AssetId}: {OldPath}. Continuing with rename.",
                                        asset.Id, oldFilePath);
                                }
                                try
                                {
                                    File.Move(oldFilePath, newFilePath);
                                    _logger.LogInformation(
                                        "[ResolveTagConflictsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {NewFile}",
                                        asset.Id, asset.FileName, newFileName);
                                    asset.FileName = newFileName;
                                    asset.RelativePath = newRelativePath;
                                }
                                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                {
                                    _logger.LogError(ex,
                                        "[ResolveTagConflictsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {NewPath}. Reverting tags.",
                                        asset.Id, oldFilePath, newFilePath);
                                    // Revert in-memory tags to match disk state
                                    asset.Tags = originalTags;
                                }
                            }
                            else
                            {
                                // Collision: try numeric suffixes
                                var baseWithoutExt = Path.GetFileNameWithoutExtension(newFileName);
                                bool found = false;
                                for (int i = 1; i <= 999; i++)
                                {
                                    var suffixedName = $"{baseWithoutExt}-{i:D2}{oldExt}";
                                    var suffixedRelPath = string.IsNullOrEmpty(oldDir) ? suffixedName : oldDir + Path.DirectorySeparatorChar + suffixedName;
                                    var suffixedPath = Path.Combine(libraryPath, suffixedRelPath);
                                    if (!File.Exists(suffixedPath))
                                    {
                                        try { _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath); } catch { }
                                        try
                                        {
                                            File.Move(oldFilePath, suffixedPath);
                                            _logger.LogInformation(
                                                "[ResolveTagConflictsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {SuffixedName}",
                                                asset.Id, asset.FileName, suffixedName);
                                            asset.FileName = suffixedName;
                                            asset.RelativePath = suffixedRelPath;
                                            found = true;
                                            break;
                                        }
                                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                        {
                                            _logger.LogError(ex,
                                                "[ResolveTagConflictsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {SuffixedPath}. Reverting tags.",
                                                asset.Id, oldFilePath, suffixedPath);
                                            break;
                                        }
                                    }
                                }
                                if (!found)
                                {
                                    _logger.LogWarning(
                                        "[ResolveTagConflictsAsync] Could not find unique suffixed name for asset {AssetId}: {NewPath}. Reverting tags.",
                                        asset.Id, newFilePath);
                                    // Could not find a unique name — revert in-memory tags to match disk
                                    asset.Tags = originalTags;
                                }
                            }
                        }
                        else
                        {
                            _logger.LogTrace(
                                "[ResolveTagConflictsAsync] No rename needed for asset {AssetId}: fileName already matches.",
                                asset.Id);
                        }
                    }
                }
            }

            return true;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public async Task<int> CategorizeTagsAsync(BatchCategorizeRequest request)
    {
        // Don't call EnsureScannedAsync() here — that would trigger NormalizeTagsAsync
        // which auto-converts tags and renames files. Then we'd run our own rename on top,
        // causing potential double-rename issues. Instead, scan directly if empty.
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return 0;

        if (_assets.Count == 0)
            await ScanAsync();

        var affectedAssetIds = new HashSet<string>();

        await _semaphore.WaitAsync();
        try
        {
            foreach (var change in request.Changes)
            {
                foreach (var asset in _assets)
                {
                    // Save original tags to revert if rename fails
                    var originalTags = asset.Tags.Select(t => new AssetTag { Type = t.Type, Value = t.Value }).ToList();

                    bool tagsChanged = false;
                    for (int i = 0; i < asset.Tags.Count; i++)
                    {
                        var tag = asset.Tags[i];
                        if (!string.Equals(tag.Value, change.TagValue, StringComparison.OrdinalIgnoreCase))
                            continue;
                        if (string.Equals(tag.Type, change.NewType, StringComparison.OrdinalIgnoreCase))
                            continue; // already has the target type, skip

                        asset.Tags[i] = new AssetTag { Type = change.NewType, Value = tag.Value };
                        tagsChanged = true;
                    }

                    if (tagsChanged)
                    {
                        affectedAssetIds.Add(asset.Id);

                        // Reorder: categorized tags before uncategorized tags
                        var reordered = ReorderTags(asset.Tags);
                        if (!ReferenceEquals(reordered, asset.Tags))
                            asset.Tags = reordered;

                        var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                        var oldExt = Path.GetExtension(asset.FileName);
                        var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                        var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                        var newRelativePath = string.IsNullOrEmpty(oldDir)
                            ? newFileName
                            : oldDir + Path.DirectorySeparatorChar + newFileName;
                        var newFilePath = Path.Combine(libraryPath, newRelativePath);

                        _logger.LogDebug(
                            "[CategorizeTagsAsync] Asset {AssetId}: oldFileName={OldFile}, newFileName={NewFile}, " +
                            "oldFilePath={OldPath}, newFilePath={NewPath}, " +
                            "fileNameEquals={FileNameEquals}, targetExists={TargetExists}",
                            asset.Id, asset.FileName, newFileName,
                            oldFilePath, newFilePath,
                            string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase),
                            File.Exists(newFilePath));

                        if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                        {
                            // If current filename already has a disambiguation suffix, skip rename
                            if (HasDisambiguationSuffix(asset.FileName, newFileName))
                            {
                                _logger.LogTrace(
                                    "[CategorizeTagsAsync] Asset {AssetId}: fileName {FileName} already has a disambiguation suffix for {NewFile}, skipping rename.",
                                    asset.Id, asset.FileName, newFileName);
                            }
                            else if (!File.Exists(newFilePath))
                            {
                                // No collision, rename directly
                                try
                                {
                                    _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath);
                                }
                                catch (Exception ex)
                                {
                                    _logger.LogWarning(ex,
                                        "[CategorizeTagsAsync] DeleteThumbnail failed for asset {AssetId}: {OldPath}. Continuing with rename.",
                                        asset.Id, oldFilePath);
                                }
                                try
                                {
                                    File.Move(oldFilePath, newFilePath);
                                    _logger.LogInformation(
                                        "[CategorizeTagsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {NewFile}",
                                        asset.Id, asset.FileName, newFileName);
                                    asset.FileName = newFileName;
                                    asset.RelativePath = newRelativePath;
                                }
                                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                {
                                    _logger.LogError(ex,
                                        "[CategorizeTagsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {NewPath}. Reverting tags.",
                                        asset.Id, oldFilePath, newFilePath);
                                    // Revert in-memory tags to match disk state
                                    asset.Tags = originalTags;
                                }
                            }
                            else
                            {
                                // Collision: try numeric suffixes
                                var baseWithoutExt = Path.GetFileNameWithoutExtension(newFileName);
                                bool found = false;
                                for (int i = 1; i <= 999; i++)
                                {
                                    var suffixedName = $"{baseWithoutExt}-{i:D2}{oldExt}";
                                    var suffixedRelPath = string.IsNullOrEmpty(oldDir) ? suffixedName : oldDir + Path.DirectorySeparatorChar + suffixedName;
                                    var suffixedPath = Path.Combine(libraryPath, suffixedRelPath);
                                    if (!File.Exists(suffixedPath))
                                    {
                                        try { _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath); } catch { }
                                        try
                                        {
                                            File.Move(oldFilePath, suffixedPath);
                                            _logger.LogInformation(
                                                "[CategorizeTagsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {SuffixedName}",
                                                asset.Id, asset.FileName, suffixedName);
                                            asset.FileName = suffixedName;
                                            asset.RelativePath = suffixedRelPath;
                                            found = true;
                                            break;
                                        }
                                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                        {
                                            _logger.LogError(ex,
                                                "[CategorizeTagsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {SuffixedPath}. Reverting tags.",
                                                asset.Id, oldFilePath, suffixedPath);
                                            break;
                                        }
                                    }
                                }
                                if (!found)
                                {
                                    _logger.LogWarning(
                                        "[CategorizeTagsAsync] Could not find unique suffixed name for asset {AssetId}: {NewPath}. Reverting tags.",
                                        asset.Id, newFilePath);
                                    // Could not find a unique name — revert in-memory tags to match disk
                                    asset.Tags = originalTags;
                                }
                            }
                        }
                        else
                        {
                            _logger.LogTrace(
                                "[CategorizeTagsAsync] No rename needed for asset {AssetId}: fileName already matches.",
                                asset.Id);
                        }
                    }
                }
            }

            return affectedAssetIds.Count;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    // ──────────────────────────────────────────────
    //  Bulk Category / Tag Operations
    // ──────────────────────────────────────────────

    public async Task<bool> RenameCategoryAsync(string oldType, string newType)
    {
        await EnsureScannedAsync();

        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return false;

        var anyModified = false;

        await _semaphore.WaitAsync();
        try
        {
            foreach (var asset in _assets)
            {
                bool tagsChanged = false;
                for (int i = 0; i < asset.Tags.Count; i++)
                {
                    var tag = asset.Tags[i];
                    if (!string.Equals(tag.Type, oldType, StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (string.Equals(tag.Type, newType, StringComparison.OrdinalIgnoreCase))
                        continue;

                    asset.Tags[i] = new AssetTag { Type = newType, Value = tag.Value };
                    tagsChanged = true;
                }

                if (tagsChanged)
                {
                    anyModified = true;

                    var reordered = ReorderTags(asset.Tags);
                    if (!ReferenceEquals(reordered, asset.Tags))
                        asset.Tags = reordered;

                    var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                    var oldExt = Path.GetExtension(asset.FileName);
                    var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                    var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                    var newRelativePath = string.IsNullOrEmpty(oldDir)
                        ? newFileName
                        : oldDir + Path.DirectorySeparatorChar + newFileName;
                    var newFilePath = Path.Combine(libraryPath, newRelativePath);

                    if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                    {
                        if (!File.Exists(newFilePath))
                        {
                            _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath);
                            File.Move(oldFilePath, newFilePath);
                            asset.FileName = newFileName;
                            asset.RelativePath = newRelativePath;
                        }
                    }
                }
            }

            return anyModified;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public async Task<bool> DeleteCategoryAsync(string type)
    {
        await EnsureScannedAsync();

        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return false;

        var anyModified = false;

        await _semaphore.WaitAsync();
        try
        {
            foreach (var asset in _assets)
            {
                bool tagsChanged = false;
                for (int i = 0; i < asset.Tags.Count; i++)
                {
                    var tag = asset.Tags[i];
                    if (!string.Equals(tag.Type, type, StringComparison.OrdinalIgnoreCase))
                        continue;

                    // Remove the type (set to null) but keep the value
                    asset.Tags[i] = new AssetTag { Type = null, Value = tag.Value };
                    tagsChanged = true;
                }

                if (tagsChanged)
                {
                    anyModified = true;

                    var reordered = ReorderTags(asset.Tags);
                    if (!ReferenceEquals(reordered, asset.Tags))
                        asset.Tags = reordered;

                    var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                    var oldExt = Path.GetExtension(asset.FileName);
                    var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                    var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                    var newRelativePath = string.IsNullOrEmpty(oldDir)
                        ? newFileName
                        : oldDir + Path.DirectorySeparatorChar + newFileName;
                    var newFilePath = Path.Combine(libraryPath, newRelativePath);

                    if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                    {
                        if (!File.Exists(newFilePath))
                        {
                            _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath);
                            File.Move(oldFilePath, newFilePath);
                            asset.FileName = newFileName;
                            asset.RelativePath = newRelativePath;
                        }
                    }
                }
            }

            return anyModified;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public async Task<bool> RenameTagValueAsync(string oldValue, string newValue)
    {
        await EnsureScannedAsync();

        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return false;

        var anyModified = false;

        await _semaphore.WaitAsync();
        try
        {
            foreach (var asset in _assets)
            {
                bool tagsChanged = false;
                for (int i = 0; i < asset.Tags.Count; i++)
                {
                    var tag = asset.Tags[i];
                    if (!string.Equals(tag.Value, oldValue, StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (string.Equals(tag.Value, newValue, StringComparison.OrdinalIgnoreCase))
                        continue;

                    asset.Tags[i] = new AssetTag { Type = tag.Type, Value = newValue };
                    tagsChanged = true;
                }

                if (tagsChanged)
                {
                    anyModified = true;

                    var reordered = ReorderTags(asset.Tags);
                    if (!ReferenceEquals(reordered, asset.Tags))
                        asset.Tags = reordered;

                    var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                    var oldExt = Path.GetExtension(asset.FileName);
                    var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                    var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                    var newRelativePath = string.IsNullOrEmpty(oldDir)
                        ? newFileName
                        : oldDir + Path.DirectorySeparatorChar + newFileName;
                    var newFilePath = Path.Combine(libraryPath, newRelativePath);

                    if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                    {
                        if (!File.Exists(newFilePath))
                        {
                            _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath);
                            File.Move(oldFilePath, newFilePath);
                            asset.FileName = newFileName;
                            asset.RelativePath = newRelativePath;
                        }
                    }
                }
            }

            return anyModified;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public async Task<bool> DeleteTagValueAsync(string value)
    {
        await EnsureScannedAsync();

        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return false;

        var anyModified = false;

        await _semaphore.WaitAsync();
        try
        {
            foreach (var asset in _assets)
            {
                bool tagsChanged = false;
                for (int i = asset.Tags.Count - 1; i >= 0; i--)
                {
                    var tag = asset.Tags[i];
                    if (!string.Equals(tag.Value, value, StringComparison.OrdinalIgnoreCase))
                        continue;

                    asset.Tags.RemoveAt(i);
                    tagsChanged = true;
                }

                if (tagsChanged)
                {
                    anyModified = true;

                    var reordered = ReorderTags(asset.Tags);
                    if (!ReferenceEquals(reordered, asset.Tags))
                        asset.Tags = reordered;

                    var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                    var oldExt = Path.GetExtension(asset.FileName);
                    var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                    var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                    var newRelativePath = string.IsNullOrEmpty(oldDir)
                        ? newFileName
                        : oldDir + Path.DirectorySeparatorChar + newFileName;
                    var newFilePath = Path.Combine(libraryPath, newRelativePath);

                    if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                    {
                        if (!File.Exists(newFilePath))
                        {
                            _thumbnailService.DeleteThumbnail(libraryPath, oldFilePath);
                            File.Move(oldFilePath, newFilePath);
                            asset.FileName = newFileName;
                            asset.RelativePath = newRelativePath;
                        }
                    }
                }
            }

            return anyModified;
        }
        finally
        {
            _semaphore.Release();
        }
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
