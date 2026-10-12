# CJA Fastighet & Bygg AB – startsida och tvättstugebokning

Webbplatsen för **cjafastighetobygg.se**. Den består av:

- **Startsidan** (https://cjafastighetobygg.se): loggan, länkar till fastigheternas tvättstugebokning och inloggning för hyresvärden.
- **Bokningssidor**, en per fastighet. Stora Pukevägen 12 ligger på https://pukevagen.cjafastighetobygg.se. På bokningssidorna loggar bara lägenheterna in.

Allt körs på ett vanligt webbhotell med PHP (Simply.com) och kräver ingen databas. Inga sidor indexeras av sökmotorer: `robots.txt`, `<meta name="robots">` och rubriken `X-Robots-Tag: noindex, nofollow` finns på alla sidor.

## Regler

- Ett pass är **4 timmar** och kan starta på valfri hel timme mellan **06:00 och 19:00**, så att det är klart senast **23:00**. Det gäller alla dagar.
- Varje lägenhet har en egen inloggning. Stora Pukevägen 12 har 5 lägenheter.
- Man får ha **max 2 pass** bokade åt gången. Ett pass räknas tills det är slut, så när ett pass passerat kan man boka ett nytt.
- **Kortare pass:** om ett helt pass inte får plats, för att någon annans pass börjar eller för att tvättstugan stänger 23:00, kan man boka den tid som finns kvar, minst 1 timme. Före någon annans pass gäller det bara luckor där ett helt pass inte får plats. Finns 4 timmar lediga bokar man ett helt pass i stället, så att schemat inte splittras. I slutet av dagen går det alltid att boka ett kortare pass fram till stängning. Sådana tider är gulmarkerade i kalendern med antal timmar, och man får en varning om hur långt passet blir innan man bekräftar. Ett kort pass räknas som ett av de två passen.
- Pass får inte överlappa. Man kan boka upp till 28 dagar fram och avboka sina egna pass.
- Man kan **flytta** ett eget pass som inte har börjat. Antingen drar man passet i kalendern, eller så klickar man på det (eller på *Ändra* under "Mina pass") och väljer en ny starttid. Det fungerar även när båda passen är bokade.

### Anteckningar och anslagstavla

- **Anteckning på ett pass:** man kan skriva en kort anteckning på sitt pass, högst 200 tecken, till exempel "Tvättar mattor". Det går när man bokar eller senare via raden under passet i "Mina pass". Anteckningen syns för alla i kalendern, och de andra klickar på passet för att läsa hela texten. Den följer med när passet flyttas.
- **Anslagstavla:** under "Mina pass", och i hyresvärdens vy på startsidan, finns en anslagstavla för grannarna. Det som hyresvärden behöver veta skrivs i WhatsApp-gruppen som vanligt. Där kan alla skriva inlägg på högst 500 tecken, som visas med namn, datum och tid. Man kan ta bort sina egna inlägg, och hyresvärden kan ta bort alla.

### Påminnelser

Under "Mina pass" finns knappen **Påminnelser i mobilens kalender**. Varje lägenhet har en personlig kalenderlänk som läggs in en gång i iPhone/Mac-kalendern eller Google Kalender. Sedan visas lägenhetens pass där automatiskt, med en påminnelse vid den tid man valt: 15 minuter, 30 minuter, 1, 2 eller 3 timmar före, eller dagen före. Bokningar, flyttar och avbokningar följer med. Knappen *Kalender* vid varje pass lägger in ett enskilt pass direkt, via en .ics-fil eller Google Kalender på Android.

Länken är hemlig men kräver ingen inloggning, så att kalenderappen kan hämta den. Den kan bytas mot en ny i appen. När hyresvärden markerar att nya boende flyttar in byts den automatiskt.

Reglerna ovan är standardvärden. Hyresvärden kan ändra dem per fastighet på startsidan, se nedan, till exempel andra tider på helger eller stängt vissa dagar. Kalendern visar då varje dags egna tider, och stängda dagar är grå. Standardvärdena finns i `webbhotell/app/config.php`.

## Hyresvärd (startsidan)

Hyresvärden loggar in via *"Hyresvärd? Logga in"* längst ner på startsidan. För varje fastighet finns:

- **Statistik** över bokade pass och timmar per lägenhet: denna månad, förra månaden, i år, de senaste 12 månaderna eller totalt, samt kommande pass.
- **Lägenheter och lösenord:** byt namn på en lägenhet, lägg till en lägenhet, eller ge en lägenhet ett nytt lösenord om någon har glömt sitt eller flyttar. Vid flytt kan man även avboka lägenhetens kommande pass, och då byts kalenderlänken.
- **Bokningsregler:** öppettider per veckodag, där varje dag har egna tider eller är stängd (knappen *Samma tider som måndag alla dagar* fyller i resten), passets längd, kortaste pass (eller bara hela pass), max antal bokade pass och hur långt fram man får boka. Med *Återställ standard* gäller `config.php` igen. Redan bokade pass påverkas inte.
- **Anslagstavla:** hyresvärden kan skriva inlägg och ta bort alla inlägg.
- **Ändra namn och adress** för fastigheten.

**Lägg till fastighet:** hyresvärden anger namn, kortnamn (till exempel `storgatan`) och lägenheter. Då skapas mappen `public_html/storgatan/` automatiskt, och bokningen fungerar direkt på https://cjafastighetobygg.se/storgatan/. Lösenorden till lägenheterna visas en gång, och de kan skrivas ut eller kopieras. Vill man ha en egen underdomän skapar man den i Simplys kontrollpanel med mappen `public_html/storgatan`, och fyller sedan i adressen under *Ändra namn och adress*.

Hyresvärden kan inte boka pass.

## Filer på servern

Zip-filen från `npm run paket` (`tvattstuga-webbhotell.zip`) packas upp i **roten** på FTP-kontot för cjafastighetobygg.se:

```
app/            all kod, stilar och loggan (utanför webben)
public_html/    startsidan, cjafastighetobygg.se
pukevagen/      bokningen, pukevagen.cjafastighetobygg.se
data/           skapas automatiskt: bokningar, lösenordshashar och inställningar (utanför webben)
```

`public_html/` och `pukevagen/` innehåller bara en liten `index.php`, en `.htaccess` och en `robots.txt`. All kod finns i `app/`. En uppdatering är alltså bara att ladda upp `app/` igen. Webbläsarna hämtar de nya filerna direkt.

## Lägga upp på Simply (cjafastighetobygg.se)

Koden räknar ut adresserna själv, så inget i koden behöver ändras för domänen.

1. **Underdomänen** `pukevagen.cjafastighetobygg.se` finns redan hos Simply och pekar på mappen `/pukevagen`. DNS behöver inte ändras.
2. **Ladda upp:** packa upp zip-filen i roten på FTP-kontot för cjafastighetobygg.se (användare `cjafastighetoby.se`, värd `ftp.simply.com`). Ta bort Simplys standardfiler i `public_html/` om det finns några, till exempel en välkomstsida.
3. **Slå på SSL** för både cjafastighetobygg.se och pukevagen.cjafastighetobygg.se i Simplys kontrollpanel.
4. **Hämta lösenorden:** öppna https://cjafastighetobygg.se och https://pukevagen.cjafastighetobygg.se en gång var. Hämta sedan `data/losenord.txt` via FTP. Den innehåller hyresvärdens lösenord och ett lösenord per lägenhet. Dela ut dem och **radera filen**.

Kräver PHP 7.3 eller senare.

### Glömt lösenord

- **Lägenheter:** hyresvärden skapar ett nytt lösenord på startsidan.
- **Hyresvärden, utan SSH:** lägg en tom fil `aterstall.txt` i `data/`. Vid nästa besök på startsidan skapas ett nytt lösenord, som skrivs till `data/losenord.txt`.
- **Med SSH:** `php scripts/set-password.php admin [lösenord]` eller `php scripts/set-password.php pukevagen 3 [lösenord]`. Sätt `TVATT_APP_DIR` om `app/` ligger någon annanstans.

### Data och säkerhetskopiering

Säkerhetskopiera mappen `data/`. Där finns `site.json`, med fastigheterna och hyresvärdens inloggning, och `properties/<kortnamn>/db.json` för varje fastighet. Varje fastighet har egna lägenheter, bokningar, regler, kalenderlänkar och en egen anslagstavla.

## Utveckling

```sh
npm run dev    # http://localhost:8000 – startsidan på /, fastigheter på /<kortnamn>/
npm test       # tester i Node som körs mot PHP-servern (kräver php och node 18+)
npm run paket  # tvattstuga-webbhotell.zip med allt som ska upp på webbhotellet
```
