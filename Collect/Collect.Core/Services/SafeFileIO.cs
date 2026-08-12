using System.Text;
using Microsoft.Extensions.Logging;

namespace Collect.Core.Services;

/// <summary>
/// Crash-safe file I/O helpers.
///
/// Guarantee: the original file at <paramref name="path"/> is <b>never truncated in place</b>.
/// Content is first written to a temp file in the <b>same directory</b>, then atomically moved
/// over the destination (same volume → <c>File.Move(..., overwrite: true)</c> is a single atomic
/// rename on NTFS). A failure leaves the original intact, and a concurrent reader sees either the
/// complete old file or the complete new file — never a torn/partial write.
/// </summary>
public static class SafeFileIO
{
    private const int MaxAttempts = 4;      // 1 initial attempt + 3 retries
    private const int RetryDelayMs = 200;

    /// <summary>
    /// Writes <paramref name="bytes"/> to <paramref name="path"/> atomically (temp + rename).
    /// </summary>
    public static void WriteAllBytesAtomic(string path, byte[] bytes, ILogger? logger = null)
        => WriteAtomic(path, logger, stream => stream.Write(bytes, 0, bytes.Length));

    /// <summary>
    /// Writes <paramref name="content"/> (UTF-8, no BOM) to <paramref name="path"/> atomically
    /// (temp + rename).
    /// </summary>
    public static void WriteAllTextAtomic(string path, string content, ILogger? logger = null)
        => WriteAtomic(path, logger, stream =>
        {
            using var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), leaveOpen: true);
            writer.Write(content);
            writer.Flush();
        });

    /// <summary>
    /// Performs the temp-write + atomic-move dance with transient-I/O retry and temp cleanup.
    /// The temp file is opened with <see cref="FileShare.ReadWrite"/> so a concurrent reader of the
    /// temp file never triggers a sharing violation.
    /// </summary>
    private static void WriteAtomic(string path, ILogger? logger, Action<Stream> writeToStream)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        // Preserve the original file's last-write time across the atomic replace so that
        // operations like content encrypt/decrypt do not disturb user-visible timestamps
        // (e.g. sorting assets by modification time).
        var originalLastWrite = File.Exists(path) ? (DateTime?)File.GetLastWriteTimeUtc(path) : null;

        var tempPath = string.Empty;
        try
        {
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    // Same directory ⇒ same volume ⇒ File.Move (MOVEFILE_REPLACE_EXISTING) is atomic.
                    tempPath = Path.Combine(dir ?? ".", $"{Path.GetFileName(path)}.tmp-{Guid.NewGuid():N}");

                    using (var fs = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.ReadWrite))
                    {
                        writeToStream(fs);
                    }

                    File.Move(tempPath, path, overwrite: true);
                    tempPath = string.Empty; // moved — nothing left to clean up

                    RestoreLastWriteTime(path, originalLastWrite, logger);
                    return;
                }
                catch (IOException ex) when (attempt < MaxAttempts)
                {
                    logger?.LogWarning(ex,
                        "SafeFileIO: transient IO error on attempt {Attempt}/{MaxAttempts} replacing {Path}; retrying in {Delay}ms",
                        attempt, MaxAttempts, path, RetryDelayMs);
                    TryDelete(tempPath);
                    tempPath = string.Empty;
                    Thread.Sleep(RetryDelayMs);
                }
            }
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "SafeFileIO: failed to atomically replace {Path}", path);
            throw;
        }
        finally
        {
            TryDelete(tempPath);
        }
    }

    /// <summary>
    /// Restores the original last-write time after an atomic replace (best-effort).
    /// </summary>
    private static void RestoreLastWriteTime(string path, DateTime? originalLastWriteUtc, ILogger? logger)
    {
        if (originalLastWriteUtc is null)
            return;

        try
        {
            File.SetLastWriteTimeUtc(path, originalLastWriteUtc.Value);
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex, "SafeFileIO: could not restore last-write time for {Path}", path);
        }
    }

    private static void TryDelete(string path)
    {
        if (string.IsNullOrEmpty(path))
            return;

        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch
        {
            // Best-effort temp cleanup only.
        }
    }
}
