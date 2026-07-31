using Collect.Core.Dtos;
using Collect.Core.Models;
using Collect.Core.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System.Security.Cryptography;

namespace Collect.Core.Controllers;

[ApiController]
[Route("api/assets")]
public class AssetsController : ControllerBase
{
    private readonly IAssetService _assetService;
    private readonly ILibraryService _libraryService;
    private readonly IEncryptionService _encryptionService;
    private readonly ILogger<AssetsController> _logger;

    public AssetsController(
        IAssetService assetService,
        ILibraryService libraryService,
        IEncryptionService encryptionService,
        ILogger<AssetsController> logger)
    {
        _assetService = assetService;
        _libraryService = libraryService;
        _encryptionService = encryptionService;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/assets/scan
    /// Scan the library directory for new, changed, or deleted files.
    /// </summary>
    [HttpPost("scan")]
    public async Task<IActionResult> Scan()
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        try
        {
            var result = await _assetService.ScanAsync();
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/assets?page=1&amp;size=30&amp;sort=newest&amp;folder=...&amp;subfolders=true
    /// Get a paginated list of assets, optionally filtered by folder.
    /// subfolders=true (default): include assets in subdirectories recursively.
    /// subfolders=false: only assets directly in the specified folder.
    /// folder=__root__: assets in the library root (not in any subdirectory).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAssets(
        [FromQuery] int page = 1,
        [FromQuery] int size = 30,
        [FromQuery] string? folder = null,
        [FromQuery] string sort = "newest",
        [FromQuery] bool subfolders = true)
    {
        // Strict mode: a name-encrypted library that is locked must not reveal real names/tags.
        if (_libraryService.IsEncryptedLibrary() && _libraryService.EncryptsFileNames() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 100);

        var result = await _assetService.GetAssetsAsync(page, size, sort, folder, subfolders);
        return Ok(result);
    }

    /// <summary>
    /// GET /api/assets/{id}
    /// Get full detail for a single asset.
    /// </summary>
    [HttpGet("{id}")]
    public async Task<IActionResult> GetAsset(string id)
    {
        // Strict mode: a name-encrypted library that is locked must not reveal real names/tags.
        if (_libraryService.IsEncryptedLibrary() && _libraryService.EncryptsFileNames() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var detail = await _assetService.GetAssetDetailAsync(id);
        if (detail is null)
            return NotFound(new { error = $"Asset '{id}' not found." });

        return Ok(detail);
    }

    private string? GetUnlockToken() =>
        Request.Headers.TryGetValue("X-Unlock-Token", out var values) ? values.FirstOrDefault() : null;

    /// <summary>
    /// GET /api/assets/{id}/thumbnail
    /// Serve the thumbnail image for an asset (generates if missing).
    /// Returns 403 if the library is encrypted and not unlocked.
    /// </summary>
    [HttpGet("{id}/thumbnail")]
    public async Task<IActionResult> GetThumbnail(string id)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var thumbPath = await _assetService.GetThumbnailPathAsync(id);
        if (thumbPath is null || !System.IO.File.Exists(thumbPath))
        {
            _logger.LogWarning("Thumbnail not available for asset {Id} (path: {Path})", id, thumbPath);
            return NotFound(new { error = "Thumbnail not available." });
        }

        // Prevent browser caching — ensures locked library thumbnails aren't served from cache
        Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";

        var encryptionKey = _libraryService.GetEncryptionKey(GetUnlockToken());
        if (encryptionKey is not null)
        {
            try
            {
                var decrypted = _encryptionService.ReadAndDecryptFile(thumbPath, encryptionKey);
                _logger.LogInformation("Thumbnail: serving asset {Id}, decrypted {Len} bytes", id, decrypted.Length);
                return File(decrypted, "image/webp");
            }
            catch (AuthenticationTagMismatchException)
            {
                // Thumbnail is plaintext (e.g. generated before the library was encrypted). Re-encrypt it
                // in place so it matches the library's encryption state, then serve the plaintext bytes
                // (future requests decrypt normally — this self-heals the inconsistency on first access).
                _logger.LogWarning("Thumbnail: decrypt mismatch for asset {Id} at {Path} — re-encrypting and serving", id, thumbPath);
                try
                {
                    var plaintextThumb = System.IO.File.ReadAllBytes(thumbPath);
                    var encryptedThumb = _encryptionService.Encrypt(plaintextThumb, encryptionKey);
                    SafeFileIO.WriteAllBytesAtomic(thumbPath, encryptedThumb, _logger);
                    return File(plaintextThumb, "image/webp");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Thumbnail: failed to re-encrypt plaintext thumbnail at {Path} — serving as-is", thumbPath);
                    return PhysicalFile(thumbPath, "image/webp");
                }
            }
        }

        // No key available — an encrypted library must be locked at this point.
        if (_libraryService.IsEncryptedLibrary())
        {
            _logger.LogWarning("Thumbnail: locked (no key) for asset {Id}", id);
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });
        }

        _logger.LogInformation("Thumbnail: serving plaintext file for asset {Id}", id);
        return PhysicalFile(thumbPath, "image/webp");
    }

    /// <summary>
    /// GET /api/assets/{id}/image
    /// Serve the original image file for an asset.
    /// If the library is encrypted, decrypts the file before serving.
    /// Returns 403 if the library is encrypted and not unlocked.
    /// </summary>
    [HttpGet("{id}/image")]
    public async Task<IActionResult> GetImage(string id)
    {
        var asset = await _assetService.GetAssetAsync(id);
        if (asset is null)
        {
            _logger.LogWarning("Image: asset {Id} not found", id);
            return NotFound(new { error = $"Asset '{id}' not found." });
        }

        var filePath = _assetService.GetAssetFilePath(id);
        if (filePath is null || !System.IO.File.Exists(filePath))
        {
            _logger.LogWarning("Image: file missing for asset {Id} (path: {Path})", id, filePath);
            return NotFound(new { error = "Image file not found on disk." });
        }

        Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";

        // Decrypt first if a key is available (encrypted library, unlocked).
        var encryptionKey = _libraryService.GetEncryptionKey(GetUnlockToken());
        _logger.LogInformation("Image: asset {Id} — library encrypted={Encrypted}, key present={Key}", id, _libraryService.IsEncryptedLibrary(), encryptionKey is not null);
        if (encryptionKey is not null)
        {
            try
            {
                var decrypted = _encryptionService.ReadAndDecryptFile(filePath, encryptionKey);
                var detected = ImageMimeDetector.Detect(decrypted);
                _logger.LogInformation("Image: serving asset {Id}, decrypted {Len} bytes, magic={Magic}, mime={Mime} (ext mime={ExtMime})",
                    id, decrypted.Length, ImageMimeDetector.MagicHex(decrypted), detected ?? "unknown", asset.MimeType);
                return File(decrypted, detected ?? asset.MimeType);
            }
            catch (AuthenticationTagMismatchException)
            {
                _logger.LogWarning("Image: decrypt mismatch for asset {Id} at {Path} — treating as plaintext", id, filePath);
                // File is plaintext (not actually encrypted) — serve as-is.
                // Also guards against a transient IsEncryptedLibrary() misread that would
                // otherwise serve raw ciphertext as an image (200 with undecodable bytes).
            }
        }

        // No key available — must be locked (encrypted) or a plain library.
        if (_libraryService.IsEncryptedLibrary())
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        return PhysicalFile(filePath, asset.MimeType);
    }

    /// <summary>
    /// PUT /api/assets/{id}/tags
    /// Update the tags for an asset. Also renames the file on disk to match the new tags.
    /// </summary>
    [HttpPut("{id}/tags")]
    public async Task<IActionResult> UpdateTags(string id, [FromBody] UpdateTagsRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var success = await _assetService.UpdateTagsAsync(id, request.Tags);
        if (!success)
            return NotFound(new { error = $"Asset '{id}' not found." });

        var detail = await _assetService.GetAssetDetailAsync(id);
        return Ok(detail);
    }

    /// <summary>
    /// GET /api/assets/search?q=tags:a+b+c&amp;page=1&amp;size=30&amp;folder=...
    /// Search assets by tags or filename, optionally filtered by folder.
    /// </summary>
    [HttpGet("search")]
    public async Task<IActionResult> Search(
        [FromQuery] string q,
        [FromQuery] int page = 1,
        [FromQuery] int size = 30,
        [FromQuery] string? folder = null)
    {
        // Strict mode: a name-encrypted library that is locked must not reveal real names/tags.
        if (_libraryService.IsEncryptedLibrary() && _libraryService.EncryptsFileNames() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 100);

        if (string.IsNullOrWhiteSpace(q))
        {
            // No query → return all assets
            var result = await _assetService.GetAssetsAsync(page, size, "newest", folder);
            return Ok(result);
        }

        var searchResult = await _assetService.SearchAsync(q, page, size, folder);
        return Ok(searchResult);
    }

    /// <summary>
    /// GET /api/assets/tag-conflicts
    /// Get current tag conflicts (values with multiple different type prefixes).
    /// </summary>
    [HttpGet("tag-conflicts")]
    public async Task<IActionResult> GetTagConflicts()
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var conflicts = await _assetService.GetTagConflictsAsync();
        return Ok(conflicts);
    }

    /// <summary>
    /// GET /api/assets/{id}/clipboard-image
    /// Return the asset's image as a PNG blob (resized to max 2000px on longest side),
    /// suitable for clipboard copying.
    /// Returns 403 if the library is encrypted and not unlocked.
    /// </summary>
    [HttpGet("{id}/clipboard-image")]
    public async Task<IActionResult> GetClipboardImage(string id)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        try
        {
            var pngData = await _assetService.GetClipboardImageAsync(id);
            if (pngData is null)
                return NotFound(new { error = $"Asset '{id}' not found or file missing." });

            return File(pngData, "image/png");
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = "Failed to process clipboard image.", detail = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/assets/{id}/move
    /// Move an asset to a different directory. Creates the target directory if needed.
    /// </summary>
    [HttpPost("{id}/move")]
    public async Task<IActionResult> MoveAsset(string id, [FromBody] MoveAssetRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var result = await _assetService.MoveAssetAsync(id, request.TargetFolder);
        if (result is null)
            return NotFound(new { error = $"Asset '{id}' not found or target path already exists." });

        return Ok(result);
    }

    /// <summary>
    /// POST /api/assets/upload
    /// Upload asset files (multipart form-data).
    /// If keepFilename is true, original filename is preserved; otherwise only the extension is used.
    /// </summary>
    [HttpPost("upload")]
    [RequestSizeLimit(200 * 1024 * 1024)] // 200MB
    public async Task<IActionResult> Upload(
        [FromForm] List<IFormFile> files,
        [FromForm] string targetDir,
        [FromForm] bool keepFilename = false,
        [FromForm(Name = "tags")] string? tags = null,
        [FromForm(Name = "tagsJson")] string? tagsJson = null)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        if (files is null || files.Count == 0)
            return BadRequest(new { error = "No files provided." });

        List<AssetTag>? parsedTags = null;
        var tagsPayload = !string.IsNullOrWhiteSpace(tags) ? tags : tagsJson;
        if (!string.IsNullOrWhiteSpace(tagsPayload))
        {
            try
            {
                var options = new System.Text.Json.JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                };
                parsedTags = System.Text.Json.JsonSerializer.Deserialize<List<AssetTag>>(tagsPayload, options);
            }
            catch { }
        }

        parsedTags = parsedTags?
            .Where(t => !string.IsNullOrWhiteSpace(t.Value))
            .Select(t => new AssetTag { Type = t.Type, Value = t.Value.Trim() })
            .ToList();

        var result = await _assetService.UploadAssetsAsync(files, targetDir, keepFilename, parsedTags);
        return Ok(result);
    }

    /// <summary>
    /// POST /api/assets/resolve-tag-conflicts
    /// Resolve tag normalization conflicts (user chooses a type for ambiguous tags).
    /// </summary>
    [HttpPost("resolve-tag-conflicts")]
    public async Task<IActionResult> ResolveTagConflicts([FromBody] ResolveTagConflictsRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var success = await _assetService.ResolveTagConflictsAsync(request.Resolutions);
        return Ok(new { success });
    }

    /// <summary>
    /// POST /api/assets/categorize
    /// Batch-update the category (type) of tag values across all assets.
    /// </summary>
    [HttpPost("categorize")]
    public async Task<IActionResult> CategorizeTags([FromBody] BatchCategorizeRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var affected = await _assetService.CategorizeTagsAsync(request);
        return Ok(new { affectedAssets = affected });
    }

    /// <summary>
    /// POST /api/assets/rename-category
    /// Rename a category (type) across ALL assets.
    /// </summary>
    [HttpPost("rename-category")]
    public async Task<IActionResult> RenameCategory([FromBody] RenameCategoryRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var success = await _assetService.RenameCategoryAsync(request.OldType, request.NewType);
        return Ok(new { success });
    }

    /// <summary>
    /// POST /api/assets/delete-category
    /// Delete a category by removing the type from all tags that have it.
    /// </summary>
    [HttpPost("delete-category")]
    public async Task<IActionResult> DeleteCategory([FromBody] DeleteCategoryRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var success = await _assetService.DeleteCategoryAsync(request.Type);
        return Ok(new { success });
    }

    /// <summary>
    /// POST /api/assets/rename-tag
    /// Rename a tag value across ALL assets.
    /// </summary>
    [HttpPost("rename-tag")]
    public async Task<IActionResult> RenameTag([FromBody] RenameTagRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var success = await _assetService.RenameTagValueAsync(request.OldValue, request.NewValue);
        return Ok(new { success });
    }

    /// <summary>
    /// DELETE /api/assets/{id}
    /// Delete an asset: remove from in-memory list and delete the file from disk.
    /// </summary>
    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteAsset(string id)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var success = await _assetService.DeleteAssetAsync(id);
        if (!success)
            return NotFound(new { error = $"Asset '{id}' not found." });

        return Ok(new { success = true });
    }

    /// <summary>
    /// POST /api/assets/delete-tag
    /// Delete a tag value from ALL assets entirely.
    /// </summary>
    [HttpPost("delete-tag")]
    public async Task<IActionResult> DeleteTag([FromBody] DeleteTagRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var success = await _assetService.DeleteTagValueAsync(request.Value);
        return Ok(new { success });
    }
}

public class UpdateTagsRequest
{
    public List<AssetTag> Tags { get; set; } = new();
}

public class MoveAssetRequest
{
    public string TargetFolder { get; set; } = string.Empty;
}

public class ResolveTagConflictsRequest
{
    public List<TagConflictResolution> Resolutions { get; set; } = new();
}

public class RenameCategoryRequest
{
    public string OldType { get; set; } = string.Empty;
    public string NewType { get; set; } = string.Empty;
}

public class DeleteCategoryRequest
{
    public string Type { get; set; } = string.Empty;
}

public class RenameTagRequest
{
    public string OldValue { get; set; } = string.Empty;
    public string NewValue { get; set; } = string.Empty;
}

public class DeleteTagRequest
{
    public string Value { get; set; } = string.Empty;
}
