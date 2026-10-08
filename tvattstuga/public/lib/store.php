<?php
// Enkel JSON-fil som databas. Varje förfrågan låser filen exklusivt under
// hela sin körning, så två samtidiga bokningar kan inte krocka.
defined('TVATT') || exit;

function tvatt_data_dir(array $config): string
{
    $candidates = [];
    if (getenv('TVATT_DATA_DIR')) $candidates[] = getenv('TVATT_DATA_DIR');
    if (!empty($config['dataDir'])) $candidates[] = $config['dataDir'];
    $pos = strpos(__DIR__, '/public_html');
    if ($pos !== false) $candidates[] = substr(__DIR__, 0, $pos) . '/tvatt-data';
    $candidates[] = dirname(__DIR__) . '/data';

    foreach ($candidates as $dir) {
        if (!is_dir($dir)) @mkdir($dir, 0700, true);
        if (is_dir($dir) && is_writable($dir)) {
            // Skydd ifall mappen ligger inom webbroten.
            if (!file_exists($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
            return $dir;
        }
    }
    throw new RuntimeException('Hittar ingen skrivbar datamapp.');
}

class TvattStore
{
    public $dir;
    public $data;
    private $lock;

    public function __construct(string $dir)
    {
        $this->dir = $dir;
        $this->lock = fopen($dir . '/db.lock', 'c');
        flock($this->lock, LOCK_EX);
        $file = $dir . '/db.json';
        $data = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        $this->data = array_merge(['secret' => null, 'users' => [], 'bookings' => [], 'loginFailures' => []], is_array($data) ? $data : []);
        if (!$this->data['secret']) {
            $this->data['secret'] = bin2hex(random_bytes(32));
            $this->save();
        }
    }

    public function save(): void
    {
        $tmp = $this->dir . '/db.json.' . getmypid() . '.tmp';
        file_put_contents($tmp, json_encode($this->data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        @chmod($tmp, 0600);
        rename($tmp, $this->dir . '/db.json');
    }

    // Lägger till rader i lösenordsfilen (läses via FTP/SFTP, aldrig via webben).
    public function logPasswords(array $lines): void
    {
        $file = $this->dir . '/losenord.txt';
        $text = '# ' . date('Y-m-d H:i') . "\n" . implode("\n", $lines) . "\n\n";
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
