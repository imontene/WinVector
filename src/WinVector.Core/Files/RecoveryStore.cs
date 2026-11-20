using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace WinVector.Core.Files;

/// <summary>Un documento que se puede recuperar de una sesión que terminó de forma inesperada.</summary>
/// <param name="Title">Nombre de la pestaña.</param>
/// <param name="FilePath">Archivo del que venía, o null si no se había guardado nunca.</param>
/// <param name="Encoding">Codificación del archivo, para guardarlo igual.</param>
/// <param name="Svg">Texto del documento en la última copia de recuperación.</param>
/// <param name="SavedAt">Cuándo se hizo esa copia.</param>
public sealed record RecoveredDocument(string Title, string? FilePath, FileEncoding Encoding, string Svg, DateTimeOffset SavedAt);

/// <summary>
/// Copias de recuperación de los documentos con cambios, para que un cierre inesperado no haga perder
/// el trabajo (issue #24).
/// </summary>
/// <remarks>
/// Cada ejecución de la aplicación tiene su carpeta de sesión, con un archivo de bloqueo que mantiene
/// abierto mientras dura. Al arrancar, solo se ofrecen las sesiones cuyo bloqueo está libre: las de
/// procesos que ya no existen, no las de otra ventana de WinVector abierta. Al cerrar bien la
/// aplicación, su carpeta se borra.
/// </remarks>
public sealed class RecoveryStore : IDisposable
{
    private const string SessionsFolder = "sesiones";
    private const string LockFile = "sesion.bloqueo";
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private readonly string _root;
    private readonly TimeProvider _time;
    private readonly SemaphoreSlim _writing = new(1, 1);
    private FileStream? _lock;

    /// <param name="root">Carpeta de las copias de recuperación (dentro de los datos locales de la aplicación).</param>
    public RecoveryStore(string root, TimeProvider? timeProvider = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(root);
        _root = root;
        _time = timeProvider ?? TimeProvider.System;
    }

    /// <summary>Carpeta de la sesión actual, o null antes de <see cref="StartSession"/>.</summary>
    public string? SessionFolder { get; private set; }

    /// <summary>Crea la carpeta de esta sesión y la bloquea mientras la aplicación esté abierta.</summary>
    public void StartSession()
    {
        if (SessionFolder is not null)
        {
            return;
        }

        var folder = Path.Combine(_root, SessionsFolder, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        _lock = new FileStream(Path.Combine(folder, LockFile), FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
        SessionFolder = folder;
    }

    /// <summary>Guarda (o sustituye) la copia de recuperación de un documento.</summary>
    /// <param name="key">Identificador del documento dentro de la sesión.</param>
    public async Task SaveAsync(string key, string title, string? filePath, FileEncoding encoding, string svg, CancellationToken cancellationToken = default)
    {
        var folder = SessionFolder ?? throw new InvalidOperationException("La sesión de recuperación no ha empezado.");
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        var metadata = new Metadata(title, filePath, encoding.Encoding.WebName, encoding.HasByteOrderMark, _time.GetUtcNow());
        await _writing.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            // Primero el texto y después los datos: una copia sin datos no se ofrece.
            await WriteAtomicAsync(Path.Combine(folder, $"{key}.svg"), svg, cancellationToken).ConfigureAwait(false);
            await WriteAtomicAsync(Path.Combine(folder, $"{key}.json"), JsonSerializer.Serialize(metadata, JsonOptions), cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _writing.Release();
        }
    }

    /// <summary>Borra la copia de un documento (al guardarlo o al descartar sus cambios).</summary>
    public void Delete(string key)
    {
        if (SessionFolder is not { } folder)
        {
            return;
        }

        foreach (var extension in (string[])[".json", ".svg"])
        {
            TryDelete(Path.Combine(folder, key + extension));
        }
    }

    /// <summary>
    /// Documentos de sesiones que terminaron de forma inesperada: las carpetas de sesión cuyo bloqueo
    /// está libre, sin contar la actual.
    /// </summary>
    public IReadOnlyList<RecoveredDocument> FindOrphans()
    {
        var result = new List<RecoveredDocument>();
        foreach (var folder in OrphanFolders())
        {
            foreach (var json in Directory.EnumerateFiles(folder, "*.json"))
            {
                if (Read(json) is { } document)
                {
                    result.Add(document);
                }
            }
        }

        return result.OrderBy(document => document.SavedAt).ToList();
    }

    /// <summary>Borra las sesiones que terminaron de forma inesperada (después de recuperarlas o de rechazarlas).</summary>
    public void DiscardOrphans()
    {
        foreach (var folder in OrphanFolders())
        {
            TryDeleteFolder(folder);
        }
    }

    /// <summary>Cierre normal: borra la carpeta de esta sesión.</summary>
    public void EndSession()
    {
        _lock?.Dispose();
        _lock = null;
        if (SessionFolder is { } folder)
        {
            TryDeleteFolder(folder);
        }

        SessionFolder = null;
    }

    public void Dispose()
    {
        _lock?.Dispose();
        _lock = null;
        _writing.Dispose();
    }

    private List<string> OrphanFolders()
    {
        var sessions = Path.Combine(_root, SessionsFolder);
        if (!Directory.Exists(sessions))
        {
            return [];
        }

        return Directory.EnumerateDirectories(sessions)
            .Where(folder => !string.Equals(folder, SessionFolder, StringComparison.OrdinalIgnoreCase) && !IsLocked(folder))
            .ToList();
    }

    /// <summary>True si otra ejecución de la aplicación tiene abierta esa sesión.</summary>
    private static bool IsLocked(string folder)
    {
        var path = Path.Combine(folder, LockFile);
        if (!File.Exists(path))
        {
            return false;
        }

        try
        {
            using var probe = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            return false;
        }
        catch (IOException)
        {
            return true;
        }
    }

    private static RecoveredDocument? Read(string jsonPath)
    {
        try
        {
            var metadata = JsonSerializer.Deserialize<Metadata>(File.ReadAllText(jsonPath), JsonOptions);
            var svgPath = Path.ChangeExtension(jsonPath, ".svg");
            if (metadata is null || !File.Exists(svgPath))
            {
                return null;
            }

            var encoding = new FileEncoding(Encoding.GetEncoding(metadata.Encoding), metadata.ByteOrderMark);
            return new RecoveredDocument(metadata.Title, metadata.FilePath, encoding, File.ReadAllText(svgPath, Encoding.UTF8), metadata.SavedAt);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        {
            // Una copia dañada no impide recuperar las demás.
            return null;
        }
    }

    private static async Task WriteAtomicAsync(string path, string text, CancellationToken cancellationToken)
    {
        var temporary = path + ".tmp";
        await File.WriteAllTextAsync(temporary, text, new UTF8Encoding(false), cancellationToken).ConfigureAwait(false);
        File.Move(temporary, path, overwrite: true);
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Se intentará otra vez al cerrar la sesión.
        }
    }

    private static void TryDeleteFolder(string folder)
    {
        try
        {
            Directory.Delete(folder, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Una carpeta que no se puede borrar ahora se borrará en otra ocasión.
        }
    }

    private sealed record Metadata(
        [property: JsonPropertyName("title")] string Title,
        [property: JsonPropertyName("filePath")] string? FilePath,
        [property: JsonPropertyName("encoding")] string Encoding,
        [property: JsonPropertyName("byteOrderMark")] bool ByteOrderMark,
        [property: JsonPropertyName("savedAt")] DateTimeOffset SavedAt);
}
