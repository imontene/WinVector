using System.ComponentModel;
using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.Windows.ApplicationModel.Resources;
using WinVector.App.Shell;
using WinVector.Core.Bridge;
using WinVector.Core.Shell;

namespace WinVector.App.Controls;

/// <summary>
/// Editor del degradado de una pintura (issue #109). Muestra el estado de su
/// <see cref="GradientEditorViewModel"/> y le pasa lo que hace el usuario; la lógica está en el
/// modelo de vista, que se prueba sin la interfaz.
/// </summary>
public sealed partial class GradientEditor : UserControl
{
    /// <summary>Ancho de cada marca de parada en la barra.</summary>
    private const double ThumbWidth = 12;

    private readonly ResourceLoader _resources = new();
    private GradientEditorViewModel? _editor;
    private string _automationPrefix = string.Empty;
    private bool _updating;
    private int _dragging = -1;
    private IReadOnlyList<string> _labels = [];

    public GradientEditor()
    {
        InitializeComponent();
        RebuildPresets();
    }

    /// <summary>Se produce al cambiar la parada elegida o el modo, para poner su color en el selector.</summary>
    public event EventHandler? SelectedStopChanged;

    /// <summary>Modelo de vista que edita: el del relleno o el del trazo.</summary>
    public GradientEditorViewModel? Editor
    {
        get => _editor;
        set
        {
            if (_editor is not null)
            {
                _editor.PropertyChanged -= OnEditorChanged;
            }

            _editor = value;
            if (value is not null)
            {
                value.PropertyChanged += OnEditorChanged;
            }

            Refresh();
            RebuildLibrary();
        }
    }

    /// <summary>Prefijo de los AutomationId de sus controles ("Fill" → "FillGradientModeLinear").</summary>
    public string AutomationPrefix
    {
        get => _automationPrefix;
        set
        {
            _automationPrefix = value;
            foreach (var (element, name) in new (DependencyObject, string)[]
            {
                (ModeButtons, "GradientMode"),
                (ModeColor, "GradientModeColor"),
                (ModeLinear, "GradientModeLinear"),
                (ModeRadial, "GradientModeRadial"),
                (StopBar, "GradientStopBar"),
                (StopBox, "GradientStopBox"),
                (OffsetBox, "GradientOffsetBox"),
                (AddStopButton, "GradientAddStop"),
                (RemoveStopButton, "GradientRemoveStop"),
                (InvertButton, "GradientInvert"),
                (SpreadBox, "GradientSpreadBox"),
                (SpreadPad, "GradientSpreadPad"),
                (SpreadReflect, "GradientSpreadReflect"),
                (SpreadRepeat, "GradientSpreadRepeat"),
                (EditSharedBox, "GradientEditShared"),
                (DuplicateButton, "GradientDuplicate"),
            })
            {
                AutomationProperties.SetAutomationId(element, value + name);
            }

            RebuildPresets();
            RebuildLibrary();
        }
    }

    private void OnEditorChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(GradientEditorViewModel.Library))
        {
            RebuildLibrary();
        }

        Refresh();
        if (e.PropertyName is nameof(GradientEditorViewModel.SelectedIndex) or nameof(GradientEditorViewModel.Mode))
        {
            SelectedStopChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <summary>Muestra el estado del modelo de vista sin que los controles lo devuelvan como cambios.</summary>
    private void Refresh()
    {
        _updating = true;
        try
        {
            var editor = _editor;
            ModeButtons.SelectedIndex = editor?.ModeIndex ?? -1;
            GradientPanel.Visibility = editor?.IsGradient == true ? Visibility.Visible : Visibility.Collapsed;

            var labels = editor?.StopLabels ?? [];
            if (!labels.SequenceEqual(_labels))
            {
                _labels = labels;
                StopBox.ItemsSource = labels.ToList();
            }

            StopBox.SelectedIndex = editor?.SelectedIndex ?? -1;
            // La lista solo tiene sus elementos en la interfaz de accesibilidad mientras está abierta:
            // cuántas paradas hay se dice en su texto de ayuda ("3 paradas").
            AutomationProperties.SetHelpText(
                StopBox,
                string.Format(CultureInfo.CurrentCulture, _resources.GetString("GradientStopCount"), labels.Count));
            OffsetBox.Value = editor?.SelectedOffsetPercent ?? double.NaN;
            OffsetBox.IsEnabled = editor?.SelectedStop is not null;
            SpreadBox.SelectedIndex = editor?.SpreadIndex ?? 0;
            RemoveStopButton.IsEnabled = editor?.CanRemoveStop == true;
            Preview.Background = BindingFunctions.GradientBrush(editor?.Stops);
            SharedPanel.Visibility = editor?.CanEditShared == true ? Visibility.Visible : Visibility.Collapsed;
            EditSharedBox.IsChecked = editor?.EditShared == true;
            RebuildThumbs();
        }
        finally
        {
            _updating = false;
        }
    }

    /// <summary>Muestra de un degradado de la biblioteca: un botón con sus paradas.</summary>
    private static Button Swatch(IReadOnlyList<WinVector.Core.Bridge.GradientStop> stops, string name, string automationId, Action apply)
    {
        var button = new Button
        {
            Width = 34,
            Height = 24,
            Padding = new Thickness(2),
            Content = new Border
            {
                CornerRadius = new CornerRadius(2),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
                Background = BindingFunctions.GradientBrush(stops),
            },
        };
        ToolTipService.SetToolTip(button, name);
        AutomationProperties.SetName(button, name);
        AutomationProperties.SetAutomationId(button, automationId);
        button.Click += (_, _) => apply();
        return button;
    }

    /// <summary>Los degradados del documento (con paradas propias), por su id.</summary>
    private void RebuildLibrary()
    {
        LibraryPanel.Children.Clear();
        var library = _editor?.Library ?? [];
        foreach (var gradient in library)
        {
            var id = gradient.Id;
            LibraryPanel.Children.Add(Swatch(gradient.Stops, id, $"{_automationPrefix}GradientLibrary_{id}", () => _editor?.ApplyLibrary(id)));
        }

        LibraryTitle.Visibility = library.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>Los degradados predefinidos, con su nombre traducido.</summary>
    private void RebuildPresets()
    {
        PresetPanel.Children.Clear();
        foreach (var preset in GradientPreset.All)
        {
            var name = _resources.GetString("GradientPreset" + preset.Key);
            PresetPanel.Children.Add(Swatch(preset.Stops, name.Length > 0 ? name : preset.Key, $"{_automationPrefix}GradientPreset_{preset.Key}", () => _editor?.ApplyPreset(preset)));
        }
    }

    private void OnEditSharedClick(object sender, RoutedEventArgs e)
    {
        if (_editor is { } editor)
        {
            editor.EditShared = EditSharedBox.IsChecked == true;
        }
    }

    private void OnDuplicateClick(object sender, RoutedEventArgs e) => _editor?.DuplicateCommand.Execute(null);

    /// <summary>Una marca por parada, con su color, en su posición de la barra.</summary>
    private void RebuildThumbs()
    {
        Thumbs.Children.Clear();
        if (_editor is not { IsGradient: true } editor)
        {
            return;
        }

        var width = Thumbs.ActualWidth;
        for (var i = 0; i < editor.Stops.Count; i++)
        {
            var stop = editor.Stops[i];
            var selected = i == editor.SelectedIndex;
            var index = i;
            var thumb = new Border
            {
                Width = ThumbWidth,
                Height = 28,
                CornerRadius = new CornerRadius(3),
                BorderThickness = new Thickness(selected ? 2 : 1),
                BorderBrush = ThemeBrush(selected ? "AccentFillColorDefaultBrush" : "ControlStrongStrokeColorDefaultBrush"),
                Background = BindingFunctions.StopBrush(stop),
            };
            AutomationProperties.SetName(thumb, editor.StopLabels[i]);
            Canvas.SetLeft(thumb, (stop.Offset * width) - (ThumbWidth / 2));
            Canvas.SetTop(thumb, 2);
            thumb.PointerPressed += (_, e) =>
            {
                _dragging = index;
                editor.SelectStop(index);
                StopBar.CapturePointer(e.Pointer);
                e.Handled = true;
            };
            Thumbs.Children.Add(thumb);
        }
    }

    /// <summary>Pincel del tema por su nombre, o gris si no se encuentra.</summary>
    private static Brush ThemeBrush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush
            ? brush
            : new SolidColorBrush(Microsoft.UI.Colors.Gray);

    /// <summary>Posición de la barra (0 a 1) bajo el puntero.</summary>
    private double OffsetAt(PointerRoutedEventArgs e)
    {
        var width = Thumbs.ActualWidth;
        return width <= 0 ? 0 : Math.Clamp(e.GetCurrentPoint(Thumbs).Position.X / width, 0, 1);
    }

    /// <summary>Un clic en la barra, fuera de las marcas, añade una parada ahí.</summary>
    private void OnBarPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        if (_editor is { IsGradient: true } editor && editor.AddStopAt(OffsetAt(e)))
        {
            // Se puede arrastrar enseguida la parada nueva.
            _dragging = editor.SelectedIndex;
            StopBar.CapturePointer(e.Pointer);
        }

        e.Handled = true;
    }

    private void OnBarPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (_dragging < 0 || _editor is not { } editor)
        {
            return;
        }

        editor.MoveStop(_dragging, OffsetAt(e));
        // Si pasa por encima de otra, cambia de lugar en la lista.
        _dragging = editor.SelectedIndex;
    }

    private void OnBarPointerReleased(object sender, PointerRoutedEventArgs e)
    {
        _dragging = -1;
        StopBar.ReleasePointerCaptures();
    }

    private void OnBarSizeChanged(object sender, SizeChangedEventArgs e) => RebuildThumbs();

    private void OnModeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_updating && _editor is { } editor && ModeButtons.SelectedIndex >= 0)
        {
            editor.SetMode((PaintMode)ModeButtons.SelectedIndex);
            // Si no se pudo (sin selección), vuelve a mostrar el modo de verdad.
            Refresh();
        }
    }

    private void OnStopSelected(object sender, SelectionChangedEventArgs e)
    {
        if (!_updating && StopBox.SelectedIndex >= 0)
        {
            _editor?.SelectStop(StopBox.SelectedIndex);
        }
    }

    private void OnOffsetChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (!_updating && !double.IsNaN(args.NewValue))
        {
            _editor?.SetSelectedOffsetPercent(args.NewValue);
        }
    }

    private void OnAddStopClick(object sender, RoutedEventArgs e) => _editor?.AddStopCommand.Execute(null);

    private void OnRemoveStopClick(object sender, RoutedEventArgs e) => _editor?.RemoveStopCommand.Execute(null);

    private void OnInvertClick(object sender, RoutedEventArgs e) => _editor?.InvertCommand.Execute(null);

    private void OnSpreadChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_updating && SpreadBox.SelectedIndex >= 0)
        {
            _editor?.SetSpread((SpreadMethod)SpreadBox.SelectedIndex);
        }
    }
}
