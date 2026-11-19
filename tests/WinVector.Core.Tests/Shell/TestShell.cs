using WinVector.Core.Files;
using WinVector.Core.Shell;

namespace WinVector.Core.Tests.Shell;

/// <summary>Textos simples para las pruebas.</summary>
internal sealed class TestTexts : IShellTexts
{
    public static readonly TestTexts Instance = new();

    public string OpenFailedTitle => "No se pudo abrir";

    public string SaveFailedTitle => "No se pudo guardar";

    public string UntitledDocument(int number) => $"Sin título {number}";

    public string MultipleSelection(int count) => $"{count} objetos";

    public string ProtocolMismatch(int engineProtocol, int appProtocol) => $"Protocolo {engineProtocol}, se esperaba {appProtocol}";

    public string FileError(FileErrorKind kind, string fileName) => $"{kind}: {fileName}";

    public string InvalidSvg(string fileName, string detail) => $"SVG no válido en {fileName}: {detail}";

    public string EngineUnavailable(string fileName) => $"Motor no disponible: {fileName}";
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
}
