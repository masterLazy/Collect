namespace Collect.Core.Models;

/// <summary>
/// Metadata about a library stored in .collect/library.json.
/// </summary>
public class LibraryInfo
{
    public string Id { get; set; } = string.Empty;
    public int Version { get; set; } = 1;
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int AssetCount { get; set; }

    /// <summary>
    /// Custom display order for tag categories (types).
    /// When set, tag groups are sorted by this order instead of alphabetically.
    /// </summary>
    public List<string>? CategoryOrder { get; set; }

    /// <summary>
    /// Whether this library uses encryption (files encrypted at rest with AES-256-GCM).
    /// </summary>
    public bool IsEncrypted { get; set; }

    /// <summary>
    /// Whether this library additionally encrypts on-disk file names (the basename, keeping the
    /// extension) using a deterministic, reversible, authenticated scheme. Folders stay
    /// plaintext. When true and the library is locked, real names/tags are withheld (strict mode).
    /// </summary>
    public bool EncryptFileNames { get; set; }

    /// <summary>
    /// Base64-encoded PBKDF2 salt used for key derivation.
    /// Only present when <see cref="IsEncrypted"/> is true.
    /// </summary>
    public string? Salt { get; set; }

    /// <summary>
    /// Base64-encoded verification hash derived from the password.
    /// Used to verify the password without storing the encryption key.
    /// Only present when <see cref="IsEncrypted"/> is true.
    /// </summary>
    public string? VerificationHash { get; set; }
}
