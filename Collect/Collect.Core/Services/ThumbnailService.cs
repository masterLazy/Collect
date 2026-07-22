using SkiaSharp;

namespace Collect.Core.Services;

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

    public bool TryGenerateThumbnail(string sourceFilePath, string outputPath, int maxWidth = 400, byte[]? encryptionKey = null)
    {
        lock (_lock)
        {
            try
            {
                var dir = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);

                bool generated;
                if (encryptionKey is not null)
                {
                    var decrypted = _encryptionService.ReadAndDecryptFile(sourceFilePath, encryptionKey);
                    using var original = SKBitmap.Decode(decrypted);
                    if (original == null) return false;
                    generated = GenerateAndSaveThumbnail(original, outputPath, maxWidth);
                }
                else
                {
                    using var input = File.OpenRead(sourceFilePath);
                    using var original = SKBitmap.Decode(input);
                    if (original == null) return false;
                    generated = GenerateAndSaveThumbnail(original, outputPath, maxWidth);
                }

                if (generated && encryptionKey is not null)
                {
                    var plaintext = File.ReadAllBytes(outputPath);
                    var encrypted = _encryptionService.Encrypt(plaintext, encryptionKey);
                    File.WriteAllBytes(outputPath, encrypted);
                }

                return generated;
            }
            catch
            {
                return false;
            }
        }
    }

    public string? GetOrCreateThumbnail(string libraryPath, string sourceFilePath, string assetId, byte[]? encryptionKey = null)
    {
        if (!File.Exists(sourceFilePath))
            return null;

        var thumbDir = Path.Combine(libraryPath, ".collect", "thumbnails");
        Directory.CreateDirectory(thumbDir);

        var thumbPath = Path.Combine(thumbDir, $"{assetId}.webp");

        if (File.Exists(thumbPath))
            return thumbPath;

        return TryGenerateThumbnail(sourceFilePath, thumbPath, ThumbnailMaxWidth, encryptionKey)
            ? thumbPath
            : null;
    }

    public void DeleteThumbnail(string libraryPath, string assetId)
    {
        var thumbDir = Path.Combine(libraryPath, ".collect", "thumbnails");
        var thumbPath = Path.Combine(thumbDir, $"{assetId}.webp");
        if (File.Exists(thumbPath))
            File.Delete(thumbPath);
    }

    public void CleanupOrphanedThumbnails(string libraryPath, IEnumerable<string> currentAssetIds)
    {
        var thumbDir = Path.Combine(libraryPath, ".collect", "thumbnails");
        if (!Directory.Exists(thumbDir))
            return;

        var expectedIds = new HashSet<string>(currentAssetIds, StringComparer.OrdinalIgnoreCase);

        foreach (var thumbFile in Directory.EnumerateFiles(thumbDir, "*.webp"))
        {
            var idWithoutExt = Path.GetFileNameWithoutExtension(thumbFile);
            if (!expectedIds.Contains(idWithoutExt))
            {
                try
                {
                    File.Delete(thumbFile);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Failed to delete orphaned thumbnail {thumbFile}: {ex.Message}");
                }
            }
        }
    }

    private static bool GenerateAndSaveThumbnail(SKBitmap original, string outputPath, int maxWidth)
    {
        int newWidth = Math.Min(maxWidth, original.Width);
        int newHeight = (int)((double)newWidth / original.Width * original.Height);

        using var resized = original.Resize(
            new SKImageInfo(newWidth, newHeight),
            new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));

        if (resized == null) return false;

        using var image = SKImage.FromBitmap(resized);
        using var data = image.Encode(SKEncodedImageFormat.Webp, WebpQuality);

        using var output = File.OpenWrite(outputPath);
        data.SaveTo(output);

        return true;
    }
}
