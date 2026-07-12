using Collect.Core.Dtos;
using Collect.Core.Models;
using Collect.Core.Services;
using Microsoft.AspNetCore.Mvc;

namespace Collect.Core.Controllers;

[ApiController]
[Route("api/assets")]
public class AssetsController : ControllerBase
{
    private readonly IAssetService _assetService;

    public AssetsController(IAssetService assetService)
    {
        _assetService = assetService;
    }

    /// <summary>
    /// POST /api/assets/scan
    /// Scan the library directory for new, changed, or deleted files.
    /// </summary>
    [HttpPost("scan")]
    public async Task<IActionResult> Scan()
    {
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
    /// GET /api/assets?page=1&amp;size=30&amp;sort=newest&amp;folder=...
    /// Get a paginated list of assets, optionally filtered by folder.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAssets(
        [FromQuery] int page = 1,
        [FromQuery] int size = 30,
        [FromQuery] string? folder = null,
        [FromQuery] string sort = "newest")
    {
        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 100);

        var result = await _assetService.GetAssetsAsync(page, size, sort, folder);
        return Ok(result);
    }

    /// <summary>
    /// GET /api/assets/{id}
    /// Get full detail for a single asset.
    /// </summary>
    [HttpGet("{id}")]
    public async Task<IActionResult> GetAsset(string id)
    {
        var detail = await _assetService.GetAssetDetailAsync(id);
        if (detail is null)
            return NotFound(new { error = $"Asset '{id}' not found." });

        return Ok(detail);
    }

    /// <summary>
    /// GET /api/assets/{id}/thumbnail
    /// Serve the thumbnail image for an asset (generates if missing).
    /// </summary>
    [HttpGet("{id}/thumbnail")]
    public async Task<IActionResult> GetThumbnail(string id)
    {
        var thumbPath = await _assetService.GetThumbnailPathAsync(id);
        if (thumbPath is null || !System.IO.File.Exists(thumbPath))
            return NotFound(new { error = "Thumbnail not available." });

        return PhysicalFile(thumbPath, "image/webp");
    }

    /// <summary>
    /// GET /api/assets/{id}/image
    /// Serve the original image file for an asset.
    /// </summary>
    [HttpGet("{id}/image")]
    public async Task<IActionResult> GetImage(string id)
    {
        var asset = await _assetService.GetAssetAsync(id);
        if (asset is null)
            return NotFound(new { error = $"Asset '{id}' not found." });

        var filePath = _assetService.GetAssetFilePath(id);
        if (filePath is null || !System.IO.File.Exists(filePath))
            return NotFound(new { error = "Image file not found on disk." });

        return PhysicalFile(filePath, asset.MimeType);
    }

    /// <summary>
    /// PUT /api/assets/{id}/tags
    /// Update the tags for an asset.
    /// </summary>
    [HttpPut("{id}/tags")]
    public async Task<IActionResult> UpdateTags(string id, [FromBody] UpdateTagsRequest request)
    {
        var success = await _assetService.UpdateTagsAsync(id, request.Tags);
        if (!success)
            return NotFound(new { error = $"Asset '{id}' not found." });

        return Ok(new { message = "Tags updated." });
    }

    /// <summary>
    /// GET /api/assets/search?q=tags:a+b+c&amp;page=1&amp;size=30
    /// Search assets by tags or filename.
    /// </summary>
    [HttpGet("search")]
    public async Task<IActionResult> Search(
        [FromQuery] string q,
        [FromQuery] int page = 1,
        [FromQuery] int size = 30)
    {
        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 100);

        if (string.IsNullOrWhiteSpace(q))
        {
            // No query → return all assets
            var result = await _assetService.GetAssetsAsync(page, size, "newest");
            return Ok(result);
        }

        var searchResult = await _assetService.SearchAsync(q, page, size);
        return Ok(searchResult);
    }

    /// <summary>
    /// POST /api/assets/upload
    /// Upload asset files (multipart form-data).
    /// </summary>
    [HttpPost("upload")]
    [RequestSizeLimit(200 * 1024 * 1024)] // 200MB
    public async Task<IActionResult> Upload(
        [FromForm] List<IFormFile> files,
        [FromForm] string targetDir,
        [FromForm] bool parseTags = true)
    {
        if (files is null || files.Count == 0)
            return BadRequest(new { error = "No files provided." });

        var result = await _assetService.UploadAssetsAsync(files, targetDir, parseTags);
        return Ok(result);
    }
}

public class UpdateTagsRequest
{
    public List<AssetTag> Tags { get; set; } = new();
}
