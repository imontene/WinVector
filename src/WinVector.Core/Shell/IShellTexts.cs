using WinVector.Core.Bridge;
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

    /// <summary>
    /// Resumen de la selección dentro del grupo en el que ha entrado el usuario ("circle#sol en
    /// g#fondo"). <paramref name="selection"/> está vacío si no hay nada seleccionado ("En g#fondo").
    /// </summary>
    string SelectionInGroup(string selection, string group);

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

    /// <summary>Zoom para la barra de estado ("150 %"); 1 es el 100 %.</summary>
    string ZoomPercent(double zoom);

    /// <summary>Título del aviso cuando el lienzo deja de funcionar.</summary>
    string EngineFailedTitle { get; }

    /// <summary>Aviso cuando el lienzo deja de funcionar y se recarga desde las copias de recuperación.</summary>
    string EngineReloaded { get; }

    /// <summary>Aviso cuando el lienzo deja de funcionar y no se puede recargar: hay que reiniciar.</summary>
    string EngineRestartNeeded { get; }

    /// <summary>Nombre de una orden para la paleta de comandos ("Deshacer"), por su identificador ("undo").</summary>
    string CommandName(string id);

    /// <summary>Atajo de una orden para la paleta de comandos ("Ctrl+Z"), o vacío si no tiene.</summary>
    string CommandShortcut(string id);

    /// <summary>Nombre de un tipo de forma para el panel de propiedades ("Rectángulo").</summary>
    string ShapeName(ShapeType type);

    /// <summary>Aviso cuando una forma pasa a ser un polígono normal al editar sus vértices.</summary>
    string ShapeConverted(ShapeType from);

    /// <summary>Etiqueta de un campo de la forma ("Radio de las esquinas"), por su identificador ("cornerRadius").</summary>
    string ShapeField(string key);
}
