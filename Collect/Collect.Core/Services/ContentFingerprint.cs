using System.Security.Cryptography;

namespace Collect.Core.Services;

/// <summary>
/// Computes a content-based fingerprint (hex string) for a file using
/// file size + head/middle/tail sampling, avoiding full file reads for large files.
/// </summary>
public static class ContentFingerprint
{
    /// <summary>
    /// Compute a content fingerprint from a file path.
    /// Uses size + head/middle/tail sampling (~192KB max read) for performance.
    /// </summary>
    public static string Compute(string filePath)
    {
        var fileInfo = new FileInfo(filePath);
        long size = fileInfo.Length;

        using var fs = File.OpenRead(filePath);
        return ComputeCore(fs, size);
    }

    /// <summary>
    /// Compute a content fingerprint from already-read byte data (e.g. decrypted content).
    /// </summary>
    public static string Compute(byte[] fileData, long fileSize)
    {
        using var ms = new MemoryStream(fileData);
        return ComputeCore(ms, fileSize);
    }

    private static string ComputeCore(Stream stream, long fileSize)
    {
        using var md5 = MD5.Create();

        // 1. Write file size first (prevents collision between different-size files)
        byte[] sizeBytes = BitConverter.GetBytes(fileSize);
        md5.TransformBlock(sizeBytes, 0, sizeBytes.Length, null, 0);

        int chunkSize = 64 * 1024; // 64 KB
        byte[] buffer = new byte[chunkSize];

        if (fileSize <= chunkSize * 4)
        {
            // Small file (< 256 KB): read all
            int totalRead = 0;
            int bytesRead;
            while ((bytesRead = stream.Read(buffer, 0, (int)Math.Min(chunkSize, fileSize - totalRead))) > 0)
            {
                md5.TransformBlock(buffer, 0, bytesRead, null, 0);
                totalRead += bytesRead;
            }
        }
        else
        {
            // Large file: head + middle + tail sampling
            // Head (first 64KB)
            int headRead = stream.Read(buffer, 0, chunkSize);
            md5.TransformBlock(buffer, 0, headRead, null, 0);

            // Middle (64KB around center)
            stream.Seek(fileSize / 2 - chunkSize / 2, SeekOrigin.Begin);
            int midRead = stream.Read(buffer, 0, chunkSize);
            md5.TransformBlock(buffer, 0, midRead, null, 0);

            // Tail (last 64KB)
            stream.Seek(fileSize - chunkSize, SeekOrigin.Begin);
            int tailRead = stream.Read(buffer, 0, chunkSize);
            md5.TransformBlock(buffer, 0, tailRead, null, 0);
        }

        md5.TransformFinalBlock([], 0, 0);
        return Convert.ToHexString(md5.Hash!).ToLowerInvariant();
    }
}
