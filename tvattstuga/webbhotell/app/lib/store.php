<?php
// Enkla JSON-filer som databas. Varje förfrågan låser sin fil exklusivt under
// hela körningen, så två samtidiga bokningar kan inte krocka. Låsordning när
// båda behövs: först webbplatsen (site.json), sedan fastigheten.
defined('TVATT') || exit;

function tvatt_data_root(array $config): string
{
    $dir = getenv('TVATT_DATA_DIR') ?: ($config['dataDir'] ?? null) ?: dirname(__DIR__, 2) . '/data';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new RuntimeException("Kan inte skapa datamappen $dir.");
    }
    // Skydd ifall mappen av misstag hamnar inom en webbrot.
    if (!file_exists($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    return $dir;
}

function tvatt_property_dir(string $root, string $slug): string
{
    $dir = "$root/properties/$slug";
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return $dir;
}

// Läser en JSON-fil utan att låsa (filer skrivs atomiskt med rename).
function tvatt_peek_json(string $file): array
{
    $data = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    return is_array($data) ? $data : [];
}

class TvattStore
{
    public $dir;
    public $data;
    private $file;
    private $lock;

    public function __construct(string $dir, string $name = 'db.json', array $defaults = [])
    {
        $this->dir = $dir;
        $this->file = "$dir/$name";
        $this->lock = fopen("$dir/$name.lock", 'c');
        flock($this->lock, LOCK_EX);
        $this->data = array_merge(
            ['secret' => null, 'users' => [], 'bookings' => [], 'loginFailures' => []],
            $defaults,
            tvatt_peek_json($this->file)
        );
        if (!$this->data['secret']) {
            $this->data['secret'] = bin2hex(random_bytes(32));
            $this->save();
        }
    }

    public function save(): void
    {
        $tmp = $this->file . '.' . getmypid() . '.tmp';
        file_put_contents($tmp, json_encode($this->data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        @chmod($tmp, 0600);
        rename($tmp, $this->file);
    }

    // Lägger till rader i lösenordsfilen (läses via FTP/SFTP, aldrig via webben).
    public function logPasswords(string $root, string $title, array $lines): void
    {
        $file = "$root/losenord.txt";
        $text = '# ' . date('Y-m-d H:i') . " – $title\n" . implode("\n", $lines) . "\n\n";
        file_put_contents($file, $text, FILE_APPEND);
        @chmod($file, 0600);
    }

    public function __destruct()
    {
        if ($this->lock) {
            flock($this->lock, LOCK_UN);
            fclose($this->lock);
        }
    }
}
