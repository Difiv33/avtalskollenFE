# 🔍 Avtalskollen

En avtalsgranskare för privatpersoner. Klistra in en **hantverkaroffert**, ett **hyreskontrakt**, ett **gymavtal**, ett **avbetalningskontrakt** eller ett **abonnemang** (mobil, bredband, streaming m.m.), så pekar verktyget ut fällorna, förklarar dem och hänvisar till lagen.

## Kom igång

Webbsidan är helt statisk (HTML, CSS och JavaScript) och behöver ingen byggprocess.

- **Enklast:** dubbelklicka på `index.html`.
- **I VS Code:** installera tillägget *Live Server* (rekommenderas automatiskt när du öppnar mappen), högerklicka på `index.html` och välj **Open with Live Server**.

## Struktur

```
avtalskollen/
├── index.html        Sidans struktur och innehåll
├── css/styles.css    Utseende, mörkt läge, mobilanpassning och utskrift
├── exempel/
│   └── offert-badrum-exempel.pdf   Exempel-PDF att testa uppladdningen med
└── js/
    ├── rules.js      Regelbiblioteket: fällor, saknade skydd och bra klausuler
    ├── pdf.js        Läser ut text ur PDF-filer (med Mozillas pdf.js)
    ├── examples.js   Fem påhittade exempelavtal, ett per avtalstyp
    └── app.js        Analysmotor och gränssnitt
```

## PDF-stöd

En PDF kan dras och släppas i textrutan, klistras in som fil (Ctrl/Cmd + V) eller väljas med knappen **Ladda upp PDF / .txt**. Texten läses ut från alla sidor, rader som brutits av sidbredden fogas ihop till hela meningar och granskningen startar automatiskt.

- PDF-läsaren ([pdf.js](https://mozilla.github.io/pdf.js/)) hämtas från cdnjs, så sidan behöver internetanslutning för PDF-funktionen. Själva filen lämnar aldrig datorn.
- Inskannade PDF:er (bilder av papper) innehåller ingen text. Användaren får då ett meddelande om att köra OCR först.
- Lösenordsskyddade PDF:er stöds inte.

## Så fungerar analysen

1. **Avtalstyp** väljs manuellt eller känns igen automatiskt via nyckelord.
2. **Fällor** hittas med reguljära uttryck eller med `check()`-funktioner som tolkar siffror, t.ex. bindningstid i månader, förskott i procent eller deposition i antal månadshyror.
3. **Saknade skydd** flaggas när något viktigt inte nämns alls (t.ex. F-skatt eller ångerrätt).
4. **Bra klausuler** ger pluspoäng.
5. Poängen börjar på 100: allvarlig −15, varning −8, notera −3, saknas −4, bra +2.

### Lägga till en egen regel

Lägg till ett objekt i `traps`, `missing` eller `good` för rätt avtalstyp i `js/rules.js`:

```js
{
  id: 'min-regel',
  severity: 'medium',            // high | medium | low
  title: 'Kort rubrik',
  patterns: [/någon\s+formulering/gi],
  explanation: 'Varför det är en fälla.',
  advice: 'Vad användaren bör göra.',
  law: 'Lagrum',
  question: 'Fråga att ställa till motparten?'
}
```

## Integritet

All analys körs lokalt i webbläsaren. Ingen text skickas någonstans.

## Ansvarsfriskrivning

Informationen är generell och utgör inte juridisk rådgivning.
