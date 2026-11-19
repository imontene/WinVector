using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Windows.ApplicationModel.Resources;
using Windows.Storage.Pickers;
using WinVector.Core.Shell;

namespace WinVector.App.Shell;

/// <summary>
/// Diálogos del modelo de vista con los controles de WinUI y los selectores de archivos de Windows.
/// </summary>
/// <remarks>
/// WinUI solo permite un ContentDialog abierto a la vez: los diálogos se muestran de uno en uno.
/// </remarks>
internal sealed class WinUIShellDialogs(Window window, ResourceLoader resources) : IShellDialogs, IDisposable
{
    private readonly SemaphoreSlim _oneDialogAtATime = new(1, 1);

    /// <summary>Tamaños predefinidos para un documento nuevo.</summary>
    private static readonly (string Resource, DocumentSize Size)[] Presets =
    [
        ("NewSizePresetDefault", DocumentSize.Default),
        ("NewSizePresetA4Portrait", new DocumentSize(210, 297, LengthUnit.Millimeters)),
        ("NewSizePresetA4Landscape", new DocumentSize(297, 210, LengthUnit.Millimeters)),
        ("NewSizePresetA5", new DocumentSize(148, 210, LengthUnit.Millimeters)),
        ("NewSizePresetLetter", new DocumentSize(8.5, 11, LengthUnit.Inches)),
        ("NewSizePresetFullHd", new DocumentSize(1920, 1080, LengthUnit.Pixels)),
        ("NewSizePresetSquare", new DocumentSize(1080, 1080, LengthUnit.Pixels)),
        ("NewSizePresetIcon", new DocumentSize(256, 256, LengthUnit.Pixels)),
    ];

    public void Dispose() => _oneDialogAtATime.Dispose();

    public async Task<string?> PickFileToOpenAsync()
    {
        var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.PicturesLibrary };
        picker.FileTypeFilter.Add(".svg");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(window));
        var file = await picker.PickSingleFileAsync();
        return file?.Path;
    }

    public async Task<string?> PickFileToSaveAsync(string suggestedFileName)
    {
        var picker = new FileSavePicker
        {
            SuggestedStartLocation = PickerLocationId.PicturesLibrary,
            SuggestedFileName = Path.GetFileNameWithoutExtension(suggestedFileName),
            DefaultFileExtension = ".svg",
        };
        picker.FileTypeChoices.Add(resources.GetString("FileTypeSvg"), [".svg"]);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(window));
        var file = await picker.PickSaveFileAsync();
        return file?.Path;
    }

    public async Task<UnsavedChangesChoice> AskToSaveChangesAsync(string documentName)
    {
        var dialog = CreateDialog(
            string.Format(CultureInfo.CurrentCulture, resources.GetString("SaveChangesTitle"), documentName),
            resources.GetString("SaveChangesBody"));
        dialog.PrimaryButtonText = resources.GetString("SaveChangesSave");
        dialog.SecondaryButtonText = resources.GetString("SaveChangesDontSave");
        dialog.CloseButtonText = resources.GetString("DialogCancel");
        dialog.DefaultButton = ContentDialogButton.Primary;

        return await ShowAsync(dialog) switch
        {
            ContentDialogResult.Primary => UnsavedChangesChoice.Save,
            ContentDialogResult.Secondary => UnsavedChangesChoice.DontSave,
            _ => UnsavedChangesChoice.Cancel,
        };
    }

    public async Task<DocumentSize?> AskNewDocumentSizeAsync()
    {
        var presets = new ComboBox { Header = resources.GetString("NewSizePreset"), HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var (resource, _) in Presets)
        {
            presets.Items.Add(resources.GetString(resource));
        }

        presets.Items.Add(resources.GetString("NewSizePresetCustom"));
        var width = new NumberBox { Header = resources.GetString("NewSizeWidth"), Minimum = 0.001, SmallChange = 1, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact };
        var height = new NumberBox { Header = resources.GetString("NewSizeHeight"), Minimum = 0.001, SmallChange = 1, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact };
        var unit = new ComboBox { Header = resources.GetString("NewSizeUnit"), HorizontalAlignment = HorizontalAlignment.Stretch };
        unit.Items.Add(resources.GetString("UnitPixels"));
        unit.Items.Add(resources.GetString("UnitMillimeters"));
        unit.Items.Add(resources.GetString("UnitInches"));

        var applyingPreset = false;
        void Apply(DocumentSize size)
        {
            applyingPreset = true;
            width.Value = size.Width;
            height.Value = size.Height;
            unit.SelectedIndex = (int)size.Unit;
            applyingPreset = false;
        }

        presets.SelectionChanged += (_, _) =>
        {
            if (presets.SelectedIndex >= 0 && presets.SelectedIndex < Presets.Length)
            {
                Apply(Presets[presets.SelectedIndex].Size);
            }
        };
        void MarkCustom()
        {
            if (!applyingPreset)
            {
                presets.SelectedIndex = Presets.Length;
            }
        }

        width.ValueChanged += (_, _) => MarkCustom();
        height.ValueChanged += (_, _) => MarkCustom();
        unit.SelectionChanged += (_, _) => MarkCustom();
        presets.SelectedIndex = 0;

        var dimensions = new Grid { ColumnSpacing = 12 };
        dimensions.ColumnDefinitions.Add(new ColumnDefinition());
        dimensions.ColumnDefinitions.Add(new ColumnDefinition());
        dimensions.ColumnDefinitions.Add(new ColumnDefinition());
        Grid.SetColumn(height, 1);
        Grid.SetColumn(unit, 2);
        dimensions.Children.Add(width);
        dimensions.Children.Add(height);
        dimensions.Children.Add(unit);

        var dialog = CreateDialog(resources.GetString("NewSizeTitle"), new StackPanel { Spacing = 16, MinWidth = 380, Children = { presets, dimensions } });
        dialog.PrimaryButtonText = resources.GetString("NewSizeCreate");
        dialog.CloseButtonText = resources.GetString("DialogCancel");
        dialog.DefaultButton = ContentDialogButton.Primary;
        void Validate() => dialog.IsPrimaryButtonEnabled = width.Value > 0 && height.Value > 0 && unit.SelectedIndex >= 0;
        width.ValueChanged += (_, _) => Validate();
        height.ValueChanged += (_, _) => Validate();
        Validate();

        if (await ShowAsync(dialog) != ContentDialogResult.Primary)
        {
            return null;
        }

        return new DocumentSize(width.Value, height.Value, (LengthUnit)unit.SelectedIndex);
    }

    public async Task ShowErrorAsync(string title, string message)
    {
        var dialog = CreateDialog(title, message);
        dialog.CloseButtonText = resources.GetString("DialogOk");
        dialog.DefaultButton = ContentDialogButton.Close;
        await ShowAsync(dialog);
    }

    private static ContentDialog CreateDialog(string title, object content) => new()
    {
        Title = title,
        Content = content is string text ? new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap } : content,
        Style = (Style)Application.Current.Resources["DefaultContentDialogStyle"],
    };

    private async Task<ContentDialogResult> ShowAsync(ContentDialog dialog)
    {
        await _oneDialogAtATime.WaitAsync();
        try
        {
            dialog.XamlRoot = window.Content.XamlRoot;
            dialog.RequestedTheme = (window.Content as FrameworkElement)?.ActualTheme ?? ElementTheme.Default;
            return await dialog.ShowAsync();
        }
        finally
        {
            _oneDialogAtATime.Release();
        }
    }
}
