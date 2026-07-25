using Azure.Data.Tables;
using BeyondBoring.DeathMarch.Functions.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        var connection = Environment.GetEnvironmentVariable("TablesConnection")
            ?? Environment.GetEnvironmentVariable("AzureWebJobsStorage")
            ?? "UseDevelopmentStorage=true";
        services.AddSingleton(new TableServiceClient(connection));
        services.AddSingleton<TableStore>();
        services.AddSingleton<RateLimiter>();
        services.AddApplicationInsightsTelemetryWorkerService();
        services.ConfigureFunctionsApplicationInsights();
    })
    .Build();

host.Run();
