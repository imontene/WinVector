using System.Text;
using System.Text.RegularExpressions;

namespace WinVector.Core.Files;

/// <summary>Por qué falló una operación con un archivo.</summary>
public enum FileErrorKind
{
    /// <summary>El archivo o su carpeta no existen.</summary>
    NotFound,

    /// <summary>No hay permiso para leer o escribir el archivo.</summary>
    AccessDenied,

    /// <summary>Otra aplicación tiene el archivo abierto o bloqueado.</summary>
    InUse,

    /// <summary>El contenido no está en la codificación que declara o no es texto.</summary>
    InvalidEncoding,

    /// <summary>Cualquier otro error de entrada y salida, como un disco lleno.</summary>
    Other,
}

/// <summary>Error de lectura o escritura de un archivo, con su categoría.</summary>
public sealed class FileOperationException : Exception
{
    public FileOperationException()
        : this(FileErrorKind.Other, string.Empty, "Error de archivo.")
    {
    }

    public FileOperationException(string message)
        : this(FileErrorKind.Other, string.Empty, message)
    {
    }

    public FileOperationException(string message, Exception innerException)
        : this(FileErrorKind.Other, string.Empty, message, innerException)
    {
    }

    public FileOperationException(FileErrorKind kind, string path, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Kind = kind;
        Path = path;
    }

    public FileErrorKind Kind { get; }

    public string Path { get; }
}

/// <summary>Codificación de un archivo, para guardarlo igual que se leyó.</summary>
/// <param name="Encoding">Codificación del texto.</param>
/// <param name="HasByteOrderMark">True si el archivo empezaba con una marca BOM.</param>
public sealed record FileEncoding(Encoding Encoding, bool HasByteOrderMark)
{
    /// <summary>UTF-8 sin BOM, la codificación de los documentos nuevos.</summary>
    public static FileEncoding Utf8 { get; } = new(new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), false);
}

/// <summary>Contenido de un archivo SVG leído y su codificación.</summary>
public sealed record SvgFileContent(string Text, FileEncoding Encoding);

/// <summary>
/// Lee y escribe archivos SVG conservando su codificación y su marca BOM, para que un archivo que
/// no se ha modificado se guarde con los mismos bytes.
/// </summary>
public static partial class SvgFile
{
    static SvgFile()
    {
        // Codificaciones como windows-1252 o ISO-8859-15, que declaran algunos SVG antiguos.
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    /// <exception cref="FileOperationException">No se pudo leer el archivo o decodificar su texto.</exception>
    public static async Task<SvgFileContent> ReadAsync(string path, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var bytes = await Run(path, () => File.ReadAllBytesAsync(path, cancellationToken)).ConfigureAwait(false);
        return Decode(bytes, path);
    }

    /// <summary>
    /// Escribe el archivo de forma segura: primero en un archivo temporal de la misma carpeta y
    /// después lo sustituye. Si algo falla, el archivo original queda intacto.
    /// </summary>
    /// <exception cref="FileOperationException">No se pudo escribir el archivo.</exception>
    public static async Task WriteAsync(string path, string text, FileEncoding encoding, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        ArgumentNullException.ThrowIfNull(text);
        ArgumentNullException.ThrowIfNull(encoding);

        var full = System.IO.Path.GetFullPath(path);
        var directory = System.IO.Path.GetDirectoryName(full) ?? ".";
        var temporary = System.IO.Path.Combine(directory, $".{System.IO.Path.GetFileName(full)}.{Guid.NewGuid():N}.winvector-tmp");

        byte[] bytes;
        try
        {
            bytes = Encode(text, encoding);
        }
        catch (EncoderFallbackException ex)
        {
            throw new FileOperationException(
                FileErrorKind.InvalidEncoding,
                full,
                $"El documento tiene caracteres que no se pueden guardar en {encoding.Encoding.WebName}.",
                ex);
        }

        await Run(full, async () =>
        {
            try
            {
                await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
                {
                    await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                    await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                    stream.Flush(flushToDisk: true);
                }

                if (File.Exists(full))
                {
                    File.Replace(temporary, full, destinationBackupFileName: null, ignoreMetadataErrors: true);
                }
                else
                {
                    File.Move(temporary, full);
                }
            }
            finally
            {
                if (File.Exists(temporary))
                {
                    File.Delete(temporary);
                }
            }

            return true;
        }).ConfigureAwait(false);
    }

    /// <summary>Decodifica según la marca BOM o, si no hay, según la declaración XML (UTF-8 por omisión).</summary>
    internal static SvgFileContent Decode(byte[] bytes, string path)
    {
        var (bomEncoding, bomLength) = DetectByteOrderMark(bytes);
        Encoding encoding;
        if (bomEncoding is not null)
        {
            encoding = bomEncoding;
        }
        else
        {
            var declared = DeclaredEncoding(bytes);
            try
            {
                encoding = declared is null || declared.Equals("utf-8", StringComparison.OrdinalIgnoreCase)
                    ? new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)
                    : Encoding.GetEncoding(declared);
            }
            catch (ArgumentException ex)
            {
                throw new FileOperationException(FileErrorKind.InvalidEncoding, path, $"El archivo declara una codificación desconocida: {declared}.", ex);
            }
        }

        var strict = (Encoding)encoding.Clone();
        strict.DecoderFallback = DecoderFallback.ExceptionFallback;
        strict.EncoderFallback = EncoderFallback.ExceptionFallback;
        try
        {
            var text = strict.GetString(bytes, bomLength, bytes.Length - bomLength);
            return new SvgFileContent(text, new FileEncoding(strict, bomLength > 0));
        }
        catch (DecoderFallbackException ex)
        {
            throw new FileOperationException(
                FileErrorKind.InvalidEncoding,
                path,
                $"El archivo no es texto válido en la codificación {encoding.WebName}.",
                ex);
        }
    }

    internal static byte[] Encode(string text, FileEncoding encoding)
    {
        var body = encoding.Encoding.GetBytes(text);
        if (!encoding.HasByteOrderMark)
        {
            return body;
        }

        var bom = encoding.Encoding.Preamble.ToArray();
        if (bom.Length == 0)
        {
            bom = encoding.Encoding.CodePage switch
            {
                65001 => [0xEF, 0xBB, 0xBF],
                1200 => [0xFF, 0xFE],
                1201 => [0xFE, 0xFF],
                _ => [],
            };
        }

        return [.. bom, .. body];
    }

    private static (Encoding? Encoding, int Length) DetectByteOrderMark(byte[] bytes) => bytes switch
    {
        [0xEF, 0xBB, 0xBF, ..] => (new UTF8Encoding(encoderShouldEmitUTF8Identifier: true), 3),
        [0xFF, 0xFE, ..] => (new UnicodeEncoding(bigEndian: false, byteOrderMark: true), 2),
        [0xFE, 0xFF, ..] => (new UnicodeEncoding(bigEndian: true, byteOrderMark: true), 2),
        _ => (null, 0),
    };

    /// <summary>El valor de encoding="…" de la declaración XML, si existe.</summary>
    private static string? DeclaredEncoding(byte[] bytes)
    {
        // La declaración usa solo caracteres ASCII y va al principio del archivo.
        var head = Encoding.ASCII.GetString(bytes, 0, Math.Min(bytes.Length, 200));
        var match = XmlDeclarationEncoding().Match(head);
        return match.Success ? match.Groups["encoding"].Value : null;
    }

    [GeneratedRegex("""^\s*<\?xml[^>]*?encoding\s*=\s*["'](?<encoding>[A-Za-z0-9._-]+)["']""", RegexOptions.CultureInvariant)]
    private static partial Regex XmlDeclarationEncoding();

    /// <summary>Ejecuta una operación de archivo y traduce sus excepciones a <see cref="FileOperationException"/>.</summary>
    private static async Task<T> Run<T>(string path, Func<Task<T>> operation)
    {
        try
        {
            return await operation().ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
            throw new FileOperationException(FileErrorKind.NotFound, path, ex.Message, ex);
        }
        catch (UnauthorizedAccessException ex)
        {
            throw new FileOperationException(FileErrorKind.AccessDenied, path, ex.Message, ex);
        }
        catch (IOException ex) when (IsSharingViolation(ex))
        {
            throw new FileOperationException(FileErrorKind.InUse, path, ex.Message, ex);
        }
        catch (IOException ex)
        {
            throw new FileOperationException(FileErrorKind.Other, path, ex.Message, ex);
        }
    }

    /// <summary>ERROR_SHARING_VIOLATION (32) o ERROR_LOCK_VIOLATION (33) de Windows.</summary>
    private static bool IsSharingViolation(IOException ex) => (ex.HResult & 0xFFFF) is 32 or 33;
}
