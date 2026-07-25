using System.Net;
using BeyondBoring.DeathMarch.Functions.Models;
using BeyondBoring.DeathMarch.Functions.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace BeyondBoring.DeathMarch.Functions.Functions;

public class ScoresFunctions
{
    private readonly TableStore _store;
    private readonly RateLimiter _rateLimiter;
    private readonly ILogger<ScoresFunctions> _logger;

    public ScoresFunctions(TableStore store, RateLimiter rateLimiter, ILogger<ScoresFunctions> logger)
    {
        _store = store;
        _rateLimiter = rateLimiter;
        _logger = logger;
    }

    [Function("GetScores")]
    public async Task<HttpResponseData> GetScores(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "scores")] HttpRequestData req)
    {
        var table = _store.Get(TableStore.ScoresTable);
        var scores = new List<ScoreResponseModel>(100);

        // RowKey is inverted score, so lexical order == highest score first.
        await foreach (var entity in table.QueryAsync<ScoreEntity>(
            e => e.PartitionKey == "SCORE", maxPerPage: 100))
        {
            scores.Add(new ScoreResponseModel
            {
                Name = entity.Name,
                Score = entity.Score,
                Role = entity.Role,
                Days = entity.Days,
                Miles = entity.Miles,
                DeadlinesMet = entity.DeadlinesMet,
                DeadlinesMissed = entity.DeadlinesMissed,
                BusinessDeadlineMet = entity.BusinessDeadlineMet,
                Timestamp = entity.Timestamp ?? DateTimeOffset.UtcNow,
            });
            if (scores.Count >= 100)
            {
                break;
            }
        }

        return await Http.Json(req, HttpStatusCode.OK, scores);
    }

    [Function("PostScore")]
    public async Task<HttpResponseData> PostScore(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "scores")] HttpRequestData req)
    {
        if (!await _rateLimiter.TryConsumeAsync(Http.ClientIp(req)))
        {
            return await Http.Error(req, HttpStatusCode.TooManyRequests, Http.RateLimitMessage);
        }

        var (body, readError) = await Http.ReadBodyAsync<ScoreModel>(req);
        if (body is null)
        {
            return await Http.Error(req, HttpStatusCode.BadRequest, readError!);
        }

        if (Validation.ValidateScore(body) is { } validationError)
        {
            return await Http.Error(req, HttpStatusCode.BadRequest, validationError);
        }

        var entity = new ScoreEntity
        {
            RowKey = TableStore.InvertedScoreRowKey(body.Score!.Value),
            Name = body.Name.Trim(),
            Score = body.Score!.Value,
            Role = body.Role.Trim(),
            Days = body.Days!.Value,
            Miles = body.Miles!.Value,
            DeadlinesMet = body.DeadlinesMet!.Value,
            DeadlinesMissed = body.DeadlinesMissed!.Value,
            BusinessDeadlineMet = body.BusinessDeadlineMet!.Value,
        };

        await _store.Get(TableStore.ScoresTable).AddEntityAsync(entity);
        _logger.LogInformation("Score recorded: {Score}", entity.Score);

        return await Http.Json(req, HttpStatusCode.Created, new
        {
            message = "Your run has been entered into the permanent record. The record is reviewed by no one.",
        });
    }
}
