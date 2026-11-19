namespace WinVector.Core.Shell;

/// <summary>Respuesta a "¿Guardar los cambios?".</summary>
public enum UnsavedChangesChoice
{
    Save,
    DontSave,
    Cancel,
}

/// <summary>Unidad de las medidas de un documento nuevo.</summary>
public enum LengthUnit
{
    Pixels,
    Millimeters,
    Inches,
}

/// <summary>Tamaño de la mesa de trabajo de un documento nuevo.</summary>
public sealed record DocumentSize(double Width, double Height, LengthUnit Unit)
{
    public static DocumentSize Default { get; } = new(DocumentTemplates.DefaultWidth, DocumentTemplates.DefaultHeight, LengthUnit.Pixels);
}

/// <summary>
/// Diálogos que el modelo de vista necesita pedir a la interfaz. La aplicación los implementa con
/// WinUI; las pruebas, con respuestas preparadas.
/// </summary>
public interface IShellDialogs
{
    /// <summary>Pide un archivo SVG para abrir. Devuelve null si el usuario cancela.</summary>
    Task<string?> PickFileToOpenAsync();

    /// <summary>Pide dónde guardar, proponiendo un nombre. Devuelve null si el usuario cancela.</summary>
    Task<string?> PickFileToSaveAsync(string suggestedFileName);

    /// <summary>Pregunta si guardar los cambios de un documento antes de cerrarlo.</summary>
    Task<UnsavedChangesChoice> AskToSaveChangesAsync(string documentName);

    /// <summary>Pide el tamaño de un documento nuevo. Devuelve null si el usuario cancela.</summary>
    Task<DocumentSize?> AskNewDocumentSizeAsync();

    /// <summary>Muestra un error al usuario.</summary>
    Task ShowErrorAsync(string title, string message);
}
