using System.Net;
using BeyondBoring.DeathMarch.Functions.Models;
using BeyondBoring.DeathMarch.Functions.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace BeyondBoring.DeathMarch.Functions.Functions;

public class DeathsFunctions
{
    private readonly TableStore _store;
    private readonly RateLimiter _rateLimiter;
    private readonly ILogger<DeathsFunctions> _logger;

    public DeathsFunctions(TableStore store, RateLimiter rateLimiter, ILogger<DeathsFunctions> logger)
    {
        _store = store;
        _rateLimiter = rateLimiter;
        _logger = logger;
    }

    [Function("GetDeaths")]
    public async Task<HttpResponseData> GetDeaths(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "deaths")] HttpRequestData req)
    {
        var table = _store.Get(TableStore.DeathsTable);
        var deaths = new List<DeathResponseModel>(50);

        // RowKey is inverted ticks, so lexical order == newest first: one cheap page.
        await foreach (var entity in table.QueryAsync<DeathEntity>(
            e => e.PartitionKey == "DEATH", maxPerPage: 50))
        {
            deaths.Add(new DeathResponseModel
            {
                Name = entity.Name,
                Cause = entity.Cause,
                Mile = entity.Mile,
                Epitaph = entity.Epitaph,
                Role = entity.Role,
                Days = entity.Days,
                Timestamp = entity.Timestamp ?? DateTimeOffset.UtcNow,
            });
            if (deaths.Count >= 50)
            {
                break;
            }
        }

        return await Http.Json(req, HttpStatusCode.OK, deaths);
    }

    [Function("PostDeath")]
    public async Task<HttpResponseData> PostDeath(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "deaths")] HttpRequestData req)
    {
        if (!await _rateLimiter.TryConsumeAsync(Http.ClientIp(req)))
        {
            return await Http.Error(req, HttpStatusCode.TooManyRequests, Http.RateLimitMessage);
        }

        var (body, readError) = await Http.ReadBodyAsync<DeathModel>(req);
        if (body is null)
        {
            return await Http.Error(req, HttpStatusCode.BadRequest, readError!);
        }

        if (Validation.ValidateDeath(body) is { } validationError)
        {
            return await Http.Error(req, HttpStatusCode.BadRequest, validationError);
        }

        var entity = new DeathEntity
        {
            RowKey = TableStore.InvertedTicksRowKey(),
            Name = body.Name.Trim(),
            Cause = body.Cause.Trim(),
            Mile = body.Mile!.Value,
            Epitaph = body.Epitaph?.Trim() ?? "",
            Role = body.Role.Trim(),
            Days = body.Days!.Value,
        };

        await _store.Get(TableStore.DeathsTable).AddEntityAsync(entity);
        _logger.LogInformation("Death recorded at mile {Mile}", entity.Mile);

        return await Http.Json(req, HttpStatusCode.Created, new
        {
            message = "Your death has been recorded. The trail continues without you.",
        });
    }
}
