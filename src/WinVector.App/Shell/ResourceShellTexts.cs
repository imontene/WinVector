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

    public string ProtocolMismatch(int engineProtocol, int appProtocol) => Format("EngineProtocolMismatch", engineProtocol, appProtocol);

    public string FileError(FileErrorKind kind, string fileName) => Format($"FileError{kind}", fileName);

    public string InvalidSvg(string fileName, string detail) => Format("FileErrorInvalidSvg", fileName, detail);

    public string EngineUnavailable(string fileName) => Format("FileErrorEngineUnavailable", fileName);

    public string Format(string resource, params object[] values) =>
        string.Format(CultureInfo.CurrentCulture, resources.GetString(resource), values);
}
