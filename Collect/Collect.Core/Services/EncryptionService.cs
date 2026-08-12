using System.Security.Cryptography;
using System.Text;

namespace Collect.Core.Services;

/// <summary>
/// AES-256-GCM authenticated encryption with PBKDF2 key derivation (600000 iterations, SHA-256).
/// Encrypted file format on disk: [12-byte nonce][ciphertext][16-byte GCM tag]
/// </summary>
public class EncryptionService : IEncryptionService
{
    private const int SaltSize = 32;
    private const int KeySize = 32;
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private const int Iterations = 600_000;
    private const int DerivedBytesLength = 64; // 32 encryption key + 32 verification hash

    /// <summary>
    /// Creates encryption key material from a password.
    /// Derives 64 bytes via PBKDF2: first 32 = encryption key, last 32 = verification hash.
    /// </summary>
    public (byte[] Salt, byte[] VerificationHash, byte[] EncryptionKey) CreateKey(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var derived = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            Iterations,
            HashAlgorithmName.SHA256,
            DerivedBytesLength);

        var encryptionKey = derived[..KeySize];
        var verificationHash = derived[KeySize..];

        return (salt, verificationHash, encryptionKey);
    }

    /// <summary>
    /// Verifies a password against stored salt and verification hash.
    /// Returns the encryption key on success, null on failure.
    /// Uses constant-time comparison to prevent timing attacks.
    /// </summary>
    public (bool Valid, byte[]? EncryptionKey) VerifyPassword(string password, byte[] salt, byte[] verificationHash)
    {
        var derived = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            Iterations,
            HashAlgorithmName.SHA256,
            DerivedBytesLength);

        var encryptionKey = derived[..KeySize];
        var computedHash = derived[KeySize..];

        var valid = CryptographicOperations.FixedTimeEquals(verificationHash, computedHash);
        return (valid, valid ? encryptionKey : null);
    }

    /// <summary>
    /// Encrypts plaintext using AES-256-GCM.
    /// Output: [12-byte nonce][ciphertext][16-byte authentication tag]
    /// </summary>
    public byte[] Encrypt(byte[] plaintext, byte[] key)
    {
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSize];

        using var aes = new AesGcm(key, TagSize);
        aes.Encrypt(nonce, plaintext, ciphertext, tag);

        var result = new byte[NonceSize + ciphertext.Length + TagSize];
        Buffer.BlockCopy(nonce, 0, result, 0, NonceSize);
        Buffer.BlockCopy(ciphertext, 0, result, NonceSize, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, result, NonceSize + ciphertext.Length, TagSize);

        return result;
    }

    /// <summary>
    /// Decrypts data that was encrypted with <see cref="Encrypt"/>.
    /// Expected input: [12-byte nonce][ciphertext][16-byte authentication tag]
    /// Throws <see cref="AuthenticationTagMismatchException"/> if the tag is invalid
    /// (wrong key or corrupted data).
    /// </summary>
    public byte[] Decrypt(byte[] ciphertextWithNonceAndTag, byte[] key)
    {
        var nonce = ciphertextWithNonceAndTag[..NonceSize];
        var tag = ciphertextWithNonceAndTag[^TagSize..];
        var ciphertext = ciphertextWithNonceAndTag[NonceSize..^TagSize];
        var plaintext = new byte[ciphertext.Length];

        using var aes = new AesGcm(key, TagSize);
        aes.Decrypt(nonce, ciphertext, tag, plaintext);

        return plaintext;
    }

    /// <summary>
    /// Reads an encrypted file from disk and returns the decrypted plaintext.
    /// </summary>
    public byte[] ReadAndDecryptFile(string filePath, byte[] key)
    {
        var encryptedData = File.ReadAllBytes(filePath);
        return Decrypt(encryptedData, key);
    }

    private const int NameNonceSize = 12;
    private const int NameTagSize = 16;

    /// <summary>
    /// Deterministically encrypts a plaintext name (the basename WITHOUT extension) into a
    /// filesystem-safe, reversible, authenticated string.
    /// </summary>
    /// <remarks>
    /// The scheme is deterministic: the nonce is derived via HMAC-SHA256 over the plaintext
    /// (prefixed with a domain-separation string), so the same plaintext + key ALWAYS produces
    /// the same output. This is required so scan/reconcile/rename operations do not thrash.
    /// The GCM nonce is bound to the plaintext, so distinct plaintexts never reuse a (key, nonce)
    /// pair, and the nonce is stored in the output itself (no chicken-and-egg lookup needed).
    /// The associated data equals the nonce, preventing nonce tampering.
    /// Output layout: [nonce(12)][ciphertext][tag(16)], then base64url-encoded
    /// (only [A-Za-z0-9_-]) so it is safe as a filename component.
    /// </remarks>
    public string EncryptFileName(string plainName, byte[] key)
    {
        var data = Encoding.UTF8.GetBytes(plainName);
        var nonce = HMACSHA256.HashData(key, Encoding.UTF8.GetBytes("collect.name.nonce:" + plainName))[..NameNonceSize];

        var ciphertext = new byte[data.Length];
        var tag = new byte[NameTagSize];
        using var aes = new AesGcm(key, NameTagSize);
        aes.Encrypt(nonce, data, ciphertext, tag, nonce);

        var raw = new byte[NameNonceSize + ciphertext.Length + NameTagSize];
        Buffer.BlockCopy(nonce, 0, raw, 0, NameNonceSize);
        Buffer.BlockCopy(ciphertext, 0, raw, NameNonceSize, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, raw, NameNonceSize + ciphertext.Length, NameTagSize);

        return Convert.ToBase64String(raw).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    /// <summary>
    /// Reverses <see cref="EncryptFileName"/>.
    /// </summary>
    /// <remarks>
    /// Returns <c>true</c> with the recovered plaintext name on success. Returns <c>false</c>
    /// (with <paramref name="plainName"/> = <c>null</c>) when <paramref name="encrypted"/> is
    /// not a valid encrypted name for <paramref name="key"/> — e.g. a legacy plaintext name on
    /// disk, a value produced with a different key, or corrupted data. Callers must treat
    /// <c>false</c> as "this name is not encrypted with this key (plaintext legacy)", never as
    /// a hard error.
    /// </remarks>
    public bool TryDecryptFileName(string encrypted, byte[] key, out string? plainName)
    {
        plainName = null;

        try
        {
            // Reverse base64url: '-'->'+', '_'->'/', then re-add padding.
            var normalized = encrypted.Replace('-', '+').Replace('_', '/');
            switch (normalized.Length % 4)
            {
                case 2: normalized += "=="; break;
                case 3: normalized += "="; break;
            }

            var raw = Convert.FromBase64String(normalized);
            if (raw.Length < NameNonceSize + NameTagSize)
                return false;

            var nonce = raw[..NameNonceSize];
            var tag = raw[^NameTagSize..];
            var ciphertext = raw[NameNonceSize..^NameTagSize];
            var plaintext = new byte[ciphertext.Length];

            using var aes = new AesGcm(key, NameTagSize);
            aes.Decrypt(nonce, ciphertext, tag, plaintext, nonce);

            plainName = Encoding.UTF8.GetString(plaintext);
            return true;
        }
        catch (AuthenticationTagMismatchException)
        {
            // Not encrypted with this key — treat as plaintext legacy name.
            plainName = null;
            return false;
        }
        catch (FormatException)
        {
            // Not valid base64url — plaintext legacy name.
            plainName = null;
            return false;
        }
        catch (ArgumentException)
        {
            plainName = null;
            return false;
        }
    }
}
