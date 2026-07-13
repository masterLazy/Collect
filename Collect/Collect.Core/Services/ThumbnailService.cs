using SkiaSharp;

namespace Collect.Core.Services;

/// <summary>
/// Generates WebP thumbnails using SkiaSharp.
/// Maintains aspect ratio with a max width of 400px.
/// Thread-safe via a static lock on generation.
/// Supports encrypted source files via optional encryption key.
/// </summary>
public class ThumbnailService : IThumbnailService
{
    private const int ThumbnailMaxWidth = 400;
    private const int WebpQuality = 85;
    private static readonly object _lock = new();

    private readonly IEncryptionService _encryptionService;

    public ThumbnailService(IEncryptionService encryptionService)
    {
        _encryptionService = encryptionService;
    }

    /// <summary>
    /// Gets the thumbnail path for an asset, generating it if missing or outdated.
    /// Returns the path to the thumbnail file, or null if generation failed.
    /// When <paramref name="encryptionKey"/> is provided, the source file is decrypted before processing.
    /// </summary>
    public string? GetThumbnailPath(string assetId, string sourceFilePath, byte[]? encryptionKey = null)
    {
        var thumbDir = Path.Combine(
            Path.GetDirectoryName(Path.GetDirectoryName(sourceFilePath)) ?? ".",
            ".collect", "thumbnails");

        var thumbPath = Path.Combine(thumbDir, $"{assetId}.webp");

        if (!File.Exists(sourceFilePath))
            return null;

        if (IsThumbnailValid(sourceFilePath, thumbPath))
            return thumbPath;

        return TryGenerateThumbnail(sourceFilePath, thumbPath, ThumbnailMaxWidth, encryptionKey)
            ? thumbPath
            : null;
    }

    /// <summary>
    /// Generate a thumbnail from the source file and save it to the output path.
    /// Returns true if the thumbnail was successfully generated.
    /// When <paramref name="encryptionKey"/> is provided, the source file is decrypted before processing.
    /// </summary>
    public bool TryGenerateThumbnail(string sourceFilePath, string outputPath, int maxWidth = 400, byte[]? encryptionKey = null)
    {
        // Thread-safe: only one thumbnail generation at a time
        lock (_lock)
        {
            try
            {
                var dir = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);

                if (encryptionKey is not null)
                {
                    // Decrypt the source file before decoding
                    var decrypted = _encryptionService.ReadAndDecryptFile(sourceFilePath, encryptionKey);
                    using var original = SKBitmap.Decode(decrypted);

                    if (original == null)
                        return false;

                    return GenerateAndSaveThumbnail(original, outputPath, maxWidth);
                }
                else
                {
                    using var input = File.OpenRead(sourceFilePath);
                    using var original = SKBitmap.Decode(input);

                    if (original == null)
                        return false;

                    return GenerateAndSaveThumbnail(original, outputPath, maxWidth);
                }
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>
    /// Generate a thumbnail from a decoded bitmap and save it as WebP.
    /// </summary>
    private static bool GenerateAndSaveThumbnail(SKBitmap original, string outputPath, int maxWidth)
    {
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

    /// <summary>
    /// Get or create a thumbnail for the given source file, keyed by its relative path + metadata.
    /// If a thumbnail already exists and is up-to-date, returns its path without regenerating.
    /// Uses file size + last-write time (not content hash) as the key — avoids reading file content.
    /// When <paramref name="encryptionKey"/> is provided, the source file is decrypted before processing.
    /// </summary>
    public string? GetOrCreateContentHashThumbnail(string libraryPath, string sourceFilePath, byte[]? encryptionKey = null)
    {
        if (!File.Exists(sourceFilePath))
            return null;

        var thumbDir = Path.Combine(libraryPath, ".collect", "thumbnails");
        Directory.CreateDirectory(thumbDir);

        var thumbPath = ComputeThumbnailPath(libraryPath, sourceFilePath);

        if (File.Exists(thumbPath))
            return thumbPath;

        return TryGenerateThumbnail(sourceFilePath, thumbPath, encryptionKey: encryptionKey) ? thumbPath : null;
    }

    /// <summary>
    /// Delete the thumbnail for a given source file path, if it exists.
    /// </summary>
    public void DeleteThumbnail(string libraryPath, string sourceFilePath)
    {
        var thumbPath = ComputeThumbnailPath(libraryPath, sourceFilePath);
        if (File.Exists(thumbPath))
            File.Delete(thumbPath);
    }

    /// <summary>
    /// Delete all thumbnail files in the library's thumbnail directory that do not
    /// correspond to any current asset's source file. Call after scan to prevent
    /// orphaned thumbnails from accumulating when files are renamed or deleted externally.
    /// </summary>
    public void CleanupOrphanedThumbnails(string libraryPath, IEnumerable<string> currentAssetFilePaths)
    {
        var thumbDir = Path.Combine(libraryPath, ".collect", "thumbnails");
        if (!Directory.Exists(thumbDir))
            return;

        // Build the set of expected thumbnail filenames for all current assets
        var expectedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var filePath in currentAssetFilePaths)
        {
            var thumbPath = ComputeThumbnailPath(libraryPath, filePath);
            expectedNames.Add(Path.GetFileName(thumbPath));
        }

        // Delete any .webp file in the thumbnail directory not in the expected set
        foreach (var thumbFile in Directory.EnumerateFiles(thumbDir, "*.webp"))
        {
            var fileName = Path.GetFileName(thumbFile);
            if (!expectedNames.Contains(fileName))
            {
                try
                {
                    File.Delete(thumbFile);
                }
                catch (Exception ex)
                {
                    // Log and continue — one failure should not stop cleanup
                    Console.Error.WriteLine($"Failed to delete orphaned thumbnail {thumbFile}: {ex.Message}");
                }
            }
        }
    }

    private static string ComputeThumbnailPath(string libraryPath, string sourceFilePath)
    {
        var thumbDir = Path.Combine(libraryPath, ".collect", "thumbnails");
        var fileInfo = new FileInfo(sourceFilePath);
        var key = sourceFilePath.ToLowerInvariant() + "|" + fileInfo.Length + "|" + fileInfo.LastWriteTimeUtc.Ticks;
        var hash = Convert.ToHexString(System.Security.Cryptography.MD5.HashData(
            System.Text.Encoding.UTF8.GetBytes(key))).ToLowerInvariant();
        return Path.Combine(thumbDir, $"{hash}.webp");
    }
}
