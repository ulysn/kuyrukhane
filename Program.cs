using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using MimeKit;
using MailKit.Net.Smtp;
using MailKit.Security;

var builder = WebApplication.CreateBuilder(args);

// Render injects DATABASE_URL as a postgres:// URI — convert to Npgsql key=value format
static string? ParseDatabaseUrl(string? url)
{
    if (string.IsNullOrEmpty(url)) return null;
    var uri = new Uri(url);
    var userInfo = uri.UserInfo.Split(':', 2);
    return $"Host={uri.Host};Port={uri.Port};Database={uri.AbsolutePath.TrimStart('/')};Username={userInfo[0]};Password={Uri.UnescapeDataString(userInfo[1])};SSL Mode=Require;Trust Server Certificate=true";
}

var connectionString = ParseDatabaseUrl(Environment.GetEnvironmentVariable("DATABASE_URL"))
    ?? builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured. Set it via user secrets or the ConnectionStrings__DefaultConnection environment variable.");

builder.Services.AddDbContext<LibraryDb>(opt =>
    opt.UseNpgsql(connectionString));

builder.Services.AddHttpClient();
builder.Services.AddTransient<EmailService>();

builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("auth", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit          = 10,
                Window               = TimeSpan.FromMinutes(1),
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit           = 0,
            }));
    options.RejectionStatusCode = 429;
});

var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("Jwt:Key is not configured. Set it via user secrets or the Jwt__Key environment variable.");

_ = builder.Configuration["Email:From"]
    ?? throw new InvalidOperationException("Email:From is not configured. Set it via user secrets or the Email__From environment variable.");
_ = builder.Configuration["Email:Smtp:Host"]
    ?? throw new InvalidOperationException("Email:Smtp:Host is not configured. Set it via user secrets or the Email__Smtp__Host environment variable.");
_ = builder.Configuration["Email:Smtp:Username"]
    ?? throw new InvalidOperationException("Email:Smtp:Username is not configured. Set it via user secrets or the Email__Smtp__Username environment variable.");
_ = builder.Configuration["Email:Smtp:Password"]
    ?? throw new InvalidOperationException("Email:Smtp:Password is not configured. Set it via user secrets or the Email__Smtp__Password environment variable.");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        var key = Encoding.UTF8.GetBytes(jwtKey);
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey        = new SymmetricSecurityKey(key),
            ValidateIssuer          = true,
            ValidIssuer             = builder.Configuration["Jwt:Issuer"],
            ValidateAudience        = true,
            ValidAudience           = builder.Configuration["Jwt:Audience"],
            ValidateLifetime        = true,
            ClockSkew               = TimeSpan.Zero,
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                ctx.Token = ctx.Request.Cookies["auth"];
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("Admin", policy => policy.RequireClaim(ClaimTypes.Role, "admin"));
});

builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString);

var app = builder.Build();
var isDevelopment = app.Environment.IsDevelopment();

app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    KnownNetworks    = { new IPNetwork(IPAddress.Parse("172.16.0.0"), 12) },
});

if (!isDevelopment)
{
    app.UseHttpsRedirection();
    app.UseHsts();
}

using (var scope = app.Services.CreateScope())
{
    try
    {
        scope.ServiceProvider.GetRequiredService<LibraryDb>().Database.Migrate();
    }
    catch (Exception ex)
    {
        var log = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
        log.LogError(ex, "Database migration failed — app starting without migrations.");
    }
}

app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.Append("X-Content-Type-Options", "nosniff");
    ctx.Response.Headers.Append("X-Frame-Options", "DENY");
    ctx.Response.Headers.Append("Referrer-Policy", "strict-origin-when-cross-origin");
    ctx.Response.Headers.Append("X-Permitted-Cross-Domain-Policies", "none");
    ctx.Response.Headers.Append("Permissions-Policy", "microphone=(), geolocation=(), payment=()");
    ctx.Response.Headers.Append("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'");
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapHealthChecks("/health");

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

app.MapPost("/register", async (RegisterRequest req, LibraryDb db, EmailService emailSvc, IConfiguration config) =>
{
    if (string.IsNullOrWhiteSpace(req.Name)     || req.Name.Length    > 100) return Results.BadRequest("Username is required and must be ≤ 100 characters.");
    if (string.IsNullOrWhiteSpace(req.Email)    || !IsValidEmail(req.Email) || req.Email.Length > 200) return Results.BadRequest("A valid email address is required.");
    if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 8)  return Results.BadRequest("Password must be at least 8 characters.");

    var normalizedEmail = req.Email.Trim().ToLowerInvariant();

    if (await db.Users.AnyAsync(u => u.Name == req.Name.Trim()))
        return Results.Conflict($"Username '{req.Name}' is already taken.");
    if (await db.Users.AnyAsync(u => u.Email == normalizedEmail))
        return Results.Conflict($"Email '{req.Email}' is already registered.");

    var verificationToken = Guid.NewGuid().ToString("N");
    var user = new User
    {
        Name                   = req.Name.Trim(),
        Email                  = normalizedEmail,
        Role                   = "user",
        PasswordHash           = BCrypt.Net.BCrypt.HashPassword(req.Password),
        IsEmailVerified        = false,
        EmailVerificationToken = verificationToken,
    };

    db.Users.Add(user);
    await db.SaveChangesAsync();

    var baseUrl = (config["App:BaseUrl"] ?? "http://localhost:5254").TrimEnd('/');
    var verificationUrl = $"{baseUrl}/verify-email?token={verificationToken}";

    try
    {
        await emailSvc.SendVerificationEmailAsync(normalizedEmail, verificationUrl, req.Name.Trim());
    }
    catch
    {
        db.Users.Remove(user);
        await db.SaveChangesAsync();
        return Results.Problem("Failed to send verification email. Check your email configuration and try again.", statusCode: 502);
    }

    return Results.Created($"/users/{user.Id}", new { message = "Registration successful. Please check your email to verify your account." });
})
.RequireRateLimiting("auth");

app.MapPost("/login", async (LoginRequest req, LibraryDb db, IConfiguration config, HttpContext ctx) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Name == req.Name.Trim());
    if (user is null)
        return Results.Unauthorized();

    if (user.LockoutUntil > DateTime.UtcNow)
        return Results.Problem(detail: "ACCOUNT_LOCKED", title: "Account temporarily locked", statusCode: 429);

    if (user.PasswordHash is null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
    {
        user.FailedLoginAttempts++;
        if (user.FailedLoginAttempts >= 10)
        {
            user.LockoutUntil        = DateTime.UtcNow.AddMinutes(15);
            user.FailedLoginAttempts = 0;
        }
        await db.SaveChangesAsync();
        return Results.Unauthorized();
    }

    // Users with an email set must verify it before they can log in.
    // Legacy users (no email) are exempt so existing accounts aren't broken.
    if (user.Email is not null && !user.IsEmailVerified)
        return Results.Problem(detail: "EMAIL_NOT_VERIFIED", title: "Email not verified", statusCode: 403);

    user.FailedLoginAttempts = 0;
    user.LockoutUntil        = null;

    var key     = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
    var creds   = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
    var expires = req.RememberMe ? DateTime.UtcNow.AddDays(7) : DateTime.UtcNow.AddHours(1);

    var claims = new List<Claim>
    {
        new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
        new Claim(ClaimTypes.Name,           user.Name),
        new Claim(ClaimTypes.Role,           user.Role),
    };
    if (user.Email is not null)
        claims.Add(new Claim(ClaimTypes.Email, user.Email));

    var jwt = new JwtSecurityToken(
        issuer:             config["Jwt:Issuer"],
        audience:           config["Jwt:Audience"],
        claims:             claims,
        expires:            expires,
        signingCredentials: creds
    );

    ctx.Response.Cookies.Append("auth", new JwtSecurityTokenHandler().WriteToken(jwt), new CookieOptions
    {
        HttpOnly = true,
        Secure   = ctx.Request.IsHttps,
        SameSite = SameSiteMode.Strict,
        Expires  = new DateTimeOffset(expires),
    });

    await db.SaveChangesAsync();
    return Results.Ok(new { userId = user.Id, name = user.Name, expiresAt = expires });
})
.RequireRateLimiting("auth");

app.MapPost("/logout", (HttpContext ctx) =>
{
    ctx.Response.Cookies.Delete("auth");
    return Results.NoContent();
});

app.MapGet("/me", (ClaimsPrincipal principal) =>
{
    var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    var name   = principal.FindFirstValue(ClaimTypes.Name)!;
    return Results.Ok(new { userId, name });
}).RequireAuthorization();

app.MapGet("/verify-email", async (string? token, LibraryDb db) =>
{
    if (string.IsNullOrWhiteSpace(token))
        return Results.Content(VerifyEmailHtml(false, "Invalid or missing verification token."), "text/html");

    var user = await db.Users.FirstOrDefaultAsync(u => u.EmailVerificationToken == token);
    if (user is null)
        return Results.Content(VerifyEmailHtml(false, "This verification link is invalid or has already been used."), "text/html");

    user.IsEmailVerified        = true;
    user.EmailVerificationToken = null;
    await db.SaveChangesAsync();

    return Results.Content(VerifyEmailHtml(true, "Your email has been verified. You can now sign in to Family Library."), "text/html");
});

app.MapPost("/resend-verification", async (ResendVerificationRequest req, LibraryDb db, EmailService emailSvc, IConfiguration config) =>
{
    if (string.IsNullOrWhiteSpace(req.Email) || !IsValidEmail(req.Email))
        return Results.BadRequest("A valid email address is required.");

    var normalizedEmail = req.Email.Trim().ToLowerInvariant();
    var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail && !u.IsEmailVerified);

    if (user is not null)
    {
        user.EmailVerificationToken = Guid.NewGuid().ToString("N");
        await db.SaveChangesAsync();

        var baseUrl = (config["App:BaseUrl"] ?? "http://localhost:5254").TrimEnd('/');
        var verificationUrl = $"{baseUrl}/verify-email?token={user.EmailVerificationToken}";
        try { await emailSvc.SendVerificationEmailAsync(user.Email!, verificationUrl, user.Name); }
        catch { /* best effort — don't expose send failures */ }
    }

    // Always return the same response to avoid email enumeration
    return Results.Ok(new { message = "If an unverified account with that email exists, a new verification email has been sent." });
})
.RequireRateLimiting("auth");

app.MapPost("/forgot-password", async (ForgotPasswordRequest req, LibraryDb db, EmailService emailSvc, IConfiguration config) =>
{
    if (string.IsNullOrWhiteSpace(req.Email) || !IsValidEmail(req.Email))
        return Results.BadRequest("A valid email address is required.");

    var normalizedEmail = req.Email.Trim().ToLowerInvariant();
    var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail);

    if (user is not null)
    {
        user.PasswordResetToken  = Guid.NewGuid().ToString("N");
        user.PasswordResetExpiry = DateTime.UtcNow.AddHours(1);
        await db.SaveChangesAsync();

        var baseUrl = (config["App:BaseUrl"] ?? "http://localhost:5254").TrimEnd('/');
        var resetUrl = $"{baseUrl}/reset-password?token={user.PasswordResetToken}";
        try { await emailSvc.SendPasswordResetEmailAsync(user.Email!, resetUrl, user.Name); }
        catch { /* best effort — don't expose send failures */ }
    }

    // Blind response — same reply whether the email exists or not
    return Results.Ok(new { message = "If an account with that email exists, a password reset link has been sent." });
})
.RequireRateLimiting("auth");

app.MapGet("/reset-password", async (string? token, LibraryDb db) =>
{
    if (string.IsNullOrWhiteSpace(token))
        return Results.Content(ResetPasswordHtml("invalid", ""), "text/html");

    var user = await db.Users.FirstOrDefaultAsync(u => u.PasswordResetToken == token);
    if (user is null || user.PasswordResetExpiry < DateTime.UtcNow)
        return Results.Content(ResetPasswordHtml("expired", ""), "text/html");

    return Results.Content(ResetPasswordHtml("form", token), "text/html");
});

app.MapPost("/reset-password", async (HttpContext ctx, LibraryDb db) =>
{
    var form        = await ctx.Request.ReadFormAsync();
    var token       = form["token"].ToString();
    var newPassword = form["password"].ToString();
    var confirm     = form["confirm"].ToString();

    if (string.IsNullOrWhiteSpace(token))
        return Results.Content(ResetPasswordHtml("invalid", ""), "text/html");

    if (string.IsNullOrWhiteSpace(newPassword) || newPassword.Length < 8)
        return Results.Content(ResetPasswordHtml("weak", token), "text/html");

    if (newPassword != confirm)
        return Results.Content(ResetPasswordHtml("mismatch", token), "text/html");

    var user = await db.Users.FirstOrDefaultAsync(u => u.PasswordResetToken == token);
    if (user is null || user.PasswordResetExpiry < DateTime.UtcNow)
        return Results.Content(ResetPasswordHtml("expired", ""), "text/html");

    user.PasswordHash        = BCrypt.Net.BCrypt.HashPassword(newPassword);
    user.PasswordResetToken  = null;
    user.PasswordResetExpiry = null;
    await db.SaveChangesAsync();

    if (user.Email is not null)
    {
        var emailSvc = ctx.RequestServices.GetRequiredService<EmailService>();
        try { await emailSvc.SendPasswordChangedEmailAsync(user.Email, user.Name); }
        catch { /* non-fatal — password is already updated */ }
    }

    return Results.Content(ResetPasswordHtml("success", ""), "text/html");
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKS
// ═══════════════════════════════════════════════════════════════════════════════

app.MapGet("/books", async (LibraryDb db, ClaimsPrincipal principal, string? search, bool? available, int page = 1, int pageSize = 20) =>
{
    var (householdId, err) = await GetUserHouseholdAsync(principal, db);
    if (err is not null) return err;

    if (page < 1) page = 1;
    pageSize = Math.Clamp(pageSize, 1, 1000);

    var query = db.Books.Where(b => b.HouseholdId == householdId);

    if (search is not null)
        query = query.Where(b =>
            EF.Functions.ILike(b.Baslik, $"%{search}%") ||
            EF.Functions.ILike(b.Yazar,  $"%{search}%"));

    if (available is not null)
        query = query.Where(b => b.IsAvailable == available);

    var total = await query.CountAsync();
    var items = await query
        .OrderBy(b => b.Id)
        .Skip((page - 1) * pageSize)
        .Take(pageSize)
        .ToListAsync();

    return Results.Ok(new { total, page, pageSize, items });
}).RequireAuthorization();

app.MapGet("/books/{id:int}", async (int id, LibraryDb db, ClaimsPrincipal principal) =>
{
    var (householdId, err) = await GetUserHouseholdAsync(principal, db);
    if (err is not null) return err;

    return await db.Books.FirstOrDefaultAsync(b => b.Id == id && b.HouseholdId == householdId)
        is Book book
            ? Results.Ok(book)
            : Results.NotFound();
}).RequireAuthorization();

app.MapPost("/books", async (Book book, LibraryDb db, ClaimsPrincipal principal) =>
{
    var (householdId, err) = await GetUserHouseholdAsync(principal, db);
    if (err is not null) return err;

    if (string.IsNullOrWhiteSpace(book.Baslik) || book.Baslik.Length > 500) return Results.BadRequest("Title is required and must be ≤ 500 characters.");
    if (string.IsNullOrWhiteSpace(book.Yazar)  || book.Yazar.Length  > 200) return Results.BadRequest("Author is required and must be ≤ 200 characters.");
    if (!IsValidIsbn(book.Isbn))                                             return Results.BadRequest("Invalid ISBN format. Expected ISBN-10 or ISBN-13.");

    if (await db.Books.AnyAsync(b => b.Isbn == book.Isbn && b.HouseholdId == householdId))
        return Results.Conflict($"ISBN {book.Isbn} already exists in your library.");

    book.HouseholdId = householdId;
    db.Books.Add(book);
    await db.SaveChangesAsync();
    return Results.Created($"/books/{book.Id}", book);
}).RequireAuthorization();

app.MapPut("/books/{id:int}", async (int id, Book input, LibraryDb db, ClaimsPrincipal principal) =>
{
    var (householdId, err) = await GetUserHouseholdAsync(principal, db);
    if (err is not null) return err;

    if (string.IsNullOrWhiteSpace(input.Baslik) || input.Baslik.Length > 500) return Results.BadRequest("Title is required and must be ≤ 500 characters.");
    if (string.IsNullOrWhiteSpace(input.Yazar)  || input.Yazar.Length  > 200) return Results.BadRequest("Author is required and must be ≤ 200 characters.");
    if (!IsValidIsbn(input.Isbn))                                              return Results.BadRequest("Invalid ISBN format. Expected ISBN-10 or ISBN-13.");

    var book = await db.Books.FirstOrDefaultAsync(b => b.Id == id && b.HouseholdId == householdId);
    if (book is null) return Results.NotFound();

    if (input.Isbn != book.Isbn && await db.Books.AnyAsync(b => b.Isbn == input.Isbn && b.HouseholdId == householdId))
        return Results.Conflict($"ISBN {input.Isbn} already exists in your library.");

    book.Baslik      = input.Baslik;
    book.Yazar       = input.Yazar;
    book.Isbn        = input.Isbn;
    book.IsAvailable = input.IsAvailable;

    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireAuthorization();

app.MapDelete("/books/{id:int}", async (int id, LibraryDb db, ClaimsPrincipal principal) =>
{
    var (householdId, err) = await GetUserHouseholdAsync(principal, db);
    if (err is not null) return err;

    if (await db.Books.FirstOrDefaultAsync(b => b.Id == id && b.HouseholdId == householdId) is not Book book)
        return Results.NotFound();
    db.Books.Remove(book);
    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireAuthorization();

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════════════════════════════════

app.MapPost("/books/import/{isbn}", async (string isbn, LibraryDb db, ClaimsPrincipal principal, IHttpClientFactory factory) =>
{
    var (householdId, err) = await GetUserHouseholdAsync(principal, db);
    if (err is not null) return err;

    if (!IsValidIsbn(isbn))
        return Results.BadRequest("Invalid ISBN format. Expected ISBN-10 or ISBN-13.");

    var client = factory.CreateClient();

    HttpResponseMessage olResponse;
    try { olResponse = await client.GetAsync($"https://openlibrary.org/isbn/{isbn}.json"); }
    catch (Exception ex) { return Results.Problem($"Could not reach Open Library: {ex.Message}", statusCode: 502); }

    if (olResponse.StatusCode == System.Net.HttpStatusCode.NotFound)
        return Results.NotFound($"ISBN {isbn} was not found on Open Library.");

    if (!olResponse.IsSuccessStatusCode)
        return Results.Problem($"Open Library returned {(int)olResponse.StatusCode}.", statusCode: 502);

    OLBook? data;
    try { data = await olResponse.Content.ReadFromJsonAsync<OLBook>(); }
    catch { return Results.Problem("Open Library returned an unexpected response format.", statusCode: 502); }
    if (data is null) return Results.Problem("Open Library returned an empty response.", statusCode: 502);

    if (await db.Books.FirstOrDefaultAsync(b => b.Isbn == isbn && b.HouseholdId == householdId) is not null)
        return Results.Conflict($"ISBN {isbn} already exists in your library.");

    var authorName = "Unknown Author";
    var authorKey  = data.Authors?.FirstOrDefault()?.Key;
    if (authorKey is not null)
    {
        try
        {
            var ar = await client.GetAsync($"https://openlibrary.org{authorKey}.json");
            if (ar.IsSuccessStatusCode)
            {
                var author = await ar.Content.ReadFromJsonAsync<OLAuthor>();
                authorName = author?.Name ?? authorName;
            }
        }
        catch { /* non-fatal; book saved with "Unknown Author" */ }
    }

    var book = new Book
    {
        Baslik      = data.Title ?? "Unknown Title",
        Yazar       = authorName,
        Isbn        = isbn,
        IsAvailable = true,
        HouseholdId = householdId,
    };

    db.Books.Add(book);
    await db.SaveChangesAsync();
    return Results.Created($"/books/{book.Id}", book);
}).RequireAuthorization().RequireRateLimiting("auth");


// ═══════════════════════════════════════════════════════════════════════════════
// HOUSEHOLD
// ═══════════════════════════════════════════════════════════════════════════════

app.MapPost("/household", async (CreateHouseholdRequest req, LibraryDb db, ClaimsPrincipal principal) =>
{
    if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Length > 100)
        return Results.BadRequest("Household name is required and must be ≤ 100 characters.");

    var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    var me = await db.Users.FindAsync(userId);
    if (me is null) return Results.Unauthorized();
    if (me.HouseholdId is not null) return Results.Conflict("You are already in a household.");

    var household = new Household { Name = req.Name.Trim(), OwnerId = userId };
    db.Households.Add(household);
    await db.SaveChangesAsync();

    me.HouseholdId = household.Id;
    await db.SaveChangesAsync();

    return Results.Created("/household", new
    {
        household.Id, household.Name, household.OwnerId,
        Members = new[] { new { me.Id, me.Name } },
    });
}).RequireAuthorization();

app.MapGet("/household", async (LibraryDb db, ClaimsPrincipal principal) =>
{
    var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    var me = await db.Users.FindAsync(userId);
    if (me?.HouseholdId is null) return Results.NotFound("You are not in a household.");

    var household = await db.Households.FindAsync(me.HouseholdId);
    if (household is null) return Results.NotFound("Household not found.");

    var members = await db.Users
        .Where(u => u.HouseholdId == household.Id)
        .Select(u => new { u.Id, u.Name, u.Email, IsOwner = u.Id == household.OwnerId })
        .ToListAsync();

    var isOwner = userId == household.OwnerId;
    return Results.Ok(new
    {
        household.Id, household.Name, household.OwnerId,
        InviteCode       = isOwner ? household.InviteCode       : null,
        InviteCodeExpiry = isOwner ? household.InviteCodeExpiry : null,
        Members = members,
    });
}).RequireAuthorization();

app.MapPost("/household/invite", async (LibraryDb db, ClaimsPrincipal principal) =>
{
    var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    var me = await db.Users.FindAsync(userId);
    if (me?.HouseholdId is null) return Results.NotFound("You are not in a household.");

    var household = await db.Households.FindAsync(me.HouseholdId);
    if (household is null) return Results.NotFound();
    if (household.OwnerId != userId) return Results.Forbid();

    household.InviteCode       = GenerateInviteCode();
    household.InviteCodeExpiry = DateTime.UtcNow.AddHours(48);
    await db.SaveChangesAsync();

    return Results.Ok(new { inviteCode = household.InviteCode, expiresAt = household.InviteCodeExpiry });
}).RequireAuthorization();

app.MapPost("/household/join", async (JoinHouseholdRequest req, LibraryDb db, ClaimsPrincipal principal) =>
{
    if (string.IsNullOrWhiteSpace(req.Code))
        return Results.BadRequest("Invite code is required.");

    var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    var me = await db.Users.FindAsync(userId);
    if (me is null) return Results.Unauthorized();
    if (me.HouseholdId is not null) return Results.Conflict("You are already in a household. Leave it first.");

    var code      = req.Code.Trim().ToUpperInvariant();
    var household = await db.Households.FirstOrDefaultAsync(h => h.InviteCode == code);

    if (household is null || household.InviteCodeExpiry < DateTime.UtcNow)
        return Results.NotFound("Invalid or expired invite code.");

    me.HouseholdId = household.Id;
    await db.SaveChangesAsync();

    var members = await db.Users
        .Where(u => u.HouseholdId == household.Id)
        .Select(u => new { u.Id, u.Name, IsOwner = u.Id == household.OwnerId })
        .ToListAsync();

    return Results.Ok(new { household.Id, household.Name, Members = members });
}).RequireAuthorization();

app.MapDelete("/household/leave", async (LibraryDb db, ClaimsPrincipal principal) =>
{
    var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    var me = await db.Users.FindAsync(userId);
    if (me?.HouseholdId is null) return Results.NotFound("You are not in a household.");

    var household = await db.Households.FindAsync(me.HouseholdId);
    if (household is null) return Results.NotFound();

    if (household.OwnerId == userId)
    {
        // Owner leaving disbands the household for everyone
        var members = await db.Users.Where(u => u.HouseholdId == household.Id).ToListAsync();
        foreach (var m in members) m.HouseholdId = null;
        db.Households.Remove(household);
    }
    else
    {
        me.HouseholdId = null;
    }

    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireAuthorization();

app.MapDelete("/household", async (LibraryDb db, ClaimsPrincipal principal) =>
{
    var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    var me = await db.Users.FindAsync(userId);
    if (me?.HouseholdId is null) return Results.NotFound("You are not in a household.");

    var household = await db.Households.FindAsync(me.HouseholdId);
    if (household is null) return Results.NotFound();
    if (household.OwnerId != userId) return Results.Forbid();

    var members = await db.Users.Where(u => u.HouseholdId == household.Id).ToListAsync();
    foreach (var m in members) m.HouseholdId = null;
    db.Households.Remove(household);
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization();

app.MapDelete("/household/members/{memberId:int}", async (int memberId, LibraryDb db, ClaimsPrincipal principal) =>
{
    var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    var me = await db.Users.FindAsync(userId);
    if (me?.HouseholdId is null) return Results.NotFound("You are not in a household.");

    var household = await db.Households.FindAsync(me.HouseholdId);
    if (household is null) return Results.NotFound();
    if (household.OwnerId != userId) return Results.Forbid();
    if (memberId == userId) return Results.BadRequest("Use DELETE /household/leave to leave a household.");

    var member = await db.Users.FirstOrDefaultAsync(u => u.Id == memberId && u.HouseholdId == me.HouseholdId);
    if (member is null) return Results.NotFound("Member not found in your household.");

    member.HouseholdId = null;
    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireAuthorization();

// ═══════════════════════════════════════════════════════════════════════════════
// USERS  (admin only)
// ═══════════════════════════════════════════════════════════════════════════════

app.MapGet("/users", async (LibraryDb db, int page = 1, int pageSize = 20) =>
{
    if (page < 1) page = 1;
    pageSize = Math.Clamp(pageSize, 1, 1000);

    var total = await db.Users.CountAsync();
    var items = await db.Users
        .OrderBy(u => u.Id)
        .Skip((page - 1) * pageSize)
        .Take(pageSize)
        .Select(u => new { u.Id, u.Name, u.Email, u.IsEmailVerified, u.Role })
        .ToListAsync();

    return Results.Ok(new { total, page, pageSize, items });
}).RequireAuthorization("Admin");

app.MapGet("/users/{id:int}", async (int id, LibraryDb db) =>
    await db.Users.FindAsync(id)
        is User user
            ? Results.Ok(new { user.Id, user.Name, user.Email, user.IsEmailVerified, user.Role })
            : Results.NotFound())
    .RequireAuthorization("Admin");

app.MapPost("/users", async (CreateUserRequest req, LibraryDb db) =>
{
    if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Length > 100) return Results.BadRequest("Name is required and must be ≤ 100 characters.");
    if (req.Email is not null && (!IsValidEmail(req.Email) || req.Email.Length > 200)) return Results.BadRequest("A valid email address is required.");

    var role            = req.Role is "admin" or "user" ? req.Role : "user";
    var normalizedEmail = req.Email?.Trim().ToLowerInvariant();

    if (await db.Users.AnyAsync(u => u.Name == req.Name.Trim()))
        return Results.Conflict($"Username '{req.Name}' is already taken.");
    if (normalizedEmail is not null && await db.Users.AnyAsync(u => u.Email == normalizedEmail))
        return Results.Conflict($"Email '{req.Email}' is already registered.");

    var user = new User
    {
        Name            = req.Name.Trim(),
        Email           = normalizedEmail,
        IsEmailVerified = true, // admin-created users are pre-verified
        Role            = role,
        PasswordHash    = req.Password is not null ? BCrypt.Net.BCrypt.HashPassword(req.Password) : null,
    };

    db.Users.Add(user);
    await db.SaveChangesAsync();
    return Results.Created($"/users/{user.Id}", new { user.Id, user.Name, user.Email, user.IsEmailVerified, user.Role });
}).RequireAuthorization("Admin");

app.MapPut("/users/{id:int}", async (int id, UpdateUserRequest req, LibraryDb db) =>
{
    if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Length > 100) return Results.BadRequest("Name is required.");

    var user = await db.Users.FindAsync(id);
    if (user is null) return Results.NotFound();

    var trimmed = req.Name.Trim();
    if (user.Name != trimmed && await db.Users.AnyAsync(u => u.Name == trimmed))
        return Results.Conflict($"Username '{req.Name}' is already taken.");

    user.Name = trimmed;
    if (req.Role is "admin" or "user") user.Role = req.Role;

    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireAuthorization("Admin");

app.MapDelete("/users/{id:int}", async (int id, LibraryDb db) =>
{
    if (await db.Users.FindAsync(id) is not User user) return Results.NotFound();
    db.Users.Remove(user);
    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireAuthorization("Admin");

app.Run();

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

static async Task<(int householdId, IResult? error)> GetUserHouseholdAsync(ClaimsPrincipal principal, LibraryDb db)
{
    var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    var user = await db.Users.FindAsync(userId);
    if (user?.HouseholdId is null)
        return (0, Results.BadRequest("You must be in a household to access books."));
    return (user.HouseholdId.Value, null);
}

static string GenerateInviteCode()
{
    // 8 uppercase chars; omits 0/O/I/L to avoid misreads
    const string chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars
    const int    limit = 248; // (256 / 31) * 31 — rejection threshold to remove bias
    var result = new char[8];
    var filled = 0;
    while (filled < 8)
    {
        foreach (var b in System.Security.Cryptography.RandomNumberGenerator.GetBytes(8))
        {
            if (b >= limit) continue; // reject to remove bias
            result[filled++] = chars[b % chars.Length];
            if (filled == 8) break;
        }
    }
    return new string(result);
}

static bool IsValidIsbn(string? isbn)
{
    if (isbn is null) return false;
    var digits = Regex.Replace(isbn, @"[\s-]", "");
    return Regex.IsMatch(digits, @"^(97[89]\d{10}|\d{9}[\dXx])$");
}

static bool IsValidEmail(string? email)
{
    if (string.IsNullOrWhiteSpace(email)) return false;
    return Regex.IsMatch(email.Trim(), @"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$");
}

static string ResetPasswordHtml(string state, string token)
{
    var css = "body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;"
            + "min-height:100vh;margin:0;background:#f5f5f5}"
            + ".card{background:#fff;padding:2rem 2.5rem;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.1);"
            + "max-width:420px;width:90%}"
            + "h1{margin-bottom:.5rem}"
            + "input{display:block;width:100%;box-sizing:border-box;padding:.6rem .75rem;margin:.4rem 0 .6rem;"
            + "border:1px solid #ccc;border-radius:6px;font-size:1rem}"
            + "button{width:100%;padding:.7rem;background:#2563eb;color:#fff;border:none;border-radius:6px;"
            + "font-size:1rem;cursor:pointer;margin-top:.4rem}"
            + ".err{color:#dc2626;font-size:.875rem;margin:.25rem 0}"
            + "a{color:#2563eb}p{color:#555;line-height:1.5}";

    var head = $"<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
             + $"<title>Reset Password &mdash; Family Library</title>"
             + $"<style>{css}</style></head>";

    if (state is "form" or "weak" or "mismatch")
    {
        var errMsg = state switch
        {
            "weak"     => "<p class=\"err\">Password must be at least 8 characters.</p>",
            "mismatch" => "<p class=\"err\">Passwords do not match.</p>",
            _          => "",
        };
        return head
             + $"<body><div class=\"card\"><h1 style=\"color:#1a1a2e\">Reset Password</h1>"
             + errMsg
             + $"<form method=\"post\" action=\"/reset-password\">"
             + $"<input type=\"hidden\" name=\"token\" value=\"{WebUtility.HtmlEncode(token)}\"/>"
             + "<input type=\"password\" name=\"password\" placeholder=\"New password (min. 8 characters)\" required autofocus/>"
             + "<input type=\"password\" name=\"confirm\" placeholder=\"Confirm new password\" required/>"
             + "<button type=\"submit\">Update password</button>"
             + "</form></div></body></html>";
    }

    var (heading, color, body) = state switch
    {
        "success" => ("Password Updated",  "#2563eb", "Your password has been updated. You can now sign in."),
        "expired" => ("Link Expired",      "#dc2626", "This reset link has expired. Please request a new one from the app."),
        _         => ("Invalid Link",      "#dc2626", "This reset link is invalid or has already been used."),
    };
    var extra = state == "success" ? "<p style=\"margin-top:1rem\"><a href=\"/\">Go to sign in &rarr;</a></p>" : "";
    return head
         + $"<body><div class=\"card\" style=\"text-align:center\">"
         + $"<h1 style=\"color:{color}\">{heading}</h1><p>{body}</p>{extra}"
         + "</div></body></html>";
}

static string VerifyEmailHtml(bool success, string message)
{
    var color   = success ? "#2563eb" : "#dc2626";
    var heading = success ? "Email Verified" : "Invalid Link";
    var extra   = success ? "<p style=\"margin-top:1rem\"><a href=\"/\">Go to sign in &rarr;</a></p>" : "";
    return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
         + "<title>Email Verification &mdash; Family Library</title>"
         + "<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;"
         + "min-height:100vh;margin:0;background:#f5f5f5}"
         + ".card{background:#fff;padding:2rem 2.5rem;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.1);"
         + "text-align:center;max-width:420px;width:90%}"
         + $"h1{{color:{color};margin-bottom:.5rem}}"
         + "p{color:#555;line-height:1.5}a{color:#2563eb}</style></head>"
         + $"<body><div class=\"card\"><h1>{heading}</h1><p>{message}</p>{extra}</div></body></html>";
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════════

public class User
{
    public int      Id                     { get; set; }
    public required string Name            { get; set; }
    public string?  Email                  { get; set; }
    public bool     IsEmailVerified        { get; set; } = false;
    public string?  EmailVerificationToken { get; set; }
    public string?  PasswordResetToken     { get; set; }
    public DateTime? PasswordResetExpiry   { get; set; }
    public int?     HouseholdId            { get; set; }
    public string   Role                   { get; set; } = "user"; // "user" | "admin"
    public int      FailedLoginAttempts    { get; set; } = 0;
    public DateTime? LockoutUntil         { get; set; }
    [JsonIgnore]
    public string?  PasswordHash           { get; set; }
}

public class Household
{
    public int      Id                { get; set; }
    public required string Name       { get; set; }
    public int      OwnerId           { get; set; }
    public string?  InviteCode        { get; set; }
    public DateTime? InviteCodeExpiry { get; set; }
}

public class Book
{
    public int    Id          { get; set; }
    public required string Baslik      { get; set; }
    public required string Yazar       { get; set; }
    public required string Isbn        { get; set; }
    public bool   IsAvailable { get; set; } = true;
    public int    HouseholdId { get; set; }
}

public class LibraryDb(DbContextOptions<LibraryDb> options) : DbContext(options)
{
    public DbSet<Book>      Books      => Set<Book>();
    public DbSet<User>      Users      => Set<User>();
    public DbSet<Household> Households => Set<Household>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Book>().HasIndex(b => new { b.HouseholdId, b.Isbn }).IsUnique();
        modelBuilder.Entity<User>().HasIndex(u => u.Name).IsUnique();
        modelBuilder.Entity<User>().HasIndex(u => u.Email).IsUnique()
            .HasFilter("\"Email\" IS NOT NULL");

        // User → Household FK; SET NULL when the household is deleted
        modelBuilder.Entity<User>()
            .HasOne<Household>()
            .WithMany()
            .HasForeignKey(u => u.HouseholdId)
            .IsRequired(false)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<Household>().HasIndex(h => h.InviteCode)
            .HasFilter("\"InviteCode\" IS NOT NULL");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

// Required user secrets:
//   Email:From          — sender address, e.g. noreply@yourdomain.com
//   Email:FromName      — display name, e.g. Family Library
//   Email:Smtp:Host     — SMTP host, e.g. smtp.gmail.com
//   Email:Smtp:Port     — SMTP port, e.g. 587
//   Email:Smtp:Username — SMTP login
//   Email:Smtp:Password — SMTP password or app password
//   App:BaseUrl         — public URL for verification links, e.g. https://xxxx.ngrok-free.app
public class EmailService(IConfiguration config)
{
    public async Task SendVerificationEmailAsync(string toEmail, string verificationUrl, string userName)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(
            config["Email:FromName"] ?? "Family Library",
            config["Email:From"]!));
        message.To.Add(new MailboxAddress(userName, toEmail));
        message.Subject = "Verify your Family Library account";

        var body = new BodyBuilder
        {
            HtmlBody =
                $"<p>Hi {System.Net.WebUtility.HtmlEncode(userName)},</p>"
              + "<p>Please verify your email address by clicking the link below:</p>"
              + $"<p><a href=\"{verificationUrl}\">Verify Email</a></p>"
              + "<p>If you didn't create this account, you can safely ignore this email.</p>"
              + "<p>— Family Library</p>",
        };
        message.Body = body.ToMessageBody();

        await Send(message, config);
    }

    public async Task SendPasswordResetEmailAsync(string toEmail, string resetUrl, string userName)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(
            config["Email:FromName"] ?? "Family Library",
            config["Email:From"]!));
        message.To.Add(new MailboxAddress(userName, toEmail));
        message.Subject = "Reset your Family Library password";

        var body = new BodyBuilder
        {
            HtmlBody =
                $"<p>Hi {System.Net.WebUtility.HtmlEncode(userName)},</p>"
              + "<p>You requested a password reset. Click the link below to set a new password. The link expires in 1 hour.</p>"
              + $"<p><a href=\"{resetUrl}\">Reset Password</a></p>"
              + "<p>If you didn't request this, you can safely ignore this email — your password won't change.</p>"
              + "<p>— Family Library</p>",
        };
        message.Body = body.ToMessageBody();

        await Send(message, config);
    }

    public async Task SendPasswordChangedEmailAsync(string toEmail, string userName)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(
            config["Email:FromName"] ?? "Family Library",
            config["Email:From"]!));
        message.To.Add(new MailboxAddress(userName, toEmail));
        message.Subject = "Your Family Library password was changed";

        var body = new BodyBuilder
        {
            HtmlBody =
                $"<p>Hi {System.Net.WebUtility.HtmlEncode(userName)},</p>"
              + "<p>Your password was just changed. If you did this, no action is needed.</p>"
              + "<p><strong>If you did not change your password</strong>, your account may be compromised. "
              + "Use \"Forgot password?\" immediately to regain access.</p>"
              + "<p>— Family Library</p>",
        };
        message.Body = body.ToMessageBody();

        await Send(message, config);
    }

    static async Task Send(MimeMessage message, IConfiguration config)
    {
        var port = int.TryParse(config["Email:Smtp:Port"], out var p) ? p : 587;
        using var smtp = new SmtpClient();
        await smtp.ConnectAsync(config["Email:Smtp:Host"]!, port, SecureSocketOptions.StartTls);
        await smtp.AuthenticateAsync(config["Email:Smtp:Username"]!, config["Email:Smtp:Password"]!);
        await smtp.SendAsync(message);
        await smtp.DisconnectAsync(true);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DTOs
// ═══════════════════════════════════════════════════════════════════════════════

record RegisterRequest(string Name, string Email, string Password);
record LoginRequest(string Name, string Password, bool RememberMe);
record ResendVerificationRequest(string Email);
record ForgotPasswordRequest(string Email);
record CreateHouseholdRequest(string Name);
record JoinHouseholdRequest(string Code);

record CreateUserRequest(string Name, string? Email, string? Password, string? Role);
record UpdateUserRequest(string Name, string? Role);

record OLBook(
    [property: JsonPropertyName("title")]   string?            Title,
    [property: JsonPropertyName("authors")] List<OLAuthorRef>? Authors
);
record OLAuthorRef([property: JsonPropertyName("key")] string? Key);
record OLAuthor([property: JsonPropertyName("name")]   string? Name);

public class LibraryDbContextFactory : Microsoft.EntityFrameworkCore.Design.IDesignTimeDbContextFactory<LibraryDb>
{
    public LibraryDb CreateDbContext(string[] args)
    {
        var connStr = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
                      ?? "Host=localhost;Database=library;Username=postgres;Password=postgres";
        var options = new DbContextOptionsBuilder<LibraryDb>()
            .UseNpgsql(connStr)
            .Options;
        return new LibraryDb(options);
    }
}
