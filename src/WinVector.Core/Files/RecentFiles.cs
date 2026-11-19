using System.Collections.ObjectModel;

namespace WinVector.Core.Files;

/// <summary>Dónde se guarda la lista de archivos recientes.</summary>
public interface IRecentFilesStore
{
    IReadOnlyList<string> Load();

    void Save(IReadOnlyList<string> paths);
}

/// <summary>Guarda la lista en un archivo de texto, una ruta por línea.</summary>
public sealed class TextFileRecentFilesStore(string path) : IRecentFilesStore
{
    public IReadOnlyList<string> Load()
    {
        try
        {
            return File.Exists(path)
                ? [.. File.ReadAllLines(path).Where(line => !string.IsNullOrWhiteSpace(line))]
                : [];
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Una lista de recientes ilegible no debe impedir arrancar la aplicación.
            return [];
        }
    }

    public void Save(IReadOnlyList<string> paths)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)) ?? ".");
            File.WriteAllLines(path, paths);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Perder la lista de recientes es preferible a interrumpir lo que hace el usuario.
        }
    }
}

/// <summary>Archivos abiertos o guardados recientemente, el más reciente primero.</summary>
public sealed class RecentFiles
{
    public const int DefaultCapacity = 10;

    private readonly IRecentFilesStore _store;
    private readonly int _capacity;

    public RecentFiles(IRecentFilesStore store, int capacity = DefaultCapacity)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(capacity);
        _store = store;
        _capacity = capacity;
        foreach (var path in store.Load().Take(capacity))
        {
            Items.Add(path);
        }
    }

    public ObservableCollection<string> Items { get; } = [];

    /// <summary>Pone el archivo el primero de la lista.</summary>
    public void Add(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        RemoveWithoutSaving(path);
        Items.Insert(0, path);
        while (Items.Count > _capacity)
        {
            Items.RemoveAt(Items.Count - 1);
        }

        _store.Save(Items);
    }

    public void Remove(string path)
    {
        if (RemoveWithoutSaving(path))
        {
            _store.Save(Items);
        }
    }

    public void Clear()
    {
        Items.Clear();
        _store.Save(Items);
    }

    private bool RemoveWithoutSaving(string path)
    {
        var existing = Items.FirstOrDefault(item => PathComparer.Equals(item, path));
        return existing is not null && Items.Remove(existing);
    }

    /// <summary>Compara rutas como Windows: sin distinguir mayúsculas y minúsculas.</summary>
    public static StringComparer PathComparer { get; } = StringComparer.OrdinalIgnoreCase;
}
