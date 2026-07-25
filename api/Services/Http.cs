using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker.Http;

namespace BeyondBoring.DeathMarch.Functions.Services;

public static class Http
{
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>
    /// Reads and deserializes the body with a hard byte cap. Returns (model, error).
    /// </summary>
    public static async Task<(T? Model, string? Error)> ReadBodyAsync<T>(HttpRequestData req) where T : class
    {
        using var memory = new MemoryStream();
        var buffer = new byte[1024];
        int read;
        while ((read = await req.Body.ReadAsync(buffer)) > 0)
        {
            if (memory.Length + read > Validation.MaxBodyBytes)
            {
                return (null, $"Request body exceeds {Validation.MaxBodyBytes} bytes. Your death was verbose. The feed is not.");
            }
            memory.Write(buffer, 0, read);
        }

        if (memory.Length == 0)
        {
            return (null, "Request body is empty. Dying is mandatory; documentation of the death is also mandatory.");
        }

        try
        {
            var model = JsonSerializer.Deserialize<T>(memory.GetBuffer().AsSpan(0, (int)memory.Length), JsonOptions);
            return model is null
                ? (null, "Request body deserialized to nothing. Much like the sprint goals.")
                : (model, null);
        }
        catch (JsonException)
        {
            return (null, "Request body is not valid JSON. The schema was communicated at an offsite you were not invited to.");
        }
    }

    public static async Task<HttpResponseData> Json(HttpRequestData req, HttpStatusCode status, object payload)
    {
        var response = req.CreateResponse(status);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(JsonSerializer.Serialize(payload, JsonOptions));
        return response;
    }

    public static Task<HttpResponseData> Error(HttpRequestData req, HttpStatusCode status, string message) =>
        Json(req, status, new { error = message });

    /// <summary>Client IP: first hop of X-Forwarded-For (set by the Azure front end).</summary>
    public static string ClientIp(HttpRequestData req)
    {
        if (req.Headers.TryGetValues("X-Forwarded-For", out var values))
        {
            var first = values.FirstOrDefault()?.Split(',')[0].Trim();
            if (!string.IsNullOrEmpty(first))
            {
                // Strip port (1.2.3.4:5678) but leave IPv6 colons alone.
                var colonIndex = first.LastIndexOf(':');
                if (colonIndex > 0 && first.Count(c => c == ':') == 1)
                {
                    first = first[..colonIndex];
                }
                return first;
            }
        }
        return "unknown";
    }

    public const string RateLimitMessage =
        "You have filed 10 submissions this hour. The intake board meets again at the top of the hour. " +
        "Your enthusiasm has been noted and forwarded to no one.";
}
