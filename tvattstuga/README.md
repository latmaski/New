# Tvättstugan – Stora Pukevägen 12

Bokningsverktyg för tvättstugan. Det är gjort för att köras på ett vanligt webbhotell med PHP, till exempel Simply.com, och kräver ingen databas. Det som laddas upp är innehållet i `public/`.

## Regler

- Ett pass är **4 timmar** och kan starta på valfri hel timme mellan **06:00 och 19:00**, så att det är klart senast **23:00**. Det gäller alla dagar.
- Varje lägenhet (**5 st**) har en egen inloggning.
- Man får ha **max 2 pass** bokade åt gången. Ett pass räknas tills det är slut, så när ett pass passerat kan man boka ett nytt.
- Pass får inte överlappa. Man kan boka upp till 28 dagar fram och avboka sina egna pass.

Reglerna och lägenheternas namn ställs in i `public/config.php`.

## Hyresvärd (admin)

Under inloggningen finns länken *"Hyresvärd? Logga in här"*. Den leder till adminvyn, där hyresvärden kan:

- se **statistik** över hur många pass varje lägenhet har bokat, för denna månad, förra månaden, i år, de senaste 12 månaderna eller totalt, och hur många kommande pass varje lägenhet har.
- ge en lägenhet ett **nytt lösenord** om någon har glömt sitt eller flyttar. Lösenordet visas en gång och lägenheten loggas ut på alla enheter. Vid flytt kan man även kryssa i att lägenhetens kommande pass ska avbokas.
- byta sitt eget lösenord under "Byt lösenord".

Hyresvärden kan inte boka pass. Avbokade pass räknas inte i statistiken.

## Lägga upp på Simply (tvatt.indoor.net)

1. **Skapa underdomänen.** Gå till Simplys kontrollpanel för indoor.net och lägg till underdomänen `tvatt` med mappen `public_html/tvatt`. DNS behöver inte ändras, eftersom `*.indoor.net` redan pekar på webbhotellet.
2. **Ladda upp filerna.** Ladda upp **innehållet** i `public/` till `public_html/tvatt/`. Glöm inte den dolda filen `.htaccess`. Välj ett av sätten:
   - FTP: värd `ftp.simply.com`, användare `indoor.net`, lösenord = webbhotellets lösenord.
   - SFTP: `sftp indoor.net@ssh.simply.com`. Kräver att din SSH-nyckel är uppladdad i kontrollpanelen.
   - rsync: `rsync -avz public/ indoor.net@ssh.simply.com:public_html/tvatt/`
3. **Slå på HTTPS** (SSL) för tvatt.indoor.net i kontrollpanelen, om det inte redan är på. `.htaccess` skickar alla besökare till https.
4. **Hämta lösenorden.** Öppna https://tvatt.indoor.net en gång. Då skapas mappen `tvatt-data/` bredvid `public_html/`, alltså utanför webben. Hämta filen `tvatt-data/losenord.txt` via FTP/SFTP. Den innehåller ett lösenord per lägenhet och ett för hyresvärden. Dela ut dem och **radera sedan filen**. De boende kan byta lösenord själva i appen.

Kräver PHP 7.3 eller senare.

### Glömt lösenord

- **Enklast:** hyresvärden skapar ett nytt lösenord i adminvyn.
- **Om hyresvärden glömt sitt eget lösenord, utan SSH:** lägg en fil `aterstall.txt` i `tvatt-data/` som innehåller ordet `admin`. Det fungerar också med ett lägenhetsnummer, till exempel `3`, eller med `alla`. Vid nästa sidvisning skapas ett nytt lösenord, som läggs till i `losenord.txt`. Samtidigt loggas kontot ut på alla enheter.
- **Med SSH:** kör `TVATT_PUBLIC_DIR=~/public_html/tvatt php set-password.php admin [nytt lösenord]`, där `set-password.php` finns i `scripts/`.

### Data och säkerhetskopiering

Bokningar, lösenordshashar och den hemliga nyckeln för sessionerna ligger i `tvatt-data/db.json`. Säkerhetskopiera den filen. Om mappen bredvid `public_html` inte går att skriva till används `public_html/tvatt/data/` i stället. Den skyddas med `.htaccess`.

Uppdatera appen genom att ladda upp `public/` igen. Data ligger i en egen mapp och påverkas inte.

## Utveckling

```sh
npm run dev    # http://localhost:8000 (PHP:s inbyggda server)
npm test       # tester i Node som körs mot PHP-servern (kräver php och node 18+)
npm run paket  # zip-fil med allt som ska upp på webbhotellet
```
