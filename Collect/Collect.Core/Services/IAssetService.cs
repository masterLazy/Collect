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
    /// When subfolders is false and folder is specified, only returns assets directly in that folder (not subdirectories).
    /// When folder is "__root__", returns assets in the library root that are not in any subdirectory.
    /// </summary>
    Task<PaginatedResponse<AssetDto>> GetAssetsAsync(int page, int pageSize, string sort, string? folder = null, bool subfolders = true);

    /// <summary>
    /// Get all assets in the in-memory store (auto-scans if empty).
    /// </summary>
    Task<List<Asset>> GetAllAssetsAsync();

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
    /// Search assets by query string, optionally filtered by folder.
    /// </summary>
    Task<PaginatedResponse<AssetDto>> SearchAsync(string query, int page, int pageSize, string? folder = null);

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
    Task<UploadResult> UploadAssetsAsync(List<IFormFile> files, string targetDir, bool keepFilename = false, List<AssetTag>? tags = null);

    /// <summary>
    /// Get an asset's image decoded and re-encoded as a PNG byte array, resized so the
    /// longest side is at most 2000px (aspect ratio preserved). Returns null if the asset
    /// or its source file is not found, or if processing fails.
    /// </summary>
    Task<byte[]?> GetClipboardImageAsync(string id);

    /// <summary>
    /// Move an asset to a different directory within the library.
    /// Returns the updated AssetDetailDto, or null if the asset was not found.
    /// </summary>
    Task<AssetDetailDto?> MoveAssetAsync(string id, string targetFolder);

    /// <summary>
    /// Delete an asset: remove from in-memory list and delete the file from disk.
    /// </summary>
    Task<bool> DeleteAssetAsync(string id);

    /// <summary>
    /// Get current tag conflicts (values with multiple different type prefixes across assets).
    /// </summary>
    Task<List<TagConflict>> GetTagConflictsAsync();

    /// <summary>
    /// Resolve tag conflicts by applying user-chosen types.
    /// </summary>
    Task<bool> ResolveTagConflictsAsync(List<TagConflictResolution> resolutions);

    /// <summary>
    /// Batch-update the type/category of a tag value across ALL assets.
    /// When NewType is null, the tag type is removed (uncategorized).
    /// Returns the number of assets affected.
    /// </summary>
    Task<int> CategorizeTagsAsync(BatchCategorizeRequest request);

    /// <summary>
    /// Encrypt all files in the current library with the given password.
    /// When <paramref name="encryptFileNames"/> is true (default), on-disk file names are also
    /// encrypted (deterministic, reversible) and the EncryptFileNames flag is set in library.json.
    /// Updates library.json with encryption metadata and encrypts all asset files in-place.
    /// Returns the number of files encrypted.
    /// </summary>
    Task<int> EncryptLibraryAsync(string password);

    /// <summary>
    /// Decrypt all encrypted files in the current library and remove encryption.
    /// Requires the library to be unlocked, or a password for repair decryption.
    /// When repairing a non-encrypted library, provide the original password.
    /// Returns the number of files decrypted.
    /// </summary>
    Task<int> DecryptLibraryAsync(string? password = null);

    /// <summary>
    /// Rename a category (type) across ALL assets. Changes all tags with oldType to newType.
    /// </summary>
    Task<bool> RenameCategoryAsync(string oldType, string newType);

    /// <summary>
    /// Delete a category by removing the type from all tags that have it (sets Type=null).
    /// </summary>
    Task<bool> DeleteCategoryAsync(string type);

    /// <summary>
    /// Rename a tag value across ALL assets.
    /// </summary>
    Task<bool> RenameTagValueAsync(string oldValue, string newValue);

    /// <summary>
    /// Delete a tag value from ALL assets entirely.
    /// </summary>
    Task<bool> DeleteTagValueAsync(string value);

    /// <summary>
    /// Compute (or retrieve cached) color palette for the specified asset.
    /// Returns null if the asset is not found. The palette is computed lazily
    /// using K-means clustering on the image pixels, cached in .collect/palettes.json.
    /// </summary>
    Task<ColorPalette?> ComputePaletteAsync(string id);

    /// <summary>
    /// Invalidate the in-memory asset cache so the next fetch triggers a fresh scan.
    /// Used after unlocking an encrypted library to re-extract dimensions with the decryption key.
    /// </summary>
    void InvalidateCache();
}

/// <summary>
/// Result of a scan operation.
/// </summary>
public class ScanResult
{
    public int Added { get; set; }
    public int Removed { get; set; }
    public int Total { get; set; }
    public List<TagConflict> TagConflicts { get; set; } = new();
}

public class TagConflict
{
    public string TagValue { get; set; } = string.Empty;
    public List<string> PossibleTypes { get; set; } = new();
}

public class TagConflictResolution
{
    public string TagValue { get; set; } = string.Empty;
    public string ChosenType { get; set; } = string.Empty;
}

public class BatchCategorizeRequest
{
    public List<TagCategoryChange> Changes { get; set; } = new();
}

public class TagCategoryChange
{
    public string TagValue { get; set; } = string.Empty;
    public string? NewType { get; set; }
}
