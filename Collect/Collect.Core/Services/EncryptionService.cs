using System.Security.Cryptography;

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
}
