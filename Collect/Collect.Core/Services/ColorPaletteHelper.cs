using System.Numerics;
using Collect.Core.Models;
using SkiaSharp;

namespace Collect.Core.Services;

/// <summary>
/// Static helper for computing a color palette from a bitmap using
/// saturation-weighted K-means++ clustering in CIE L*a*b* color space.
/// </summary>
public static class ColorPaletteHelper {
    private const int MAX_IMAGE_SIZE = 400;
    private const int KMEANS_K = 10;
    private const double MERGE_THRESHOLD = 2.5;
    private const int MAX_KMEANS_ITER = 80;
    private const int MAX_MERGE_ITER = 20;
    private const double CONVERGENCE_THRESHOLD = 0.5;

    // 固定的三个随机种子
    private static readonly int[] FallbackSeeds = { 42, 2026, 8888 };

    /// <summary>
    /// Compute a color palette from a bitmap. Returns null if the bitmap is empty.
    /// The bitmap is used as-is (no internal resize); callers should pass an appropriately
    /// sized bitmap (e.g. a thumbnail).
    /// </summary>
    public static ColorPalette? ComputeFromBitmap(SKBitmap bitmap) {
        using var scaled = ResizeBitmap(bitmap, MAX_IMAGE_SIZE);
        var pixels = GetLabPixels(scaled);
        if (pixels.Count == 0) return null;

        // Saturation-weighted (正确使用饱和度 S = C / L*)
        var weights = new double[pixels.Count];
        for (int i = 0; i < pixels.Count; i++) {
            float L = pixels[i].X;
            float chroma = MathF.Sqrt(pixels[i].Y * pixels[i].Y + pixels[i].Z * pixels[i].Z);
            float L_safe = MathF.Max(L, 1f);   // 避免 L* 为 0 时除法异常
            float saturation = chroma / L_safe;

            double sat = (double)saturation;
            double clampedSat = Math.Clamp(sat, 0, 1000);  // 限制异常值
            weights[i] = Math.Log10(clampedSat + 1.0) / 2.0 + 0.1;
        }

        ColorPalette? bestPalette = null;
        int bestColorCount = -1;

        for (int seedIndex = 0; seedIndex < FallbackSeeds.Length; seedIndex++) {
            int seed = FallbackSeeds[seedIndex];
            var (centers, proportions) = RunKMeansWithMerge(pixels, weights, seed);

            var palette = new ColorPalette();
            var sorted = centers
                .Zip(proportions, (lab, prop) => (Lab: lab, Prop: prop))
                .OrderByDescending(x => x.Prop)
                .ToList();

            foreach (var (lab, prop) in sorted) {
                palette.Colors.Add(new PaletteColor {
                    Hex = LabToHex(lab),
                    Proportion = Math.Round(prop, 3)
                });
            }

            int currentCount = palette.Colors.Count;

            // 第一次尝试（seedIndex == 0）结果颜色数 >= 6，直接返回
            if (seedIndex == 0 && currentCount >= 6) {
                return palette;
            }

            // 否则记录颜色数最多的结果（颜色数相同时保留较早的尝试）
            if (currentCount > bestColorCount) {
                bestColorCount = currentCount;
                bestPalette = palette;
            }
        }

        return bestPalette;
    }

    /// <summary>
    /// Convert an RGB color to CIE 1976 L*a*b* color space.
    /// </summary>
    private static Vector3 RgbToLab(SKColor c) {
        float r = c.Red / 255f, g = c.Green / 255f, b = c.Blue / 255f;
        r = r > 0.04045f ? MathF.Pow((r + 0.055f) / 1.055f, 2.4f) : r / 12.92f;
        g = g > 0.04045f ? MathF.Pow((g + 0.055f) / 1.055f, 2.4f) : g / 12.92f;
        b = b > 0.04045f ? MathF.Pow((b + 0.055f) / 1.055f, 2.4f) : b / 12.92f;

        float x = r * 0.4124564f + g * 0.3575761f + b * 0.1804375f;
        float y = r * 0.2126729f + g * 0.7151522f + b * 0.0721750f;
        float z = r * 0.0193339f + g * 0.1191920f + b * 0.9503041f;

        float xn = 95.047f, yn = 100f, zn = 108.883f;
        x /= xn; y /= yn; z /= zn;
        x = x > 0.008856f ? MathF.Pow(x, 1 / 3f) : (7.787f * x) + (16 / 116f);
        y = y > 0.008856f ? MathF.Pow(y, 1 / 3f) : (7.787f * y) + (16 / 116f);
        z = z > 0.008856f ? MathF.Pow(z, 1 / 3f) : (7.787f * z) + (16 / 116f);
        return new Vector3(116f * y - 16, 500f * (x - y), 200f * (y - z));
    }

    /// <summary>
    /// Convert a CIE 1976 L*a*b* color back to sRGB byte values.
    /// </summary>
    private static (byte R, byte G, byte B) LabToRgb(Vector3 lab) {
        float y = (lab.X + 16) / 116f;
        float x = y + (lab.Y / 500f);
        float z = y - (lab.Z / 200f);

        float xn = 95.047f, yn = 100f, zn = 108.883f;
        x = MathF.Pow(x, 3) > 0.008856f ? MathF.Pow(x, 3) : (x - 16 / 116f) / 7.787f;
        y = MathF.Pow(y, 3) > 0.008856f ? MathF.Pow(y, 3) : (y - 16 / 116f) / 7.787f;
        z = MathF.Pow(z, 3) > 0.008856f ? MathF.Pow(z, 3) : (z - 16 / 116f) / 7.787f;

        x *= xn; y *= yn; z *= zn;

        float r = x * 3.2404542f + y * -1.5371385f + z * -0.4985314f;
        float g = x * -0.9692660f + y * 1.8760108f + z * 0.0415560f;
        float b = x * 0.0556434f + y * -0.2040259f + z * 1.0572252f;

        r = r > 0.0031308f ? 1.055f * MathF.Pow(r, 1 / 2.4f) - 0.055f : 12.92f * r;
        g = g > 0.0031308f ? 1.055f * MathF.Pow(g, 1 / 2.4f) - 0.055f : 12.92f * g;
        b = b > 0.0031308f ? 1.055f * MathF.Pow(b, 1 / 2.4f) - 0.055f : 12.92f * b;

        r = Math.Clamp(r * 255, 0, 255);
        g = Math.Clamp(g * 255, 0, 255);
        b = Math.Clamp(b * 255, 0, 255);
        return ((byte)r, (byte)g, (byte)b);
    }

    /// <summary>
    /// Convert a CIE 1976 L*a*b* color to a hex string like "#FF00AA".
    /// </summary>
    private static string LabToHex(Vector3 lab) {
        var (r, g, b) = LabToRgb(lab);
        return $"#{r:X2}{g:X2}{b:X2}";
    }

    /// <summary>
    /// Extract all pixels from a bitmap and convert them to CIE L*a*b* vectors.
    /// </summary>
    private static List<Vector3> GetLabPixels(SKBitmap bitmap) {
        var pixels = new List<Vector3>(bitmap.Width * bitmap.Height);
        for (int y = 0; y < bitmap.Height; y++) {
            for (int x = 0; x < bitmap.Width; x++) {
                var color = bitmap.GetPixel(x, y);
                pixels.Add(RgbToLab(color));
            }
        }
        return pixels;
    }

    /// <summary>
    /// Run saturation-weighted K-means++ clustering with automatic merging.
    /// Returns the final cluster centers (in Lab), their proportions, and the total iteration count.
    /// No artificial cap on the number of clusters — the merge threshold determines the final count.
    /// </summary>
    private static (List<Vector3> Centers, List<double> Proportions) RunKMeansWithMerge(
        List<Vector3> pixels, double[] weights, int seed) {
        int n = pixels.Count;
        if (n == 0) return (new List<Vector3>(), new List<double>());

        double totalWeight = weights.Sum();
        var rand = new Random(seed);
        var centersList = new List<Vector3>();
        centersList.Add(pixels[rand.Next(n)]);

        // K-Means++ initialization
        for (int k = 1; k < KMEANS_K; k++) {
            var dists = new double[n];
            double sum = 0;
            for (int i = 0; i < n; i++) {
                double minDist = centersList.Min(c => Vector3.DistanceSquared(pixels[i], c));
                dists[i] = minDist;
                sum += minDist;
            }
            double target = rand.NextDouble() * sum;
            for (int i = 0; i < n; i++) {
                target -= dists[i];
                if (target <= 0) { centersList.Add(pixels[i]); break; }
            }
        }

        int[] labels = new int[n];

        void AssignAndUpdate() {
            for (int i = 0; i < n; i++) {
                int best = 0;
                double bestDist = Vector3.DistanceSquared(pixels[i], centersList[0]);
                for (int c = 1; c < centersList.Count; c++) {
                    double d = Vector3.DistanceSquared(pixels[i], centersList[c]);
                    if (d < bestDist) { bestDist = d; best = c; }
                }
                labels[i] = best;
            }
            var sums = new Vector3[centersList.Count];
            var weightSums = new double[centersList.Count];
            for (int i = 0; i < n; i++) {
                int c = labels[i];
                sums[c] += pixels[i] * (float)weights[i];
                weightSums[c] += weights[i];
            }
            var newCenters = new List<Vector3>();
            for (int c = 0; c < centersList.Count; c++) {
                if (weightSums[c] > 0)
                    newCenters.Add(sums[c] / (float)weightSums[c]);
                else
                    newCenters.Add(centersList[c]);
            }
            centersList = newCenters;
        }

        // Initial assignment
        AssignAndUpdate();

        int kmeansIter = 0;
        int mergeIter = 0;

        // Phase 1: Pure K-means (up to MAX_KMEANS_ITER)
        while (kmeansIter < MAX_KMEANS_ITER) {
            var oldCenters = new List<Vector3>(centersList);
            AssignAndUpdate();
            kmeansIter++;

            bool converged = true;
            for (int i = 0; i < centersList.Count; i++) {
                if (Vector3.Distance(oldCenters[i], centersList[i]) >= CONVERGENCE_THRESHOLD) {
                    converged = false;
                    break;
                }
            }
            if (converged) break;
        }

        // Phase 2: Merge phase (up to MAX_MERGE_ITER) – executed unconditionally
        mergeIter = 0;
        while (mergeIter < MAX_MERGE_ITER) {

            // Try to merge close clusters using standard LAB Euclidean distance
            bool anyMerge = false;
            do {
                bool merged = false;
                int k = centersList.Count;
                if (k <= 1) break;

                int iFound = -1, jFound = -1;
                for (int i = 0; i < k; i++) {
                    for (int j = i + 1; j < k; j++) {
                        double d = Vector3.Distance(centersList[i], centersList[j]);
                        if (d <= MERGE_THRESHOLD) {
                            iFound = i; jFound = j;
                            break;
                        }
                    }
                    if (iFound != -1) break;
                }

                if (iFound != -1) {
                    double[] weightSumsTemp = new double[centersList.Count];
                    for (int p = 0; p < n; p++) weightSumsTemp[labels[p]] += weights[p];

                    double w1 = weightSumsTemp[iFound];
                    double w2 = weightSumsTemp[jFound];
                    double totalW = w1 + w2;
                    Vector3 mergedCenter = (centersList[iFound] * (float)w1 + centersList[jFound] * (float)w2) / (float)totalW;
                    centersList[iFound] = mergedCenter;
                    centersList.RemoveAt(jFound);

                    for (int p = 0; p < n; p++) {
                        if (labels[p] == jFound) labels[p] = iFound;
                        else if (labels[p] > jFound) labels[p]--;
                    }

                    merged = true;
                    anyMerge = true;
                }
                if (!merged) break;
            } while (true);

            if (!anyMerge || centersList.Count <= 1) break;

            // Update
            var oldCenters = new List<Vector3>(centersList);
            AssignAndUpdate();
            mergeIter++;

            // Check convergence after assignment
            bool converged = true;
            if (centersList.Count == oldCenters.Count) {
                for (int i = 0; i < centersList.Count; i++) {
                    if (Vector3.Distance(oldCenters[i], centersList[i]) >= CONVERGENCE_THRESHOLD) {
                        converged = false;
                        break;
                    }
                }
            } else {
                converged = false;
            }
            if (converged) break;
        }

        // Force merge down to 6 colors by repeatedly merging the closest pair
        while (centersList.Count > 6) {
            int iFound = -1, jFound = -1;
            double minDist = double.MaxValue;
            for (int i = 0; i < centersList.Count; i++) {
                for (int j = i + 1; j < centersList.Count; j++) {
                    double d = Vector3.DistanceSquared(centersList[i], centersList[j]);
                    if (d < minDist) {
                        minDist = d;
                        iFound = i; jFound = j;
                    }
                }
            }

            double[] weightSumsTemp = new double[centersList.Count];
            for (int p = 0; p < n; p++) weightSumsTemp[labels[p]] += weights[p];
            double w1 = weightSumsTemp[iFound];
            double w2 = weightSumsTemp[jFound];
            double totalW = w1 + w2;
            Vector3 mergedCenter = (centersList[iFound] * (float)w1 + centersList[jFound] * (float)w2) / (float)totalW;
            centersList[iFound] = mergedCenter;
            centersList.RemoveAt(jFound);

            for (int p = 0; p < n; p++) {
                if (labels[p] == jFound) labels[p] = iFound;
                else if (labels[p] > jFound) labels[p]--;
            }

            AssignAndUpdate();
        }

        // Final weight proportions
        double[] finalWeightSums = new double[centersList.Count];
        for (int i = 0; i < n; i++) finalWeightSums[labels[i]] += weights[i];
        var props = finalWeightSums.Select(w => w / totalWeight).ToList();
        return (centersList, props);
    }

    public static SKBitmap ResizeBitmap(SKBitmap original, int maxSize) {
    int w = original.Width, h = original.Height;
    if (w <= maxSize && h <= maxSize)
        return original.Copy();   // 修复：必须复制像素数据

    float ratio = Math.Min((float)maxSize / w, (float)maxSize / h);
    int newW = (int)(w * ratio), newH = (int)(h * ratio);
    var resized = original.Resize(new SKImageInfo(newW, newH), SKSamplingOptions.Default);
    return resized ?? original.Copy();
}
}