using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Zilo.Core;
using Zilo.Security;

namespace Zilo.Agent;

internal sealed class AgentPipeline
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    private readonly RequestDelegate _next;
    private readonly AgentOptions _options;
    private readonly OriginPolicy _origins;
    private readonly ConsentStore _consent;
    private readonly TokenService _tokens;
    private readonly DiscoveryService _discovery;

    public AgentPipeline(RequestDelegate next, AgentOptions options, OriginPolicy origins, ConsentStore consent, TokenService tokens, DiscoveryService discovery)
    { _next = next; _options = options; _origins = origins; _consent = consent; _tokens = tokens; _discovery = discovery; }

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments("/zilo/v1", StringComparison.Ordinal)) { await _next(context); return; }
        var requestId = NewId();
        context.Response.Headers["Zilo-Request-Id"] = requestId;
        context.Response.Headers["Cache-Control"] = "no-store";
        context.Response.Headers["Vary"] = "Origin";
        var requestedMethod = context.Request.Method == HttpMethods.Options ? context.Request.Headers.AccessControlRequestMethod.ToString() : context.Request.Method;
        var route = Route.Match(context.Request.Path, requestedMethod);
        if (!IsHostAllowed(context)) { await Problem(context, 403, "host-denied", false, requestId); return; }
        if (context.Request.Method == HttpMethods.Options) { await Preflight(context, route, requestId); return; }
        if (route is null)
        {
            var unknownOrigin = _origins.Evaluate(context.Request.Headers.Origin, _consent.IsGranted);
            await Problem(context, 404, "not-found", true, requestId, CorsTier.Allowed, unknownOrigin.Class == OriginClass.Allowed ? unknownOrigin.Origin : null);
            return;
        }
        var evaluation = _origins.Evaluate(context.Request.Headers.Origin, _consent.IsGranted);
        if (!route.MethodAllowed(context.Request.Method))
        {
            context.Response.Headers.Allow = string.Join(", ", route.Methods);
            await Problem(context, 405, "invalid-request", true, requestId, route.CorsTier, CorsOrigin(route.CorsTier, evaluation));
            return;
        }

        if (route.Name == "consent-get" && evaluation.Class == OriginClass.Absent || !OriginAllowedForRoute(route, evaluation))
        {
            await Problem(context, 403, "unauthorized-origin", false, requestId);
            return;
        }
        if (route.Protected)
        {
            var auth = Authenticate(context, evaluation.Origin);
            if (!auth.Valid) { await Problem(context, 401, auth.Code, true, requestId, route.CorsTier, CorsOrigin(route.CorsTier, evaluation), wwwAuthenticate: true); return; }
            context.Items["zilo.auth"] = auth.Token;
        }
        if (route.Name == "token" && evaluation.Class == OriginClass.Allowed && _tokens.IssueRetryAfter(evaluation.Origin!) is { } retryAfter)
        { await Problem(context, 429, "rate-limited", true, requestId, route.CorsTier, evaluation.Origin, retryAfter); return; }
        if (!await BodyIsValid(context, requestId, route.CorsTier, route.Name)) return;
        var afterBody = await RecheckAuthorization(context, route, requestId, evaluation);
        if (afterBody is null) return;
        evaluation = afterBody;
        await Handle(context, route, evaluation, requestId);
    }

    private async Task Handle(HttpContext context, Route route, OriginEvaluation evaluation, string requestId)
    {
        switch (route.Name)
        {
            case "hello":
                if (TryBearer(context, out var raw) && evaluation.Class == OriginClass.Allowed)
                {
                    var auth = _tokens.Validate(raw, evaluation.Origin!);
                    if (auth.Token is not null) { await WriteJson(context, Hello(true), 200, requestId, route.CorsTier, evaluation.Origin); return; }
                }
                await WriteJson(context, Hello(false), 200, requestId, route.CorsTier, evaluation.Origin); return;
            case "consent-get":
                var consentResult = evaluation.Class == OriginClass.DevEligible ? new ConsentResult(new ConsentStatus(evaluation.Origin!, "none")) : _origins.IsBaked(evaluation.Origin!) ? new ConsentResult(new ConsentStatus(evaluation.Origin!, "granted", Managed: true)) : await _consent.GetResultAsync(evaluation.Origin!, context.RequestAborted);
                if (consentResult.ProblemCode is not null) { await Problem(context, consentResult.HttpStatus, consentResult.ProblemCode, true, requestId, route.CorsTier, CorsOrigin(route.CorsTier, evaluation), consentResult.RetryAfterSeconds); return; }
                var status = consentResult.Status;
                await WriteJson(context, status, 200, requestId, route.CorsTier, evaluation.Origin); return;
            case "consent-post":
                if (_origins.IsBaked(evaluation.Origin!)) { await WriteJson(context, new ConsentStatus(evaluation.Origin!, "granted", Managed: true), 200, requestId, route.CorsTier, evaluation.Origin); return; }
                var result = await _consent.RequestAsync(evaluation.Origin!, context.RequestAborted);
                if (result.ProblemCode is not null) { await Problem(context, result.HttpStatus, result.ProblemCode, true, requestId, route.CorsTier, CorsOrigin(route.CorsTier, evaluation), result.RetryAfterSeconds, blocked: result.Status.Blocked == true); return; }
                await WriteJson(context, result.Status, result.HttpStatus, requestId, route.CorsTier, evaluation.Origin, result.RetryAfterSeconds); return;
            case "token":
                if (evaluation.Class != OriginClass.Allowed)
                {
                    var consent = await _consent.GetAsync(evaluation.Origin!, context.RequestAborted);
                    var code = consent.State == "pending" ? "consent-pending" : consent.State is "denied" or "blocked" ? "consent-denied" : "unauthorized-origin";
                    await Problem(context, 403, code, true, requestId, route.CorsTier, evaluation.Origin, consent.State == "pending" ? consent.PollAfterSeconds : consent.RetryAfterSeconds);
                    return;
                }
                var token = _tokens.Issue(evaluation.Origin!);
                if (token.Token is null) { await Problem(context, token.HttpStatus, token.ProblemCode!, true, requestId, route.CorsTier, evaluation.Origin, token.RetryAfterSeconds, limitName: token.LimitName); return; }
                await WriteJson(context, token.Token, 201, requestId, route.CorsTier, evaluation.Origin); return;
            case "renew":
                var renewed = _tokens.Renew(Bearer(context)!, evaluation.Origin!);
                if (renewed.Token is null) { await Problem(context, renewed.HttpStatus, renewed.ProblemCode!, renewed.HttpStatus != 403, requestId, route.CorsTier, evaluation.Origin, renewed.RetryAfterSeconds, renewed.HttpStatus == 401); return; }
                await WriteJson(context, renewed.Token, 200, requestId, route.CorsTier, evaluation.Origin); return;
            case "revoke":
                if (!_tokens.Revoke(Bearer(context)!, evaluation.Origin!)) { await Problem(context, 401, "token-invalid", true, requestId, route.CorsTier, CorsOrigin(route.CorsTier, evaluation), wwwAuthenticate: true); return; }
                context.Response.StatusCode = 204; ApplyCors(context, route.CorsTier, evaluation.Origin); return;
            case "devices":
                var devices = await _discovery.ListAsync(context.RequestAborted);
                var currentDevicesAuth = await RecheckAuthorization(context, route, requestId);
                if (currentDevicesAuth is null) return;
                await WriteJson(context, devices, 200, requestId, route.CorsTier, currentDevicesAuth.Origin); return;
            case "refresh":
                var refreshed = await _discovery.RefreshAsync(context.RequestAborted);
                var currentRefreshAuth = await RecheckAuthorization(context, route, requestId);
                if (currentRefreshAuth is null) return;
                await WriteJson(context, refreshed, 200, requestId, route.CorsTier, currentRefreshAuth.Origin); return;
            case "caps":
                try
                {
                    var caps = await _discovery.GetCapsAsync(route.DeviceId!, context.RequestAborted);
                    var currentCapsAuth = await RecheckAuthorization(context, route, requestId);
                    if (currentCapsAuth is null) return;
                    if (caps is null) { await Problem(context, 404, "not-found", true, requestId, route.CorsTier, evaluation.Origin); return; }
                    CapabilityValidator.Validate(caps);
                    await WriteJson(context, caps, 200, requestId, route.CorsTier, currentCapsAuth.Origin); return;
                }
                catch (OperationCanceledException) { throw; }
                catch (ScanFailureException failure) { await Problem(context, StatusForScanError(failure.Error.Code), failure.Error.Code, true, requestId, route.CorsTier, evaluation.Origin, retryable: failure.Error.Retryable); return; }
                catch { await Problem(context, 500, "unknown", true, requestId, route.CorsTier, evaluation.Origin); return; }
            default:
                await Problem(context, 404, "not-found", true, requestId, route.CorsTier, evaluation.Origin); return;
        }
    }

    private async Task<OriginEvaluation?> RecheckAuthorization(HttpContext context, Route route, string requestId, OriginEvaluation? previous = null)
    {
        var evaluation = _origins.Evaluate(context.Request.Headers.Origin, _consent.IsGranted);
        if ((route.Name == "consent-get" && evaluation.Class == OriginClass.Absent) ||
            (route.Name == "token" && previous?.Class == OriginClass.Allowed && evaluation.Class != OriginClass.Allowed) ||
            !OriginAllowedForRoute(route, evaluation))
        {
            await Problem(context, 403, "unauthorized-origin", false, requestId);
            return null;
        }

        if (route.Protected)
        {
            var auth = Authenticate(context, evaluation.Origin);
            if (!auth.Valid)
            {
                await Problem(context, 401, auth.Code, true, requestId, route.CorsTier, CorsOrigin(route.CorsTier, evaluation), wwwAuthenticate: true);
                return null;
            }
            context.Items["zilo.auth"] = auth.Token;
        }

        return evaluation;
    }

    private object Hello(bool full)
    {
        var publicHello = new Dictionary<string, object?> { ["product"] = "zilo", ["scope"] = full ? "full" : "public", ["protocol"] = new { min = "1.0", max = "1.0" }, ["capabilities"] = full ? new[] { "auth.consent", "auth.token", "transport.http", "devices.refresh" } : new[] { "auth.consent", "auth.token", "transport.http" } };
        if (full)
        {
            publicHello["version"] = _options.Version; publicHello["os"] = _options.OperatingSystem; publicHello["arch"] = _options.Architecture;
            publicHello["instanceId"] = _options.InstanceId; publicHello["limits"] = _options.Limits;
        }
        return publicHello;
    }

    private async Task Preflight(HttpContext context, Route? route, string requestId)
    {
        if (route is null) { context.Response.StatusCode = 403; return; }
        var requestedMethod = context.Request.Headers.AccessControlRequestMethod.ToString();
        route = Route.Match(context.Request.Path, requestedMethod);
        if (route is null) { context.Response.StatusCode = 403; return; }
        var evaluation = _origins.Evaluate(context.Request.Headers.Origin, _consent.IsGranted);
        if (evaluation.Class == OriginClass.Absent || !OriginAllowedForRoute(route, evaluation)) { context.Response.StatusCode = 403; return; }
        context.Response.StatusCode = 204; context.Response.Headers["Access-Control-Allow-Origin"] = evaluation.Origin!;
        context.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE";
        context.Response.Headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Last-Event-ID, If-None-Match";
        context.Response.Headers["Access-Control-Max-Age"] = "600";
        context.Response.Headers["Vary"] = "Origin, Access-Control-Request-Method, Access-Control-Request-Headers";
        await Task.CompletedTask;
    }

    private async Task<bool> BodyIsValid(HttpContext context, string requestId, CorsTier tier, string routeName)
    {
        if (context.Request.ContentLength > _options.Limits.MaxRequestBodyBytes) { await Problem(context, 413, "limits-exceeded", true, requestId, tier, context.Request.Headers.Origin, limitName: "maxRequestBodyBytes"); return false; }
        if (!string.IsNullOrEmpty(context.Request.ContentType) && !context.Request.ContentType.Split(';', 2)[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase))
        { await Problem(context, 400, "invalid-request", true, requestId, tier, context.Request.Headers.Origin); return false; }
        if (context.Request.Body.CanRead && (context.Request.ContentLength is > 0 or null))
        {
            await using var body = new MemoryStream();
            var buffer = new byte[(int)Math.Min(8192L, (long)_options.Limits.MaxRequestBodyBytes + 1)];
            long read = 0;
            while (read <= _options.Limits.MaxRequestBodyBytes)
            {
                var n = await context.Request.Body.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, (long)_options.Limits.MaxRequestBodyBytes + 1 - read)), context.RequestAborted);
                if (n == 0) break;
                await body.WriteAsync(buffer.AsMemory(0, n), context.RequestAborted); read += n;
                if (read > _options.Limits.MaxRequestBodyBytes) { await Problem(context, 413, "limits-exceeded", true, requestId, tier, context.Request.Headers.Origin, limitName: "maxRequestBodyBytes"); return false; }
            }
            if (read > 0)
            {
                try
                {
                    using var document = JsonDocument.Parse(body.ToArray());
                    if (routeName == "token" && !ValidTokenRequest(document.RootElement)) throw new JsonException();
                }
                catch (JsonException) { await Problem(context, 400, "invalid-request", true, requestId, tier, context.Request.Headers.Origin); return false; }
                context.Request.Body = new MemoryStream(body.ToArray());
            }
        }
        return true;
    }

    private static bool ValidTokenRequest(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return false;
        // Unknown fields are ignored per R-V5; known fields remain strictly typed.
        foreach (var property in root.EnumerateObject())
        {
            if (property.Name != "sdk") continue;
            if (property.Value.ValueKind != JsonValueKind.Object) return false;
            foreach (var field in property.Value.EnumerateObject())
                if (field.Name is "name" or "version" && (field.Value.ValueKind != JsonValueKind.String || field.Value.GetString()!.EnumerateRunes().Count() > 64)) return false;
        }
        return true;
    }

    private (bool Valid, string Code, AuthenticatedToken? Token) Authenticate(HttpContext context, string? origin)
        => origin is null ? (false, "token-invalid", null) : _tokens.Validate(Bearer(context), origin) switch { var x => (x.Status == 200, x.Code, x.Token) };

    private static bool TryBearer(HttpContext context, out string token) { token = Bearer(context) ?? ""; return token.Length > 0; }
    private static string? Bearer(HttpContext context)
    {
        var value = context.Request.Headers.Authorization.ToString();
        return value.StartsWith("Bearer ", StringComparison.Ordinal) && value.Length > 7 && !value[7..].Contains(' ') ? value[7..] : null;
    }

    private static bool IsHostAllowed(HttpContext context)
    {
        var host = context.Request.Headers.Host.ToString(); if (host.Length == 0) return false;
        var port = context.Connection.LocalPort; return host.Equals($"127.0.0.1:{port}", StringComparison.OrdinalIgnoreCase) || host.Equals($"localhost:{port}", StringComparison.OrdinalIgnoreCase) || host.Equals($"[::1]:{port}", StringComparison.OrdinalIgnoreCase);
    }

    private static bool OriginAllowedForRoute(Route route, OriginEvaluation evaluation) => route.CorsTier switch
    {
        CorsTier.PreAuthGet => evaluation.Class is OriginClass.Absent or OriginClass.Eligible or OriginClass.DevEligible or OriginClass.Allowed,
        CorsTier.PreAuthPost => evaluation.Class is OriginClass.Eligible or OriginClass.Allowed,
        _ => evaluation.Class == OriginClass.Allowed
    };

    private static string? CorsOrigin(CorsTier tier, OriginEvaluation evaluation) => tier switch
    {
        CorsTier.PreAuthGet when evaluation.Class is OriginClass.Eligible or OriginClass.DevEligible or OriginClass.Allowed => evaluation.Origin,
        CorsTier.PreAuthPost when evaluation.Class is OriginClass.Eligible or OriginClass.Allowed => evaluation.Origin,
        CorsTier.Allowed when evaluation.Class == OriginClass.Allowed => evaluation.Origin,
        _ => null
    };

    private static async Task WriteJson(HttpContext context, object value, int status, string requestId, CorsTier tier, string? origin, int? retryAfter = null)
    {
        context.Response.StatusCode = status; context.Response.ContentType = "application/json"; if (retryAfter is not null) context.Response.Headers.RetryAfter = retryAfter.Value.ToString();
        ApplyCors(context, tier, origin); await context.Response.WriteAsync(JsonSerializer.Serialize(value, Json));
    }

    private static async Task Problem(HttpContext context, int status, string code, bool cors, string requestId, CorsTier tier = CorsTier.None, string? origin = null, int? retryAfter = null, bool wwwAuthenticate = false, bool blocked = false, bool? retryable = null, string? limitName = null)
    {
        context.Response.StatusCode = status; context.Response.ContentType = "application/problem+json"; if (retryAfter is not null) context.Response.Headers.RetryAfter = retryAfter.Value.ToString(); if (wwwAuthenticate) context.Response.Headers.WWWAuthenticate = "Bearer error=\"invalid_token\""; if (cors) ApplyCors(context, tier, origin);
        var body = new { type = $"urn:zilo:problem:{code}", title = code, status, detail = code, instance = context.Request.Path.Value, code, retryable = retryable ?? (status is 408 or 429 or 503 || code == "consent-pending" || code == "device-busy" || code == "timeout" || (code == "consent-denied" && retryAfter is not null)), retryAfterSeconds = retryAfter, blocked = blocked ? true : (bool?)null, limit = limitName is null ? null : new { name = limitName }, requestId };
        await context.Response.WriteAsync(JsonSerializer.Serialize(body, Json));
    }

    private static void ApplyCors(HttpContext context, CorsTier tier, string? origin)
    { if (!string.IsNullOrEmpty(origin)) { context.Response.Headers["Access-Control-Allow-Origin"] = origin; context.Response.Headers["Access-Control-Expose-Headers"] = "ETag, Retry-After, Content-Disposition, Location, Zilo-Request-Id, Zilo-Page-Count"; } }
    private static string NewId() => Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(12)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static int StatusForScanError(string code) => code switch { "not-found" => 404, "device-busy" => 409, "timeout" => 504, "permission" => 403, "disconnected" => 503, _ => 500 };

    internal enum CorsTier { None, PreAuthGet, PreAuthPost, Allowed }
    internal sealed record Route(string Name, string[] Methods, CorsTier CorsTier, bool Protected = false, bool Body = false, string? DeviceId = null)
    {
        public bool MethodAllowed(string method) => Methods.Contains(method, StringComparer.Ordinal);
        public static Route? Match(PathString path, string method)
        {
            var p = path.Value ?? "";
            if (p == "/zilo/v1/hello") return new("hello", ["GET"], CorsTier.PreAuthGet);
            if (p == "/zilo/v1/auth/consent") return method == "GET" ? new("consent-get", ["GET", "POST"], CorsTier.PreAuthGet) : method == "POST" ? new("consent-post", ["GET", "POST"], CorsTier.PreAuthPost, Body: true) : new("consent-get", ["GET", "POST"], CorsTier.PreAuthGet, Body: true);
            if (p == "/zilo/v1/auth/token") return method == "DELETE" ? new("revoke", ["POST", "DELETE"], CorsTier.Allowed, Protected: true, Body: true) : new("token", ["POST", "DELETE"], method == "POST" ? CorsTier.PreAuthPost : CorsTier.Allowed, Protected: false, Body: true);
            if (p == "/zilo/v1/auth/token/renew") return new("renew", ["POST"], CorsTier.Allowed, Protected: true, Body: true);
            if (p == "/zilo/v1/devices") return new("devices", ["GET"], CorsTier.Allowed, Protected: true);
            if (p == "/zilo/v1/devices/refresh") return new("refresh", ["POST"], CorsTier.Allowed, Protected: true, Body: true);
            const string prefix = "/zilo/v1/devices/"; const string suffix = "/caps";
            if (p.StartsWith(prefix, StringComparison.Ordinal) && p.EndsWith(suffix, StringComparison.Ordinal)) return new("caps", ["GET"], CorsTier.Allowed, Protected: true, DeviceId: p[prefix.Length..^suffix.Length]);
            if (p is "/zilo/v1/jobs" || p.StartsWith("/zilo/v1/jobs/", StringComparison.Ordinal))
                return new("unimplemented", ["GET", "POST", "DELETE"], CorsTier.Allowed, Protected: true, Body: method is "POST" or "DELETE");
            return null;
        }
    }
}
