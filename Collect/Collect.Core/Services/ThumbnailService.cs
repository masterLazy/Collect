using SkiaSharp;

namespace Collect.Core.Services;

/// <summary>
/// Generates WebP thumbnails using SkiaSharp.
/// Maintains aspect ratio with a max width of 400px.
/// Thread-safe via a static lock on generation.
/// </summary>
public class ThumbnailService : IThumbnailService
{
    private const int ThumbnailMaxWidth = 400;
    private const int WebpQuality = 85;
    private static readonly object _lock = new();

    /// <summary>
    /// Gets the thumbnail path for an asset, generating it if missing or outdated.
    /// Returns the path to the thumbnail file, or null if generation failed.
    /// </summary>
    public string? GetThumbnailPath(string assetId, string sourceFilePath)
    {
        var thumbDir = Path.Combine(
            Path.GetDirectoryName(Path.GetDirectoryName(sourceFilePath)) ?? ".",
            ".collect", "thumbnails");

        var thumbPath = Path.Combine(thumbDir, $"{assetId}.webp");

        if (!File.Exists(sourceFilePath))
            return null;

        if (IsThumbnailValid(sourceFilePath, thumbPath))
            return thumbPath;

        return TryGenerateThumbnail(sourceFilePath, thumbPath, ThumbnailMaxWidth)
            ? thumbPath
            : null;
    }

    /// <summary>
    /// Generate a thumbnail from the source file and save it to the output path.
    /// Returns true if the thumbnail was successfully generated.
    /// </summary>
    public bool TryGenerateThumbnail(string sourceFilePath, string outputPath, int maxWidth = 400)
    {
        // Thread-safe: only one thumbnail generation at a time
        lock (_lock)
        {
            try
            {
                var dir = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);

                using var input = File.OpenRead(sourceFilePath);
                using var original = SKBitmap.Decode(input);

                if (original == null)
                    return false;

                // Calculate new dimensions maintaining aspect ratio
                int newWidth = Math.Min(maxWidth, original.Width);
                int newHeight = (int)((double)newWidth / original.Width * original.Height);

                // Resize the bitmap using SkiaSharp 3.x compatible API
                using var resized = original.Resize(
                    new SKImageInfo(newWidth, newHeight),
                    new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));

                if (resized == null)
                    return false;

                // Encode as WebP
                using var image = SKImage.FromBitmap(resized);
                using var data = image.Encode(SKEncodedImageFormat.Webp, WebpQuality);

                // Write to disk
                using var output = File.OpenWrite(outputPath);
                data.SaveTo(output);

                return true;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>
    /// Check if a thumbnail exists and is up-to-date compared to the source file.
    /// </summary>
    private static bool IsThumbnailValid(string sourcePath, string thumbnailPath)
    {
        if (!File.Exists(thumbnailPath))
            return false;

        var sourceLastWrite = File.GetLastWriteTimeUtc(sourcePath);
        var thumbnailLastWrite = File.GetLastWriteTimeUtc(thumbnailPath);

        return thumbnailLastWrite >= sourceLastWrite;
    }
}
