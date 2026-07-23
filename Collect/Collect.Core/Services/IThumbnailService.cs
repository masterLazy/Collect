using SkiaSharp;

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
    /// When <paramref name="onNewThumbnail"/> is set, it is called with the resized bitmap
    /// after generation so callers can perform additional processing (e.g. palette extraction).
    /// </summary>
    bool TryGenerateThumbnail(string sourceFilePath, string outputPath, int maxWidth = 400, byte[]? encryptionKey = null, Action<SKBitmap>? onNewThumbnail = null);

    /// <summary>
    /// Get or create a thumbnail for the given asset.
    /// If a thumbnail for that assetId already exists, returns its path without regenerating.
    /// When encryptionKey is provided, the source file is decrypted before processing.
    /// When a new thumbnail is generated, <paramref name="onNewThumbnail"/> is called with the
    /// resized bitmap (before saving to disk) so callers can perform additional processing,
    /// such as color palette extraction.
    /// </summary>
    string? GetOrCreateThumbnail(string libraryPath, string sourceFilePath, string assetId, byte[]? encryptionKey = null, Action<SKBitmap>? onNewThumbnail = null);

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
