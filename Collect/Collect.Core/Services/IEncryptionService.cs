namespace Collect.Core.Services;

/// <summary>
/// Provides AES-256-GCM authenticated encryption/decryption and PBKDF2 key derivation.
/// </summary>
public interface IEncryptionService
{
    /// <summary>
    /// Creates encryption key material from a password.
    /// Returns (salt, verificationHash, encryptionKey).
    /// </summary>
    (byte[] Salt, byte[] VerificationHash, byte[] EncryptionKey) CreateKey(string password);

    /// <summary>
    /// Verifies a password against stored salt and verification hash.
    /// Returns (true, encryptionKey) if valid, (false, null) otherwise.
    /// </summary>
    (bool Valid, byte[]? EncryptionKey) VerifyPassword(string password, byte[] salt, byte[] verificationHash);

    /// <summary>
    /// Encrypts plaintext bytes using AES-256-GCM with the given key.
    /// Output format: [Nonce (12 bytes)][Ciphertext][Tag (16 bytes)]
    /// </summary>
    byte[] Encrypt(byte[] plaintext, byte[] key);

    /// <summary>
    /// Decrypts data that was encrypted with <see cref="Encrypt"/>.
    /// </summary>
    byte[] Decrypt(byte[] ciphertext, byte[] key);

    /// <summary>
    /// Reads a file, decrypts it, returns the plaintext bytes.
    /// </summary>
    byte[] ReadAndDecryptFile(string filePath, byte[] key);
}
