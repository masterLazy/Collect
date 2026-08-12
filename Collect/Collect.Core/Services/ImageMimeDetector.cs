namespace Collect.Core.Services;

/// <summary>
/// Sniffs image MIME types from raw bytes (magic numbers) so files served from an
/// encrypted library use their real content type even when the filename extension
/// doesn't match the actual format (e.g. a WebP/AVIF saved as .jpg).
/// </summary>
public static class ImageMimeDetector
{
    /// <summary>
    /// Detects the image MIME type from magic bytes, or null if unrecognized.
    /// </summary>
    public static string? Detect(byte[]? data)
    {
        if (data is null || data.Length < 12)
            return null;

        // JPEG: FF D8 FF
        if (data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF)
            return "image/jpeg";

        // PNG: 89 50 4E 47
        if (data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47)
            return "image/png";

        // GIF: "GIF8"
        if (data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38)
            return "image/gif";

        // BMP: "BM"
        if (data[0] == 0x42 && data[1] == 0x4D)
            return "image/bmp";

        // WebP: "RIFF" .... "WEBP"
        if (data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46
            && data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50)
            return "image/webp";

        // TIFF: "II*\0" or "MM\0*"
        if ((data[0] == 0x49 && data[1] == 0x49 && data[2] == 0x2A && data[3] == 0x00)
            || (data[0] == 0x4D && data[1] == 0x4D && data[2] == 0x00 && data[3] == 0x2A))
            return "image/tiff";

        // ISO BMFF container (HEIC / HEIF / AVIF): 4-byte size + "ftyp" + brand
        if (data[4] == 0x66 && data[5] == 0x74 && data[6] == 0x79 && data[7] == 0x70)
        {
            var brand = System.Text.Encoding.ASCII.GetString(data, 8, 4).ToLowerInvariant();
            return brand switch
            {
                "heic" or "heix" or "hevc" or "hevx" => "image/heic",
                "avif" or "avis" => "image/avif",
                _ => "image/heif"
            };
        }

        return null;
    }

    /// <summary>
    /// Returns the first 12 bytes of data as a hex string for diagnostics.
    /// </summary>
    public static string MagicHex(byte[]? data)
    {
        if (data is null || data.Length == 0)
            return "";
        return Convert.ToHexString(data.AsSpan(0, Math.Min(12, data.Length)));
    }
}
