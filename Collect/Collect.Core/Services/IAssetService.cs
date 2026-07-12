using Collect.Core.Dtos;
using Collect.Core.Models;

namespace Collect.Core.Services;

/// <summary>
/// CRUD and search operations for assets.
/// </summary>
public interface IAssetService
{
    /// <summary>
    /// Scan the library directory for new/changed/deleted files and update the asset store.
    /// </summary>
    Task<ScanResult> ScanAsync();

    /// <summary>
    /// Get a paginated list of assets, optionally filtered by folder.
    /// </summary>
    Task<PaginatedResponse<AssetDto>> GetAssetsAsync(int page, int pageSize, string sort, string? folder = null);

    /// <summary>
    /// Get full asset detail by ID.
    /// </summary>
    Task<AssetDetailDto?> GetAssetDetailAsync(string id);

    /// <summary>
    /// Get the raw Asset model by ID.
    /// </summary>
    Task<Asset?> GetAssetAsync(string id);

    /// <summary>
    /// Update tags for an asset.
    /// </summary>
    Task<bool> UpdateTagsAsync(string id, List<AssetTag> tags);

    /// <summary>
    /// Search assets by query string.
    /// </summary>
    Task<PaginatedResponse<AssetDto>> SearchAsync(string query, int page, int pageSize);

    /// <summary>
    /// Get the file path to an asset's source file.
    /// </summary>
    string? GetAssetFilePath(string id);

    /// <summary>
    /// Get the file path to an asset's thumbnail, generating it if needed.
    /// </summary>
    Task<string?> GetThumbnailPathAsync(string id);

    /// <summary>
    /// Upload asset files to the library.
    /// </summary>
    Task<UploadResult> UploadAssetsAsync(List<IFormFile> files, string targetDir, bool parseTags);
}

/// <summary>
/// Result of a scan operation.
/// </summary>
public class ScanResult
{
    public int Added { get; set; }
    public int Removed { get; set; }
    public int Total { get; set; }
}
