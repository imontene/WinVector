using WinVector.Core.Files;

namespace WinVector.Core.Shell;

/// <summary>
/// Textos localizados que necesitan los modelos de vista. Los proporciona la interfaz para que este
/// proyecto no dependa de los recursos de Windows.
/// </summary>
public interface IShellTexts
{
    /// <summary>Título de un documento nuevo a partir de su número ("Sin título 2").</summary>
    string UntitledDocument(int number);

    /// <summary>Resumen de una selección de varios objetos ("3 objetos").</summary>
    string MultipleSelection(int count);

    /// <summary>Aviso de motor incompatible, con la versión del protocolo del motor y la de la aplicación.</summary>
    string ProtocolMismatch(int engineProtocol, int appProtocol);

    /// <summary>Título del aviso cuando no se puede abrir un archivo.</summary>
    string OpenFailedTitle { get; }

    /// <summary>Título del aviso cuando no se puede guardar un archivo.</summary>
    string SaveFailedTitle { get; }

    /// <summary>Explicación de un error de archivo, por ejemplo "No se encuentra dibujo.svg…".</summary>
    string FileError(FileErrorKind kind, string fileName);

    /// <summary>Explicación de un SVG que no se puede abrir; <paramref name="detail"/> incluye la línea y la columna.</summary>
    string InvalidSvg(string fileName, string detail);

    /// <summary>Explicación de un fallo del motor al guardar.</summary>
    string EngineUnavailable(string fileName);

    /// <summary>
    /// Texto de la orden de deshacer con la acción que se desharía ("Deshacer mover"). Con una acción
    /// null o desconocida, el texto genérico ("Deshacer").
    /// </summary>
    string UndoCommand(string? action);

    /// <summary>Texto de la orden de rehacer con la acción que se reharía ("Rehacer mover").</summary>
    string RedoCommand(string? action);
}
