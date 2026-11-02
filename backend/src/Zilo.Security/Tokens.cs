using System.Security.Cryptography;

namespace Zilo.Security;

public sealed record TokenLimits(int TokenTtlSeconds = 3600, int TokenRenewGraceSeconds = 60,
    int FamilyMaxSeconds = 86400, int MaxFamiliesPerOrigin = 16, int MaxFamiliesTotal = 64,
    int TokenIssuesPerOriginPerHour = 20, int MaxRetainedAuthRecords = 1024);

public sealed record IssuedToken(string Token, string TokenType, string Origin, string FamilyId,
    DateTimeOffset IssuedAt, DateTimeOffset ExpiresAt, int ExpiresIn, DateTimeOffset RenewAfter,
    DateTimeOffset FamilyExpiresAt);

public sealed record TokenResult(IssuedToken? Token, int HttpStatus = 200, string? ProblemCode = null,
    int? RetryAfterSeconds = null, string? LimitName = null);

public sealed record AuthenticatedToken(string Origin, string FamilyId, bool Revoked);

public sealed class TokenService
{
    // Agent's synchronous response selection shares the mutation monitor. No IO,
    // awaits, user callbacks or serialization may run inside that commit section.
    internal object AuthorizationGate => _gate;
    private readonly TokenLimits _limits;
    private readonly IClock _clock;
    private readonly object _gate = new();
    private readonly ConsentStore? _consent;
    private readonly Func<string, bool>? _isBaked;
    private readonly Dictionary<string, Family> _families = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _hashToFamily = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Queue<DateTimeOffset>> _issues = new(StringComparer.Ordinal);
    private readonly Dictionary<string, RevokedRecord> _revoked = new(StringComparer.Ordinal);
    private readonly Queue<string> _revokedOrder = new();

    public TokenService(TokenLimits? limits = null, IClock? clock = null, ConsentStore? consent = null, Func<string, bool>? isBaked = null)
    {
        _limits = limits ?? new(); _clock = clock ?? new SystemClock();
        if (_limits.TokenTtlSeconds < 300 || _limits.TokenRenewGraceSeconds is < 0 or > 300 ||
            _limits.FamilyMaxSeconds < 3600 || _limits.MaxFamiliesPerOrigin <= 0 || _limits.MaxFamiliesTotal <= 0 ||
            _limits.TokenIssuesPerOriginPerHour <= 0 || _limits.MaxRetainedAuthRecords <= 0)
            throw new ArgumentOutOfRangeException(nameof(limits));
        _consent = consent; _isBaked = isBaked;
        _gate = consent?.AuthorizationGate ?? new object();
    }

    public TokenResult Issue(string origin)
    {
        lock (_gate)
        {
            if (!IsAllowed(origin)) return new(null, 403, "unauthorized-origin");
            var now = _clock.UtcNow;
            Purge(now);
            var existed = _issues.TryGetValue(origin, out var existingLog);
            if (!existed && _issues.Count >= 256)
            {
                var oldest = _issues.OrderBy(x => x.Value.Count == 0 ? DateTimeOffset.MinValue : x.Value.Peek()).First().Key;
                _issues.Remove(oldest);
            }
            var log = existed ? existingLog! : (_issues[origin] = new());
            while (log.Count > 0 && now - log.Peek() >= TimeSpan.FromHours(1)) log.Dequeue();
            if (log.Count >= _limits.TokenIssuesPerOriginPerHour) return new(null, 429, "rate-limited", 3600);
            var existing = _families.Values.Where(f => f.Origin == origin && !f.Revoked && f.FamilyExpiresAt > now).ToList();
            if (_families.Count(f => !f.Value.Revoked && f.Value.FamilyExpiresAt > now) >= _limits.MaxFamiliesTotal)
                return new(null, 429, "limits-exceeded", 1, "maxFamiliesTotal");
            if (existing.Count >= _limits.MaxFamiliesPerOrigin)
            {
                var evict = existing.OrderBy(f => f.LastUsed).First(); DropFamily(evict);
            }
            var familyId = NewSecret(12);
            var raw = NewSecret(32);
            var family = new Family(origin, familyId, now.AddSeconds(_limits.FamilyMaxSeconds));
            var token = AddToken(family, raw, now);
            _families.Add(familyId, family); _hashToFamily[Hash(raw)] = familyId; log.Enqueue(now);
            return new(token, 201);
        }
    }

    // Non-consuming transport precheck. Issue rechecks atomically when committing,
    // so concurrent bodies can never bypass the credential issuance budget.
    public int? IssueRetryAfter(string origin)
    {
        lock (_gate)
        {
            var now = _clock.UtcNow;
            if (!_issues.TryGetValue(origin, out var log)) return null;
            while (log.Count > 0 && now - log.Peek() >= TimeSpan.FromHours(1)) log.Dequeue();
            return log.Count >= _limits.TokenIssuesPerOriginPerHour
                ? Math.Max(1, (int)Math.Ceiling((log.Peek().AddHours(1) - now).TotalSeconds)) : null;
        }
    }

    public TokenResult Renew(string raw, string origin)
    {
        lock (_gate)
        {
            if (!IsAllowed(origin)) return new(null, 403, "unauthorized-origin");
            Purge(_clock.UtcNow);
            if (!TryFind(raw, out var family, out var current)) return RevokedResult(raw, origin);
            if (family.Origin != origin) return new(null, 401, "token-invalid");
            if (family.Revoked) return new(null, 401, "token-revoked");
            var now = _clock.UtcNow;
            if (now >= current.ExpiresAt || now >= family.FamilyExpiresAt) return new(null, 401, "token-invalid");
            if (current.SuccessorHash is not null || current.ExpiresAt >= family.FamilyExpiresAt)
                return new(null, 409, "invalid-state");
            if (now < current.RenewAfter) return new(null, 429, "rate-limited", (int)Math.Ceiling((current.RenewAfter - now).TotalSeconds));
            var rawNext = NewSecret(32);
            var token = AddToken(family, rawNext, now);
            current.SuccessorHash = Hash(rawNext); current.GraceUntil = now.AddSeconds(Math.Min(_limits.TokenRenewGraceSeconds, (current.ExpiresAt - now).TotalSeconds));
            _hashToFamily[current.SuccessorHash] = family.FamilyId;
            return new(token, 200);
        }
    }

    public (int Status, string Code, AuthenticatedToken? Token) Validate(string? raw, string origin)
    {
        lock (_gate)
        {
            Purge(_clock.UtcNow);
            if (string.IsNullOrWhiteSpace(raw)) return (401, "token-invalid", null);
            if (!TryFind(raw, out var family, out var record)) return RevokedValidation(raw, origin);
            var now = _clock.UtcNow;
            if (family.Origin != origin) return (401, "token-invalid", null);
            if (family.Revoked) return (401, "token-revoked", null);
            family.LastUsed = now;
            if (now >= family.FamilyExpiresAt || now >= record.ExpiresAt || (record != family.Current && now >= record.GraceUntil)) return (401, "token-invalid", null);
            return (200, "", new(family.Origin, family.FamilyId, false));
        }
    }

    public bool Revoke(string raw, string origin)
    {
        lock (_gate)
        {
            Purge(_clock.UtcNow);
            if (!TryFind(raw, out var family, out _)) return false;
            if (family.Origin != origin || family.Revoked) return false;
            RevokeFamily(family, _clock.UtcNow); return true;
        }
    }

    public int RevokeOrigin(string origin)
    {
        lock (_gate)
        {
            var count = 0;
            foreach (var family in _families.Values.Where(x => x.Origin == origin && !x.Revoked).ToArray()) { RevokeFamily(family, _clock.UtcNow); count++; }
            return count;
        }
    }

    private bool TryFind(string raw, out Family family, out TokenRecord record)
    {
        family = null!; record = null!;
        var hash = Hash(raw);
        if (!_hashToFamily.TryGetValue(hash, out var id) || !_families.TryGetValue(id, out family!)) return false;
        record = family.Tokens.FirstOrDefault(x => CryptographicOperations.FixedTimeEquals(Convert.FromHexString(x.Hash), Convert.FromHexString(hash)))!;
        return record is not null;
    }

    private bool IsAllowed(string origin) => _consent is null || _isBaked?.Invoke(origin) == true || _consent.IsGranted(origin);

    private void Purge(DateTimeOffset now)
    {
        foreach (var pair in _families.Where(p => p.Value.FamilyExpiresAt <= now || p.Value.Current.ExpiresAt <= now || (p.Value.Revoked && p.Value.Tokens.All(t => t.ExpiresAt <= now))).ToArray())
        {
            _families.Remove(pair.Key);
            foreach (var token in pair.Value.Tokens) _hashToFamily.Remove(token.Hash);
        }
        foreach (var hash in _revoked.Where(x => x.Value.ExpiresAt <= now).Select(x => x.Key).ToArray()) _revoked.Remove(hash);
    }

    private IssuedToken AddToken(Family family, string raw, DateTimeOffset issued)
    {
            var expires = issued.AddTicks(Math.Min(TimeSpan.FromSeconds(_limits.TokenTtlSeconds).Ticks, Math.Max(1, family.FamilyExpiresAt.Ticks - issued.Ticks)));
            var previous = family.Tokens.Count == 0 ? null : family.Current;
            var record = new TokenRecord(Hash(raw), issued, expires, issued.AddTicks((expires - issued).Ticks * 3 / 4));
            family.LastUsed = issued;
            family.Tokens.Add(record); family.Current = record;
            foreach (var old in family.Tokens.Where(x => x != record && x != previous).ToArray()) { family.Tokens.Remove(old); _hashToFamily.Remove(old.Hash); }
            return new(raw, "Bearer", family.Origin, family.FamilyId, issued, expires, Math.Max(1, (int)Math.Ceiling((expires - issued).TotalSeconds)), record.RenewAfter, family.FamilyExpiresAt);
    }

    private static string NewSecret(int bytes) => Base64Url(RandomNumberGenerator.GetBytes(bytes));
    private static string Hash(string raw) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(raw)));
    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed class Family(string origin, string familyId, DateTimeOffset familyExpiresAt)
    {
        public string Origin { get; } = origin; public string FamilyId { get; } = familyId;
        public DateTimeOffset FamilyExpiresAt { get; } = familyExpiresAt; public bool Revoked { get; set; }
        public DateTimeOffset LastUsed { get; set; } = familyExpiresAt;
        public List<TokenRecord> Tokens { get; } = new(); public TokenRecord Current { get; set; } = null!;
    }

    private TokenResult RevokedResult(string raw, string origin)
    {
        var result = RevokedValidation(raw, origin);
        return new(null, result.Status, result.Code);
    }

    private (int Status, string Code, AuthenticatedToken? Token) RevokedValidation(string raw, string origin)
    {
        var hash = Hash(raw);
        if (_revoked.TryGetValue(hash, out var revoked) && revoked.ExpiresAt > _clock.UtcNow)
            return (401, revoked.Origin == origin ? "token-revoked" : "token-invalid", null);
        return (401, "token-invalid", null);
    }

    private void RevokeFamily(Family family, DateTimeOffset now)
    {
        family.Revoked = true;
        foreach (var token in family.Tokens) { _revoked[token.Hash] = new(family.Origin, token.ExpiresAt); _revokedOrder.Enqueue(token.Hash); }
        DropFamily(family);
        while (_revokedOrder.Count > _limits.MaxRetainedAuthRecords)
        {
            var old = _revokedOrder.Dequeue(); _revoked.Remove(old);
        }
    }

    private sealed record RevokedRecord(string Origin, DateTimeOffset ExpiresAt);
    private void DropFamily(Family family)
    {
        _families.Remove(family.FamilyId);
        foreach (var token in family.Tokens) _hashToFamily.Remove(token.Hash);
    }

    private sealed class TokenRecord(string hash, DateTimeOffset issuedAt, DateTimeOffset expiresAt, DateTimeOffset renewAfter)
    {
        public string Hash { get; } = hash; public DateTimeOffset IssuedAt { get; } = issuedAt;
        public DateTimeOffset ExpiresAt { get; } = expiresAt; public DateTimeOffset RenewAfter { get; } = renewAfter;
        public string? SuccessorHash { get; set; } public DateTimeOffset GraceUntil { get; set; }
    }
}
