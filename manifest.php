<?php
// manifest.php - Server-side manifest generator for Torrio
header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache, must-revalidate');

$config_key = $_SERVER['CONFIG_KEY'] ?? '';
if (empty($config_key)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing config key']);
    exit;
}

// Decode config
$config_json = base64_decode(str_replace(['-', '_'], ['+', '/'], $config_key));
$config = json_decode($config_json, true);

if (!$config) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid config']);
    exit;
}

// Build manifest
$manifest = [
    'id' => 'com.torrio.stremio',
    'version' => '1.0',
    'name' => 'Torrio',
    'description' => 'TorrServer + Multi-Source Aggregator for Stremio',
    'resources' => ['stream', 'meta'],
    'types' => ['movie', 'series'],
    'idPrefixes' => ['tt', 'kitsu'],
    'behaviorHints' => [
        'configurable' => true,
        'configurationRequired' => false
    ],
    'catalogs' => [],
    'background' => 'https://blog.stremio.com/wp-content/uploads/2023/08/Stremio-logo-dark-background-1024x570.png',
    'logo' => 'https://blog.stremio.com/wp-content/uploads/2023/08/Stremio-logo-dark-background-1024x570.png'
];

echo json_encode($manifest, JSON_UNESCAPED_SLASHES);
?>

