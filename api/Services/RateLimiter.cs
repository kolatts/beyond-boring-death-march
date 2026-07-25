using System.Security.Cryptography;
using System.Text;
using Azure;
using BeyondBoring.DeathMarch.Functions.Models;

namespace BeyondBoring.DeathMarch.Functions.Services;

/// <summary>
/// Table-backed rate limiter: one counter row per (hashed IP, UTC hour).
/// Max 10 POSTs per hour per IP across all endpoints.
/// </summary>
public class RateLimiter
{
    public const int MaxPostsPerHour = 10;

    private readonly TableStore _store;

    public RateLimiter(TableStore store) => _store = store;

    /// <summary>Returns true if the caller is allowed; increments the counter when allowed.</summary>
    public async Task<bool> TryConsumeAsync(string ip)
    {
        var table = _store.Get(TableStore.RateLimitsTable);
        var rowKey = $"{HashIp(ip)}-{DateTime.UtcNow:yyyyMMddHH}";

        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                var existing = await table.GetEntityIfExistsAsync<RateLimitEntity>("RATE", rowKey);
                if (!existing.HasValue || existing.Value is null)
                {
                    await table.AddEntityAsync(new RateLimitEntity { RowKey = rowKey, Count = 1 });
                    return true;
                }

                var entity = existing.Value;
                if (entity.Count >= MaxPostsPerHour)
                {
                    return false;
                }

                entity.Count++;
                await table.UpdateEntityAsync(entity, entity.ETag);
                return true;
            }
            catch (RequestFailedException ex) when (ex.Status is 409 or 412)
            {
                // Lost a race with a concurrent request from the same IP; retry.
            }
        }

        // Contention this heavy from one IP is its own signal.
        return false;
    }

    private static string HashIp(string ip)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(ip));
        return Convert.ToHexString(bytes)[..16].ToLowerInvariant();
    }
}
