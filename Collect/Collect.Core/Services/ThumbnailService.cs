using System.Collections.Concurrent;
using SkiaSharp;
using Microsoft.Extensions.Logging;

namespace Collect.Core.Services;

public class ThumbnailService : IThumbnailService
{
    private const int ThumbnailMaxWidth = 400;
    private const int WebpQuality = 85;

    // Bounded concurrency: at most MaxConcurrentGenerations thumbnails are decoded/encoded in
    // parallel process-wide. Skia operations here are per-instance (no shared objects), so they
    // are safe to run concurrently; the gate just prevents unbounded CPU usage on a gallery page.
    private const int MaxConcurrentGenerations = 4;
    private static readonly SemaphoreSlim _generationGate = new(MaxConcurrentGenerations, MaxConcurrentGenerations);

    // Per-output-path locks prevent two requests from generating the same thumbnail twice.
    private static readonly ConcurrentDictionary<string, object> _assetLocks = new();

    private readonly IEncryptionService _encryptionService;
    private readonly ILogger<ThumbnailService> _logger;

    public ThumbnailService(IEncryptionService encryptionService, ILogger<ThumbnailService> logger)
    {
        _encryptionService = encryptionService;
        _logger = logger;
    }

    public bool TryGenerateThumbnail(string sourceFilePath, string outputPath, int maxWidth = 400, byte[]? encryptionKey = null)
    {
        bool generated;
        string? magic = null;

        try
        {
            var dir = Path.GetDirectoryName(outputPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            if (encryptionKey is not null)
            {
                var decrypted = _encryptionService.ReadAndDecryptFile(sourceFilePath, encryptionKey);
                magic = ImageMimeDetector.MagicHex(decrypted);
                using var original = SKBitmap.Decode(decrypted);
                if (original == null)
                {
                    _logger.LogWarning("Thumbnail decode returned null for encrypted source {Path} ({Len} bytes, magic={Magic})", sourceFilePath, decrypted.Length, magic);
                    return false;
                }
                generated = GenerateAndSaveThumbnail(original, outputPath, maxWidth);
            }
            else
            {
                using var input = File.OpenRead(sourceFilePath);
                var head = new byte[12];
                var read = input.Read(head, 0, head.Length);
                magic = Convert.ToHexString(head.AsSpan(0, read));
                // IMPORTANT: reading the magic head advanced the stream position — rewind to
                // the start so SKBitmap.Decode sees the full file (PNG signature intact).
                input.Position = 0;
                using var original = SKBitmap.Decode(input);
                if (original == null)
                {
                    _logger.LogWarning("Thumbnail decode returned null for plaintext source {Path} (magic={Magic})", sourceFilePath, magic);
                    return false;
                }
                generated = GenerateAndSaveThumbnail(original, outputPath, maxWidth);
            }

            if (generated && encryptionKey is not null)
            {
                var plaintext = File.ReadAllBytes(outputPath);
                var encrypted = _encryptionService.Encrypt(plaintext, encryptionKey);
                SafeFileIO.WriteAllBytesAtomic(outputPath, encrypted, _logger);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Thumbnail generation failed for {Path} (magic={Magic})", sourceFilePath, magic);
            return false;
        }

        return generated;
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

        // Per-asset lock: only one request generates this specific thumbnail.
        var assetLock = _assetLocks.GetOrAdd(thumbPath, _ => new object());
        lock (assetLock)
        {
            // Another request may have generated it while we waited for the lock.
            if (File.Exists(thumbPath))
                return thumbPath;

            _generationGate.Wait();
            try
            {
                if (!TryGenerateThumbnail(sourceFilePath, thumbPath, ThumbnailMaxWidth, encryptionKey))
                    return null;
            }
            finally
            {
                _generationGate.Release();
            }
            return thumbPath;
        }
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
