namespace Collect.Core.Services;

/// <summary>
/// Generates and caches thumbnails for image assets using SkiaSharp.
/// Thumbnails are named by asset ID: .collect/thumbnails/{assetId}.webp
/// </summary>
public interface IThumbnailService
{
    /// <summary>
    /// Generate a thumbnail from the source file and save it to the output path.
    /// Returns true if the thumbnail was successfully generated.
    /// When encryptionKey is provided, the source file is decrypted before processing.
    /// Note: this method does NOT perform its own locking. Callers (e.g. GetOrCreateThumbnail)
    /// are responsible for serializing generation of the same output path.
    /// </summary>
    bool TryGenerateThumbnail(string sourceFilePath, string outputPath, int maxWidth = 400, byte[]? encryptionKey = null);

    /// <summary>
    /// Get or create a thumbnail for the given asset.
    /// If a thumbnail for that assetId already exists, returns its path without regenerating.
    /// When encryptionKey is provided, the source file is decrypted before processing.
    /// Generation is deduplicated per asset and bounded by an internal concurrency gate so
    /// multiple cold thumbnails are processed in parallel without unbounded CPU usage.
    /// </summary>
    string? GetOrCreateThumbnail(string libraryPath, string sourceFilePath, string assetId, byte[]? encryptionKey = null);

    /// <summary>
    /// Delete the thumbnail for a given asset ID, if it exists.
    /// </summary>
    void DeleteThumbnail(string libraryPath, string assetId);

    /// <summary>
    /// Delete all thumbnail files in the library's thumbnail directory whose IDs
    /// are not in the current set of asset IDs. Call after scan.
    /// </summary>
    void CleanupOrphanedThumbnails(string libraryPath, IEnumerable<string> currentAssetIds);
}
