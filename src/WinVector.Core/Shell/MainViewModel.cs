using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace WinVector.Core.Shell;

/// <summary>
/// Estado de la ventana principal: pestañas de documento abiertas y la pestaña activa.
/// </summary>
public sealed partial class MainViewModel : ObservableObject
{
    private readonly Func<int, string> _untitledTitle;
    private int _untitledCount;

    /// <param name="untitledTitle">
    /// Devuelve el título localizado de un documento nuevo a partir de su número, por ejemplo
    /// "Sin título 2". La interfaz lo proporciona para que este proyecto no dependa de los recursos
    /// de Windows.
    /// </param>
    public MainViewModel(Func<int, string> untitledTitle)
    {
        ArgumentNullException.ThrowIfNull(untitledTitle);
        _untitledTitle = untitledTitle;
        NewDocument();
    }

    /// <summary>Pestañas abiertas, en el orden en que se muestran.</summary>
    public ObservableCollection<DocumentTabViewModel> Documents { get; } = [];

    /// <summary>Pestaña activa. Nunca es null mientras haya pestañas abiertas.</summary>
    [ObservableProperty]
    private DocumentTabViewModel? _selectedDocument;

    /// <summary>Abre un documento nuevo vacío y lo activa.</summary>
    [RelayCommand]
    public void NewDocument()
    {
        _untitledCount++;
        var document = new DocumentTabViewModel(_untitledTitle(_untitledCount));
        Documents.Add(document);
        SelectedDocument = document;
    }

    /// <summary>
    /// Cierra una pestaña. Si era la activa, se activa la vecina; si era la última, se abre un
    /// documento nuevo para que la ventana nunca quede vacía.
    /// </summary>
    [RelayCommand]
    public void CloseDocument(DocumentTabViewModel? document)
    {
        if (document is null)
        {
            return;
        }

        var index = Documents.IndexOf(document);
        if (index < 0)
        {
            return;
        }

        var wasSelected = ReferenceEquals(document, SelectedDocument);
        Documents.RemoveAt(index);

        if (Documents.Count == 0)
        {
            NewDocument();
        }
        else if (wasSelected)
        {
            SelectedDocument = Documents[Math.Min(index, Documents.Count - 1)];
        }
    }
}
