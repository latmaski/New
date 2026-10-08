<?php
// Regler och inställningar för tvättstugan. Ändra här vid behov.
return [
    'name' => 'Stora Pukevägen 12',
    'timezone' => 'Europe/Stockholm',
    'openHour' => 6,            // första möjliga starttid
    'closeHour' => 23,          // allt måste vara klart senast då
    'passHours' => 4,           // längd på ett pass
    'minPassHours' => 1,        // kortaste pass när ett helt inte får plats (före annans pass eller stängning)
    'maxActiveBookings' => 2,   // max antal kommande/pågående pass per lägenhet
    'bookingHorizonDays' => 28, // hur långt fram man får boka
    'apartments' => [
        ['id' => '1', 'name' => 'Lägenhet 1'],
        ['id' => '2', 'name' => 'Lägenhet 2'],
        ['id' => '3', 'name' => 'Lägenhet 3'],
        ['id' => '4', 'name' => 'Lägenhet 4'],
        ['id' => '5', 'name' => 'Lägenhet 5'],
    ],
    // Hyresvärdens konto: ser statistik och kan ge lägenheter nya lösenord.
    'admin' => ['id' => 'admin', 'name' => 'Hyresvärd'],
    // Mapp för bokningar och lösenord. null = mappen "tvatt-data" bredvid
    // public_html (utanför webbroten), eller "data" här om det inte går.
    'dataDir' => null,
];
