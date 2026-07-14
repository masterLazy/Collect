namespace Collect.Core.Services;

/// <summary>
/// Generates and caches thumbnails for image assets using SkiaSharp.
/// </summary>
public interface IThumbnailService
{
    /// <summary>
    /// Gets the thumbnail path for an asset, generating it if missing or outdated.
    /// Returns the path to the thumbnail file, or null if generation failed.
    /// When <paramref name="encryptionKey"/> is provided, the source file is decrypted before processing.
    /// </summary>
    string? GetThumbnailPath(string assetId, string sourceFilePath, byte[]? encryptionKey = null);

    /// <summary>
    /// Generate a thumbnail from the source file and save it to the output path.
    /// Returns true if the thumbnail was successfully generated.
    /// When <paramref name="encryptionKey"/> is provided, the source file is decrypted before processing.
    /// </summary>
    bool TryGenerateThumbnail(string sourceFilePath, string outputPath, int maxWidth = 400, byte[]? encryptionKey = null);

    /// <summary>
    /// Get or create a thumbnail for the given source file, keyed by its content hash (MD5).
    /// If a thumbnail for the same content already exists, returns its path without regenerating.
    /// When <paramref name="encryptionKey"/> is provided, the source file is decrypted before processing.
    /// </summary>
    string? GetOrCreateContentHashThumbnail(string libraryPath, string sourceFilePath, byte[]? encryptionKey = null);

    /// <summary>
    /// Delete the thumbnail for a given source file path, if it exists.
    /// </summary>
    void DeleteThumbnail(string libraryPath, string sourceFilePath);

    /// <summary>
    /// Delete all thumbnail files in the library's thumbnail directory that do not
    /// correspond to any current asset's source file. Call after scan to prevent
    /// orphaned thumbnails from accumulating when files are renamed or deleted externally.
    /// </summary>
    void CleanupOrphanedThumbnails(string libraryPath, IEnumerable<string> currentAssetFilePaths);
}
