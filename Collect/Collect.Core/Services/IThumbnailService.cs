namespace Collect.Core.Services;

/// <summary>
/// Generates and caches thumbnails for image assets using SkiaSharp.
/// </summary>
public interface IThumbnailService
{
    /// <summary>
    /// Gets the thumbnail path for an asset, generating it if missing or outdated.
    /// Returns the path to the thumbnail file, or null if generation failed.
    /// </summary>
    string? GetThumbnailPath(string assetId, string sourceFilePath);

    /// <summary>
    /// Generate a thumbnail from the source file and save it to the output path.
    /// Returns true if the thumbnail was successfully generated.
    /// </summary>
    bool TryGenerateThumbnail(string sourceFilePath, string outputPath, int maxWidth = 400);
}
