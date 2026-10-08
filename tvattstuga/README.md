# Tvättstugan – Stora Pukevägen 12

Bokningsverktyg för tvättstugan. Det är gjort för att köras på ett vanligt webbhotell med PHP, till exempel Simply.com, och kräver ingen databas. Det som laddas upp är innehållet i `public/`.

## Regler

- Ett pass är **4 timmar** och kan starta på valfri hel timme mellan **06:00 och 19:00**, så att det är klart senast **23:00**. Det gäller alla dagar.
- Varje lägenhet (**5 st**) har en egen inloggning.
- Man får ha **max 2 pass** bokade åt gången. Ett pass räknas tills det är slut, så när ett pass passerat kan man boka ett nytt.
- Pass får inte överlappa. Man kan boka upp till 28 dagar fram och avboka sina egna pass.

Reglerna och lägenheternas namn ställs in i `public/config.php`.

## Lägga upp på Simply (tvatt.indoor.net)

1. **Skapa underdomänen.** Gå till Simplys kontrollpanel för indoor.net och lägg till underdomänen `tvatt` med mappen `public_html/tvatt`. DNS behöver inte ändras, eftersom `*.indoor.net` redan pekar på webbhotellet.
2. **Ladda upp filerna.** Ladda upp **innehållet** i `public/` till `public_html/tvatt/`. Glöm inte den dolda filen `.htaccess`. Välj ett av sätten:
   - FTP: värd `ftp.simply.com`, användare `indoor.net`, lösenord = webbhotellets lösenord.
   - SFTP: `sftp indoor.net@ssh.simply.com`. Kräver att din SSH-nyckel är uppladdad i kontrollpanelen.
   - rsync: `rsync -avz public/ indoor.net@ssh.simply.com:public_html/tvatt/`
3. **Slå på HTTPS** (SSL) för tvatt.indoor.net i kontrollpanelen, om det inte redan är på. `.htaccess` skickar alla besökare till https.
4. **Hämta lösenorden.** Öppna https://tvatt.indoor.net en gång. Då skapas mappen `tvatt-data/` bredvid `public_html/`, alltså utanför webben. Hämta filen `tvatt-data/losenord.txt` via FTP/SFTP. Den innehåller ett lösenord per lägenhet. Dela ut dem och **radera sedan filen**. De boende kan byta lösenord själva i appen.

Kräver PHP 7.3 eller senare.

### Glömt lösenord

- **Utan SSH:** lägg en fil `aterstall.txt` i `tvatt-data/` som innehåller lägenhetens nummer, till exempel `3`, eller ordet `alla`. Vid nästa sidvisning får lägenheten ett nytt lösenord, som läggs till i `losenord.txt`. Samtidigt loggas lägenheten ut på alla enheter.
- **Med SSH:** kör `TVATT_PUBLIC_DIR=~/public_html/tvatt php set-password.php 3 [nytt lösenord]`, där `set-password.php` finns i `scripts/`.

### Data och säkerhetskopiering

Bokningar, lösenordshashar och den hemliga nyckeln för sessionerna ligger i `tvatt-data/db.json`. Säkerhetskopiera den filen. Om mappen bredvid `public_html` inte går att skriva till används `public_html/tvatt/data/` i stället. Den skyddas med `.htaccess`.

Uppdatera appen genom att ladda upp `public/` igen. Data ligger i en egen mapp och påverkas inte.

## Utveckling

```sh
npm run dev    # http://localhost:8000 (PHP:s inbyggda server)
npm test       # tester i Node som körs mot PHP-servern (kräver php och node 18+)
npm run paket  # zip-fil med allt som ska upp på webbhotellet
```
