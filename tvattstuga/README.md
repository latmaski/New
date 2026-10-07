# Tvättstugan – Stora Pukevägen 12

Bokningsverktyg för tvättstugan. Webbapp i Node.js utan externa beroenden.

## Regler

- Ett pass är **4 timmar** och kan starta på valfri hel timme mellan **06:00 och 19:00**, så att det är klart senast **23:00**. Det gäller alla dagar.
- Varje lägenhet (**5 st**) har en egen inloggning.
- Man får ha **max 2 pass** bokade åt gången. Ett pass räknas tills det är slut, så när ett pass passerat kan man boka ett nytt.
- Pass får inte överlappa. Man kan boka upp till 28 dagar fram och avboka sina egna pass.

Reglerna ställs in i `config.js`. Där finns även lägenheternas namn, till exempel om de ska heta 1001–1005 i stället för Lägenhet 1–5.

## Kom igång

Kräver Node.js 18 eller senare.

```sh
cd tvattstuga
npm start            # startar på http://localhost:3000 (ändra med PORT=8080)
```

Vid första starten skapas ett slumpat lösenord per lägenhet. Lösenorden skrivs ut **en gång** i terminalen, så dela ut dem till respektive lägenhet direkt. Den boende kan sedan byta lösenord i appen under "Byt lösenord".

Har någon glömt sitt lösenord kan du sätta ett nytt så här:

```sh
npm run set-password -- 3            # slumpar ett nytt lösenord för lägenhet 3
npm run set-password -- 3 hemligt123 # eller sätt ett eget
```

När ett lösenord byts loggas lägenheten ut på alla enheter.

## Drift

- Data sparas i `data/db.json`. Ange en annan sökväg med `DATA_FILE=/sökväg/db.json`. Säkerhetskopiera den filen.
- Kör servern bakom HTTPS, till exempel via en reverse proxy som Caddy eller nginx, och sätt `COOKIE_SECURE=1`.
- Tiderna räknas alltid i svensk tid (Europe/Stockholm), oavsett serverns tidszon.

## Tester

```sh
npm test
```
