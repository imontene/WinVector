using WinVector.Core.Bridge;
using WinVector.Core.Files;
using WinVector.Core.Shell;

namespace WinVector.Core.Tests.Shell;

/// <summary>Textos simples para las pruebas.</summary>
internal sealed class TestTexts : IShellTexts
{
    public static readonly TestTexts Instance = new();

    public string OpenFailedTitle => "No se pudo abrir";

    public string SaveFailedTitle => "No se pudo guardar";

    public string EngineFailedTitle => "El lienzo dejó de funcionar";

    public string EngineReloaded => "Recargado";

    public string EngineRestartNeeded => "Reinicia";

    public string UntitledDocument(int number) => $"Sin título {number}";

    public string MultipleSelection(int count) => $"{count} objetos";

    public string SelectionInGroup(string selection, string group) =>
        selection.Length == 0 ? $"En {group}" : $"{selection} en {group}";

    public string ProtocolMismatch(int engineProtocol, int appProtocol) => $"Protocolo {engineProtocol}, se esperaba {appProtocol}";

    public string FileError(FileErrorKind kind, string fileName) => $"{kind}: {fileName}";

    public string InvalidSvg(string fileName, string detail) => $"SVG no válido en {fileName}: {detail}";

    public string EngineUnavailable(string fileName) => $"Motor no disponible: {fileName}";

    public string UndoCommand(string? action) => action is null ? "Deshacer" : $"Deshacer {action}";

    public string RedoCommand(string? action) => action is null ? "Rehacer" : $"Rehacer {action}";

    public string ZoomPercent(double zoom) => $"{Math.Round(zoom * 100)} %";

    /// <summary>Algunos nombres en español, con tildes, para probar la búsqueda; el resto, el identificador.</summary>
    public string CommandName(string id) => id switch
    {
        "undo" => "Deshacer",
        "redo" => "Rehacer",
        "group" => "Agrupar",
        "ungroup" => "Desagrupar",
        "zoom-fit" => "Ajustar a la ventana",
        "tool-hand" => "Herramienta Mano",
        "duplicate" => "Duplicar selección",
        _ => id,
    };

    public string CommandShortcut(string id) => id == "undo" ? "Ctrl+Z" : string.Empty;

    public string ShapeName(ShapeType type) => type.ToString();

    public string ShapeField(string key) => key;

    public string ShapeConverted(ShapeType from) => $"{from} → polígono";

    public string SelectedNodes(int count, NodeKind? kind) => kind is null ? $"{count} nodos" : $"{count} nodos · {kind}";
}

/// <summary>Diálogos con respuestas preparadas que anotan lo que se les pregunta.</summary>
internal sealed class FakeDialogs : IShellDialogs
{
    public Queue<string?> OpenPaths { get; } = new();

    public Queue<string?> SavePaths { get; } = new();

    public Queue<UnsavedChangesChoice> SaveChangesAnswers { get; } = new();

    public DocumentSize? NewDocumentSize { get; set; }

    public List<string> Calls { get; } = [];

    public List<(string Title, string Message)> Errors { get; } = [];

    public Task<string?> PickFileToOpenAsync()
    {
        Calls.Add("abrir");
        return Task.FromResult(OpenPaths.Count > 0 ? OpenPaths.Dequeue() : null);
    }

    public Task<string?> PickFileToSaveAsync(string suggestedFileName)
    {
        Calls.Add($"guardar como {suggestedFileName}");
        return Task.FromResult(SavePaths.Count > 0 ? SavePaths.Dequeue() : null);
    }

    public Task<UnsavedChangesChoice> AskToSaveChangesAsync(string documentName)
    {
        Calls.Add($"¿guardar {documentName}?");
        return Task.FromResult(SaveChangesAnswers.Count > 0 ? SaveChangesAnswers.Dequeue() : UnsavedChangesChoice.Cancel);
    }

    public Task<DocumentSize?> AskNewDocumentSizeAsync()
    {
        Calls.Add("tamaño");
        return Task.FromResult(NewDocumentSize);
    }

    public Task ShowErrorAsync(string title, string message)
    {
        Errors.Add((title, message));
        return Task.CompletedTask;
    }

    /// <summary>Respuesta a la pregunta de recuperar documentos.</summary>
    public bool RecoverAnswer { get; set; } = true;

    public Task<bool> AskToRecoverAsync(IReadOnlyList<string> documentNames)
    {
        Calls.Add($"¿recuperar {string.Join(", ", documentNames)}?");
        return Task.FromResult(RecoverAnswer);
    }
}

/// <summary>Portapapeles en memoria que anota lo que se escribe.</summary>
internal sealed class FakeClipboard : IShellClipboard
{
    public string? Svg { get; set; }

    public int Writes { get; private set; }

    public Task SetSvgAsync(string svg)
    {
        Svg = svg;
        Writes++;
        return Task.CompletedTask;
    }

    public Task<string?> GetSvgAsync() => Task.FromResult(Svg);
}
