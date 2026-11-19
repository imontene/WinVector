using System.Globalization;
using Microsoft.Windows.ApplicationModel.Resources;
using WinVector.Core.Files;
using WinVector.Core.Shell;

namespace WinVector.App.Shell;

/// <summary>Textos de los modelos de vista, tomados de Strings/&lt;idioma&gt;/Resources.resw.</summary>
internal sealed class ResourceShellTexts(ResourceLoader resources) : IShellTexts
{
    public string OpenFailedTitle => resources.GetString("OpenFailedTitle");

    public string SaveFailedTitle => resources.GetString("SaveFailedTitle");

    public string UntitledDocument(int number) => Format("UntitledDocument", number);

    public string MultipleSelection(int count) => Format("SelectionMultiple", count);

    public string SelectionInGroup(string selection, string group) =>
        selection.Length == 0 ? Format("SelectionInsideGroup", group) : Format("SelectionInGroup", selection, group);

    public string ProtocolMismatch(int engineProtocol, int appProtocol) => Format("EngineProtocolMismatch", engineProtocol, appProtocol);

    public string FileError(FileErrorKind kind, string fileName) => Format($"FileError{kind}", fileName);

    public string InvalidSvg(string fileName, string detail) => Format("FileErrorInvalidSvg", fileName, detail);

    public string EngineUnavailable(string fileName) => Format("FileErrorEngineUnavailable", fileName);

    public string ZoomPercent(double zoom) => Format("ZoomPercent", Math.Round(zoom * 100, zoom < 0.1 ? 1 : 0));

    public string UndoCommand(string? action) => HistoryCommand("UndoCommand", action);

    public string RedoCommand(string? action) => HistoryCommand("RedoCommand", action);

    /// <summary>
    /// "Deshacer" o "Deshacer edición". Las acciones del motor (move, edit…) se traducen con los
    /// recursos HistoryAction&lt;Acción&gt;; una acción sin traducción usa el texto genérico.
    /// </summary>
    private string HistoryCommand(string resource, string? action)
    {
        var name = action is null ? string.Empty : TryGetString($"HistoryAction{ToPascalCase(action)}");
        return name.Length == 0 ? resources.GetString(resource) : Format($"{resource}Action", name);
    }

    private string TryGetString(string resource)
    {
        try
        {
            return resources.GetString(resource);
        }
        catch (Exception ex) when (ex is ArgumentException or System.Runtime.InteropServices.COMException)
        {
            return string.Empty;
        }
    }

    private static string ToPascalCase(string action) =>
        string.Concat(action.Split('-', StringSplitOptions.RemoveEmptyEntries).Select(part => char.ToUpperInvariant(part[0]) + part[1..]));

    public string Format(string resource, params object[] values) =>
        string.Format(CultureInfo.CurrentCulture, resources.GetString(resource), values);
}
