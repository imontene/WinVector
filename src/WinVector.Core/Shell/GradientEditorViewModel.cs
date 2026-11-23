using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>Modo de una pintura en su ventana desplegable: un color o un degradado.</summary>
public enum PaintMode
{
    Color,
    Linear,
    Radial,
}

/// <summary>
/// Editor del degradado del relleno o del trazo en el panel Apariencia (issue #109): el modo (color,
/// lineal o radial), las paradas, la elegida y la repetición. Cada cambio se envía al motor, que
/// trabaja sobre un degradado propio de cada objeto (ADR 0009), y se muestra enseguida, sin esperar
/// a que el motor anuncie la selección.
/// </summary>
public sealed partial class GradientEditorViewModel : ObservableObject
{
    /// <summary>Paradas mínimas de un degradado: con menos, no se pueden quitar.</summary>
    public const int MinimumStops = 2;

    private readonly Func<GradientRequestChange, bool> _send;
    private readonly Func<string, bool> _setColor;
    private readonly Func<UseGradientChange, bool> _use;
    private IReadOnlyList<GradientStop> _stops = [];
    private IReadOnlyList<GradientPaint> _library = [];

    /// <param name="property">Pintura que edita: el relleno o el trazo.</param>
    /// <param name="send">Envía un cambio de degradado de la selección; false si no se pudo.</param>
    /// <param name="setColor">Pone un color en la pintura (al volver al modo color).</param>
    /// <param name="use">Pinta la selección con un degradado de la biblioteca (issue #112).</param>
    public GradientEditorViewModel(
        PaintProperty property, Func<GradientRequestChange, bool> send, Func<string, bool> setColor, Func<UseGradientChange, bool> use)
    {
        Property = property;
        _send = send;
        _setColor = setColor;
        _use = use;
    }

    public PaintProperty Property { get; }

    /// <summary>Modo de la pintura; null si los objetos pintan de formas distintas o con un patrón.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsGradient), nameof(ModeIndex), nameof(CanEditShared))]
    [NotifyCanExecuteChangedFor(nameof(DuplicateCommand))]
    private PaintMode? _mode;

    /// <summary>Repetición del degradado.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SpreadIndex))]
    private SpreadMethod _spread = SpreadMethod.Pad;

    /// <summary>Parada elegida, o -1 si no hay paradas.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SelectedStop), nameof(SelectedOffsetPercent))]
    [NotifyCanExecuteChangedFor(nameof(RemoveStopCommand))]
    private int _selectedIndex = -1;

    /// <summary>Degradado de la biblioteca que tiene las paradas de la pintura, o null.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanEditShared))]
    [NotifyCanExecuteChangedFor(nameof(DuplicateCommand))]
    private string? _stopsId;

    /// <summary>Pinturas de objetos que comparten esas paradas.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanEditShared))]
    [NotifyCanExecuteChangedFor(nameof(DuplicateCommand))]
    private int _stopsUsers;

    /// <summary>
    /// Los cambios de paradas y repetición se hacen para todos los objetos que las comparten, en
    /// lugar de en un degradado propio (issue #112).
    /// </summary>
    [ObservableProperty]
    private bool _editShared;

    /// <summary>Las paradas las comparten otros objetos: se pueden cambiar para todos o duplicar.</summary>
    public bool CanEditShared => IsGradient && StopsId is not null && StopsUsers > 1;

    /// <summary>Degradados de la biblioteca del documento (los que tienen paradas propias).</summary>
    public IReadOnlyList<GradientPaint> Library
    {
        get => _library;
        private set
        {
            _library = value;
            OnPropertyChanged(nameof(Library));
        }
    }

    /// <summary>La pintura es un degradado: el panel muestra el editor de paradas.</summary>
    public bool IsGradient => Mode is PaintMode.Linear or PaintMode.Radial;

    /// <summary>Índice del modo en la lista (Color, Lineal, Radial), o -1 si no hay uno común.</summary>
    public int ModeIndex => Mode is { } mode ? (int)mode : -1;

    /// <summary>Índice de la repetición en la lista (rellenar, reflejar, repetir).</summary>
    public int SpreadIndex => (int)Spread;

    /// <summary>Paradas en orden.</summary>
    public IReadOnlyList<GradientStop> Stops
    {
        get => _stops;
        private set
        {
            _stops = value;
            OnPropertyChanged(nameof(Stops));
            OnPropertyChanged(nameof(StopLabels));
            OnPropertyChanged(nameof(SelectedStop));
            OnPropertyChanged(nameof(SelectedOffsetPercent));
            RemoveStopCommand.NotifyCanExecuteChanged();
        }
    }

    /// <summary>Textos de las paradas para la lista del panel ("1 · 0 %").</summary>
    public IReadOnlyList<string> StopLabels =>
        [.. Stops.Select((stop, i) => string.Create(CultureInfo.CurrentCulture, $"{i + 1} · {Math.Round(stop.Offset * 100, 1)} %"))];

    public GradientStop? SelectedStop => SelectedIndex >= 0 && SelectedIndex < Stops.Count ? Stops[SelectedIndex] : null;

    /// <summary>Posición de la parada elegida, de 0 a 100; NaN si no hay.</summary>
    public double SelectedOffsetPercent => SelectedStop is { } stop ? Math.Round(stop.Offset * 100, 1) : double.NaN;

    /// <summary>Se puede quitar la parada elegida: quedan al menos dos.</summary>
    public bool CanRemoveStop => SelectedStop is not null && Stops.Count > MinimumStops;

    /// <summary>Muestra la pintura de la selección: su color o su degradado.</summary>
    /// <param name="paint">"none", "#rrggbb", "url" o null si son distintas.</param>
    /// <param name="gradient">El degradado común, si lo hay.</param>
    public void Show(string? paint, GradientPaint? gradient)
    {
        if (gradient is not null)
        {
            if (gradient.StopsId != StopsId)
            {
                EditShared = false;
            }

            StopsId = gradient.StopsId;
            StopsUsers = gradient.StopsUsers ?? 0;
            Mode = gradient.Kind == GradientKind.Radial ? PaintMode.Radial : PaintMode.Linear;
            Spread = gradient.Spread;
            Stops = gradient.Stops;
            SelectedIndex = Stops.Count == 0 ? -1 : Math.Clamp(SelectedIndex, 0, Stops.Count - 1);
            return;
        }

        Mode = paint is null or "url" ? null : PaintMode.Color;
        StopsId = null;
        StopsUsers = 0;
        EditShared = false;
        Spread = SpreadMethod.Pad;
        Stops = [];
        SelectedIndex = -1;
    }

    /// <summary>Cambia el modo: un degradado nuevo (o de otro tipo) o un color.</summary>
    /// <param name="mode">El modo elegido.</param>
    /// <param name="color">Color para el modo color: el de la parada elegida si no se indica.</param>
    public bool SetMode(PaintMode mode, string? color = null)
    {
        if (mode == Mode)
        {
            return false;
        }

        if (mode == PaintMode.Color)
        {
            var target = color ?? SelectedStop?.Color ?? (Stops.Count > 0 ? Stops[0].Color : "#000000");
            if (!_setColor(target))
            {
                return false;
            }

            Show(target, null);
            return true;
        }

        var kind = mode == PaintMode.Radial ? GradientKind.Radial : GradientKind.Linear;
        if (!_send(new GradientRequestChange(Property, Kind: kind)))
        {
            return false;
        }

        Mode = mode;
        return true;
    }

    /// <summary>Elige una parada.</summary>
    public void SelectStop(int index)
    {
        if (index >= 0 && index < Stops.Count)
        {
            SelectedIndex = index;
        }
    }

    /// <summary>Mueve una parada (al arrastrarla). Si pasa a otra, cambian de orden y sigue elegida.</summary>
    /// <param name="index">La parada.</param>
    /// <param name="offset">Posición nueva, de 0 a 1.</param>
    public bool MoveStop(int index, double offset)
    {
        if (index < 0 || index >= Stops.Count || !double.IsFinite(offset))
        {
            return false;
        }

        var moved = Stops[index] with { Offset = Math.Round(Math.Clamp(offset, 0, 1), 4) };
        if (Math.Abs(moved.Offset - Stops[index].Offset) < 1e-9)
        {
            return false;
        }

        var others = Stops.Where((_, i) => i != index).ToList();
        // Detrás de las que están en la misma posición: así no salta por delante al tocarlas.
        var position = others.FindLastIndex(stop => stop.Offset <= moved.Offset) + 1;
        others.Insert(position, moved);
        return SendStops(others, position);
    }

    /// <summary>Posición de la parada elegida, de 0 a 100 (el campo del panel).</summary>
    public bool SetSelectedOffsetPercent(double percent) =>
        double.IsFinite(percent) && SelectedIndex >= 0 && MoveStop(SelectedIndex, percent / 100);

    /// <summary>Color y opacidad de la parada elegida (el selector de color).</summary>
    public bool SetSelectedColor(string color, double opacity)
    {
        if (SelectedStop is not { } stop || MainViewModel.NormalizePaint(color) is not { } hex || hex == "none" || !double.IsFinite(opacity))
        {
            return false;
        }

        var changed = stop with { Color = hex, Opacity = Math.Round(Math.Clamp(opacity, 0, 1), 4) };
        if (changed == stop)
        {
            return false;
        }

        var stops = Stops.ToList();
        stops[SelectedIndex] = changed;
        return SendStops(stops, SelectedIndex);
    }

    /// <summary>Añade una parada con el color que tiene el degradado en ese punto, y la elige.</summary>
    /// <param name="offset">Posición, de 0 a 1; si no se indica, a mitad de camino hacia la siguiente.</param>
    public bool AddStopAt(double? offset = null)
    {
        if (Stops.Count == 0)
        {
            return false;
        }

        var at = offset ?? MidwayAfterSelected();
        if (!double.IsFinite(at))
        {
            return false;
        }

        at = Math.Round(Math.Clamp(at, 0, 1), 4);
        var stop = ColorAt(at) with { Offset = at };
        var stops = Stops.ToList();
        var position = stops.FindLastIndex(s => s.Offset <= at) + 1;
        stops.Insert(position, stop);
        return SendStops(stops, position);
    }

    [RelayCommand]
    private void AddStop() => AddStopAt();

    /// <summary>Quita la parada elegida; quedan al menos dos.</summary>
    [RelayCommand(CanExecute = nameof(CanRemoveStop))]
    private void RemoveStop()
    {
        if (!CanRemoveStop)
        {
            return;
        }

        var stops = Stops.ToList();
        stops.RemoveAt(SelectedIndex);
        SendStops(stops, Math.Min(SelectedIndex, stops.Count - 1));
    }

    /// <summary>Invierte el degradado: cada parada pasa a la posición simétrica.</summary>
    [RelayCommand]
    private void Invert()
    {
        if (Stops.Count == 0)
        {
            return;
        }

        var stops = Stops.Reverse().Select(stop => stop with { Offset = Math.Round(1 - stop.Offset, 4) }).ToList();
        SendStops(stops, Stops.Count - 1 - Math.Max(0, SelectedIndex));
    }

    /// <summary>Cambia la repetición del degradado.</summary>
    public bool SetSpread(SpreadMethod spread)
    {
        if (!IsGradient || spread == Spread || !_send(new GradientRequestChange(Property, Spread: spread, Shared: SharedFlag)))
        {
            return false;
        }

        Spread = spread;
        return true;
    }

    /// <summary>Marca de los cambios para todos, solo si se pueden hacer así.</summary>
    private bool? SharedFlag => EditShared && CanEditShared ? true : null;

    /// <summary>Muestra la biblioteca del documento.</summary>
    public void ShowLibrary(IReadOnlyList<GradientPaint> gradients) => Library = gradients;

    /// <summary>Pinta la selección con un degradado de la biblioteca, compartiendo sus paradas.</summary>
    public bool ApplyLibrary(string id) => !string.IsNullOrEmpty(id) && _use(new UseGradientChange(Property, id));

    /// <summary>Pinta la selección con un degradado predefinido (uno nuevo, con sus paradas).</summary>
    public bool ApplyPreset(GradientPreset preset)
    {
        ArgumentNullException.ThrowIfNull(preset);
        var kind = Mode == PaintMode.Radial ? GradientKind.Radial : GradientKind.Linear;
        // Si ya es un degradado, solo cambian sus paradas; si no, se crea uno con ellas.
        return _send(new GradientRequestChange(Property, Kind: IsGradient ? null : kind, Stops: preset.Stops, Shared: SharedFlag));
    }

    /// <summary>Da al objeto una copia propia de las paradas compartidas, para cambiarlas aparte.</summary>
    [RelayCommand(CanExecute = nameof(CanEditShared))]
    private void Duplicate()
    {
        if (StopsId is { } id && _use(new UseGradientChange(Property, id, Copy: true)))
        {
            EditShared = false;
        }
    }

    private bool SendStops(List<GradientStop> stops, int selected)
    {
        if (!IsGradient || !_send(new GradientRequestChange(Property, Stops: stops, Shared: SharedFlag)))
        {
            return false;
        }

        Stops = stops;
        SelectedIndex = Math.Clamp(selected, 0, stops.Count - 1);
        return true;
    }

    /// <summary>A mitad de camino entre la parada elegida y la siguiente (o la anterior si es la última).</summary>
    private double MidwayAfterSelected()
    {
        var index = Math.Max(0, SelectedIndex);
        var current = Stops[index].Offset;
        if (index + 1 < Stops.Count)
        {
            return (current + Stops[index + 1].Offset) / 2;
        }

        return index > 0 ? (Stops[index - 1].Offset + current) / 2 : current;
    }

    /// <summary>Color y opacidad del degradado en una posición, mezclando las dos paradas vecinas.</summary>
    private GradientStop ColorAt(double offset)
    {
        var before = Stops.LastOrDefault(stop => stop.Offset <= offset) ?? Stops[0];
        var after = Stops.FirstOrDefault(stop => stop.Offset >= offset) ?? Stops[^1];
        var span = after.Offset - before.Offset;
        var t = span <= 1e-9 ? 0 : (offset - before.Offset) / span;
        return new GradientStop(offset, Mix(before.Color, after.Color, t), Math.Round(before.Opacity + ((after.Opacity - before.Opacity) * t), 4));
    }

    private static string Mix(string a, string b, double t)
    {
        static int Channel(string hex, int i) => int.Parse(hex.AsSpan(1 + (2 * i), 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        var channels = Enumerable.Range(0, 3).Select(i => (int)Math.Round(Channel(a, i) + ((Channel(b, i) - Channel(a, i)) * t)));
        return "#" + string.Concat(channels.Select(c => c.ToString("x2", CultureInfo.InvariantCulture)));
    }
}

/// <summary>Cambio de degradado de una pintura de la selección, sin el documento.</summary>
public sealed record GradientRequestChange(
    PaintProperty Property,
    GradientKind? Kind = null,
    IReadOnlyList<GradientStop>? Stops = null,
    SpreadMethod? Spread = null,
    bool? Shared = null);

/// <summary>Degradado de la biblioteca para una pintura de la selección, sin el documento.</summary>
public sealed record UseGradientChange(PaintProperty Property, string Id, bool? Copy = null);
