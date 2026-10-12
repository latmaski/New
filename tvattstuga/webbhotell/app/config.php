<?php
// Inställningar för hela webbplatsen. Bokningsreglerna nedan är standardvärden
// för nya fastigheter; hyresvärden kan ändra dem per fastighet på startsidan.
return [
    'company' => 'CJA Fastighet & Bygg AB',
    'timezone' => 'Europe/Stockholm',
    'adminName' => 'Hyresvärd',

    'rules' => [
        'openHour' => 6,            // första möjliga starttid
        'closeHour' => 23,          // allt måste vara klart senast då
        'passHours' => 4,           // längd på ett pass
        'minPassHours' => 1,        // kortaste pass när ett helt inte får plats
        'maxActiveBookings' => 2,   // max antal kommande/pågående pass per lägenhet
        'bookingHorizonDays' => 28, // hur långt fram man får boka
    ],

    // Fastigheter som finns från start. Fler läggs till av hyresvärden.
    // "folder" = mappen (bredvid public_html) som underdomänen pekar på.
    'properties' => [
        [
            'slug' => 'pukevagen',
            'name' => 'Stora Pukevägen 12',
            'url' => 'https://pukevagen.cjafastighetobygg.se/',
            'apartments' => ['Lägenhet 1', 'Lägenhet 2', 'Lägenhet 3', 'Lägenhet 4', 'Lägenhet 5'],
        ],
    ],

    // Mapp för all data. null = mappen "data" bredvid app/ (utanför webben).
    'dataDir' => null,
];
