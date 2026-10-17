/* =========================================================
   Avtalskollen – regelbibliotek
   ---------------------------------------------------------
   Varje regel har:
     id, severity ('high' | 'medium' | 'low' | 'ok'),
     title, explanation, advice, law, question
   och antingen
     patterns: [RegExp]  – träff = fynd
   eller
     check(text)         – returnerar { matches, severity?, title?, explanation? } eller null

   "missing"-regler slår till när INGET av mönstren hittas.
   "good"-regler markerar bra klausuler.
   ========================================================= */

(function () {
  'use strict';

  const WORD_NUMBERS = {
    en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7,
    åtta: 8, nio: 9, tio: 10, elva: 11, tolv: 12, arton: 18, tjugofyra: 24, trettiosex: 36
  };
  const NUM_ALT = '\\d+|en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|elva|tolv|arton|tjugofyra|trettiosex';
  const NUM = '(' + NUM_ALT + ')';          // vanlig fångstgrupp
  const NUM_N = '(?<n>' + NUM_ALT + ')';    // namngiven grupp: m.groups.n

  function toNumber(str) {
    if (str == null) return NaN;
    const s = String(str).toLowerCase().trim();
    if (WORD_NUMBERS[s] != null) return WORD_NUMBERS[s];
    return parseFloat(s.replace(/[\s .]/g, '').replace(',', '.'));
  }

  /** Alla träffar för ett regex som { start, end, m } */
  function findAll(text, regex) {
    const out = [];
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out.push({ start: m.index, end: m.index + m[0].length, m });
    }
    return out;
  }

  const has = (text, re) => new RegExp(re.source, re.flags.replace('g', '')).test(text);

  // ---------------------------------------------------------
  // Delade kontroller för löpande avtal (gym och abonnemang)
  // ---------------------------------------------------------

  /** Längsta bindningstid i månader. */
  function bindingInfo(text) {
    const hits = [
      ...findAll(text, new RegExp('bindning(?:stid(?:en)?|speriod(?:en)?)?[^.\\n]{0,30}?' + NUM_N + '\\s*(?<u>månader|mån|år)', 'gi')),
      ...findAll(text, new RegExp(NUM_N + '\\s*(?<u>månaders|års)\\s+bindning', 'gi'))
    ];
    let max = 0;
    for (const h of hits) {
      let n = toNumber(h.m.groups.n);
      if (/år/i.test(h.m.groups.u)) n *= 12;
      if (!isNaN(n)) max = Math.max(max, n);
    }
    return { hits, max };
  }

  /** Förlängningsklausuler, uppdelade i ny bindning (bad) och löpande fortsättning (ok). */
  function autoRenewInfo(text) {
    const hits = findAll(text, /(förlängs|förnyas|övergår|löper\s+vidare|fortsätter\s+att\s+gälla)[^.\n]{0,100}/gi);
    const bad = [], ok = [];
    for (const h of hits) {
      const s = h.m[0];
      const mm = s.match(new RegExp(NUM + '\\s*(månader|mån)', 'i'));
      const n = mm ? toNumber(mm[1]) : 0;
      if (/ny\s+bindning|samma\s+(period|bindning)|motsvarande\s+(period|tid)|ytterligare\s+(en\s+)?(bindnings)?period/i.test(s) || n > 1) bad.push(h);
      else if (/tillsvidare|löpande|månadsvis|en\s+månads|1\s+månads|utan\s+bindning/i.test(s)) ok.push(h);
      else if (/automatisk/i.test(s)) bad.push(h);
    }
    return { bad, ok };
  }

  /** Längsta uppsägningstid i månader. */
  function noticeInfo(text) {
    const hits = findAll(text, new RegExp('uppsägning(?:stid(?:en)?)?[^.\\n]{0,40}?' + NUM_N + '\\s*(?:kalender)?(?:månad(?:er)?|mån)', 'gi'));
    return { hits, max: hits.length ? Math.max(...hits.map(h => toNumber(h.m.groups.n))) : 0 };
  }

  /** Klausuler om prisändring och om du får säga upp när priset höjs. */
  function priceChangeInfo(text) {
    const hits = [
      ...findAll(text, /(förbehåller\s+sig|äger|har)\s+rätt(en)?\s+att[^.\n]{0,30}(ändra|höja|justera|indexera)[^.\n]{0,30}(pris|avgift|medlemsavgift|månadsavgift|abonnemangsavgift)[^.\n]{0,120}/gi),
      ...findAll(text, /(pris(et|erna)?|avgift(en|erna)?|månadsavgift(en)?|månadskostnad(en)?)\s+kan\s+(komma\s+att\s+)?(ändras|höjas|justeras|indexeras)[^.\n]{0,120}/gi),
      ...findAll(text, /prisjustering|årlig\s+(prisjustering|indexering|uppräkning)/gi)
    ];
    const canCancel = hits.some(h => /säga\s+upp|uppsägning|frånträda|avsluta/i.test(text.slice(h.start, h.end + 150)));
    return { hits, canCancel };
  }

  // =========================================================
  // GEMENSAMMA REGLER (gäller alla avtalstyper)
  // =========================================================
  const common = {
    traps: [
      {
        id: 'skiljeforfarande',
        severity: 'high',
        title: 'Tvister ska avgöras genom skiljeförfarande',
        patterns: [/skiljeförfarande|skiljedom|skiljenämnd/gi],
        explanation: 'Skiljeförfarande är dyrt (ofta hundratusentals kronor) och stänger i praktiken dörren till ARN och allmän domstol.',
        advice: 'En skiljeklausul som avtalats i förväg är inte bindande för dig som konsument. Du kan ändå vända dig till ARN eller tingsrätten. Be att klausulen stryks.',
        law: 'Lag (1999:116) om skiljeförfarande, 6 §',
        question: 'Kan ni stryka klausulen om skiljeförfarande så att tvister prövas av ARN eller allmän domstol?'
      },
      {
        id: 'ensidig-andring',
        severity: 'high',
        title: 'Motparten får ändra villkoren ensidigt',
        patterns: [
          /(förbehåller sig|äger|har|ges)\s+(rätt(en)?|möjlighet(en)?)\s+att\s+(när som helst\s+|ensidigt\s+)?(ändra|justera|uppdatera|komplettera)\s+(dessa\s+|avtalets\s+|samtliga\s+)?(avtals)?villkor(en)?/gi,
          /villkoren\s+kan\s+(komma\s+att\s+)?(ändras|justeras|uppdateras)\s+(när som helst|utan\s+(föregående\s+)?(meddelande|avisering|förvarning))/gi
        ],
        explanation: 'Om motparten kan ändra villkoren när som helst vet du egentligen inte vad du skriver på.',
        advice: 'Kräv att ändringar meddelas i god tid (minst 30 dagar) och att du får säga upp avtalet utan kostnad om du inte godtar ändringen.',
        law: 'Lag (1994:1512) om avtalsvillkor i konsumentförhållanden; 36 § avtalslagen',
        question: 'Hur och när meddelas villkorsändringar, och får jag säga upp avtalet kostnadsfritt om jag inte godtar dem?'
      },
      {
        id: 'tolkningsforetrade',
        severity: 'medium',
        title: 'Motparten har tolkningsföreträde',
        patterns: [/tolkningsföreträde|(företaget|leverantören|uthyraren|hyresvärden|entreprenören)s?\s+tolkning\s+(ska\s+)?gäll(a|er)/gi],
        explanation: 'Klausulen ger motparten rätt att bestämma vad avtalet betyder vid oenighet.',
        advice: 'I konsumentavtal gäller oklarhetsregeln: otydliga villkor ska tolkas till din fördel. Klausulen är därför tveksam – be om att den stryks.',
        law: '10 § lag (1994:1512) om avtalsvillkor i konsumentförhållanden',
        question: 'Varför ska ni ha tolkningsföreträde? Kan klausulen strykas?'
      },
      {
        id: 'avgifter',
        severity: 'low',
        title: 'Extra administrativa avgifter',
        patterns: [/(påminnelseavgift|faktureringsavgift|fakturaavgift|aviavgift|administrationsavgift|expeditionsavgift|hanteringsavgift|pappersfakturaavgift)/gi],
        explanation: 'Små avgifter kan summera till betydande belopp över avtalstiden.',
        advice: 'Påminnelseavgift får bara tas ut om den avtalats i förväg och är högst 60 kr. Fråga vad varje avgift kostar och om den går att undvika (t.ex. med e-faktura).',
        law: 'Lag (1981:739) om ersättning för inkassokostnader m.m.',
        question: 'Vilka avgifter kan tillkomma utöver grundpriset, och hur stora är de?'
      },
      {
        id: 'drojsmalsranta',
        severity: 'medium',
        title: 'Hög dröjsmålsränta',
        check(text) {
          // Bara ränta vid sen betalning – inte avbetalningens vanliga kreditränta
          const hits = findAll(text, /(dröjsmålsränta|förseningsränta|ränta\s+vid\s+(?:försenad|sen|utebliven)\s+betalning)[^.\n]{0,40}?(\d+(?:[,.]\d+)?)\s*%[^.\n]{0,25}/gi);
          const bad = [];
          let severity = 'medium';
          for (const h of hits) {
            const pct = toNumber(h.m[2]);
            const perMonth = /per\s+månad|i\s+månaden|\/\s*mån|månatlig/i.test(h.m[0]);
            if (perMonth) { bad.push(h); severity = 'high'; }
            else if (pct > 20) bad.push(h);
          }
          return bad.length ? { matches: bad, severity } : null;
        },
        explanation: 'Räntelagens dröjsmålsränta är referensräntan + 8 procentenheter (oftast runt 10–12 % per år). Ränta per månad eller över 20 % per år är mycket högt.',
        advice: 'Ifrågasätt räntan. Ett oskäligt högt ränteuttag kan jämkas enligt 36 § avtalslagen.',
        law: 'Räntelagen (1975:635) 6 §; 36 § avtalslagen',
        question: 'Varför är dröjsmålsräntan högre än räntelagens nivå?'
      },
      {
        id: 'muntligt',
        severity: 'low',
        title: 'Muntliga löften gäller inte',
        patterns: [/muntliga\s+(löften|överenskommelser|utfästelser|avtal)[^.\n]{0,60}(gäller\s+(inte|ej)|är\s+(inte|ej)\s+(giltiga|bindande)|saknar\s+verkan)/gi],
        explanation: 'Det säljaren har lovat dig muntligt kan bli värdelöst.',
        advice: 'Se till att allt du har kommit överens om – priser, tider, vad som ingår – skrivs in i avtalet innan du skriver på.',
        law: 'Allmänna avtalsrättsliga principer',
        question: 'Kan ni skriva in det vi har pratat om muntligt (pris, tider, omfattning) i avtalet?'
      },
      {
        id: 'overlatelse',
        severity: 'low',
        title: 'Avtalet kan överlåtas till någon annan',
        patterns: [/(rätt\s+att\s+)?överlåta\s+(avtalet|detta\s+avtal|sina\s+rättigheter)[^.\n]{0,60}(utan\s+(ditt|kundens|medlemmens|hyresgästens)\s+(samtycke|godkännande))?/gi],
        explanation: 'Motparten kan sälja avtalet (eller fordran) till ett annat bolag, t.ex. ett inkassoföretag.',
        advice: 'Kontrollera att dina rättigheter och invändningar följer med om avtalet överlåts.',
        law: '29 § skuldebrevslagen',
        question: 'Vad händer med mina rättigheter om ni överlåter avtalet?'
      }
    ],
    missing: [],
    good: [
      {
        id: 'arn',
        title: 'Hänvisar till ARN',
        patterns: [/allmänna\s+reklamationsnämnden/gi, /\bARN\b/g],
        explanation: 'Bra! Avtalet nämner att tvister kan prövas av ARN – gratis för dig.'
      }
    ]
  };

  // =========================================================
  // HANTVERKAROFFERTER
  // =========================================================
  const hantverkare = {
    name: 'Hantverkaroffert',
    icon: '🔨',
    keywords: [/offert/gi, /hantverk/gi, /entreprenör/gi, /\bROT\b|rot-?avdrag/gi, /renover/gi, /badrum/gi, /arbetskostnad/gi, /material/gi,
      /konsumenttjänstlag/gi, /hantverkarformulär/gi, /tilläggsarbete|ÄTA/gi, /slutbesiktning/gi, /timpris|timdebitering/gi, /målning|snickeri|vvs|el-?arbete|kakel|plattsättning/gi],
    traps: [
      {
        id: 'lopande-rakning',
        severity: 'high',
        title: 'Löpande räkning utan takpris',
        check(text) {
          const hits = findAll(text, /löpande\s+räkning|debiteras\s+löpande|efter\s+nedlagd\s+tid|enligt\s+(faktisk|åtgången)\s+tid|per\s+påbörjad\s+timme/gi);
          if (!hits.length) return null;
          const cap = has(text, /takpris|maxpris|tak\s+på|högst\s+\d|ej\s+överstiga|inte\s+överstiga|kostnadstak/gi);
          return cap
            ? { matches: hits, severity: 'low', title: 'Löpande räkning – men med takpris',
                explanation: 'Arbetet debiteras löpande, men det verkar finnas ett tak. Kontrollera att taket gäller hela arbetet inklusive material.' }
            : { matches: hits };
        },
        explanation: 'Vid löpande räkning betalar du för all tid som läggs ner – utan övre gräns. Det är den vanligaste orsaken till skenande hantverkarkostnader.',
        advice: 'Begär fast pris eller ett takpris ("totalt pris får inte överstiga X kr inkl. moms"). Be också om en uppskattning av antal timmar.',
        law: '36–37 §§ konsumenttjänstlagen (1985:716)',
        question: 'Kan ni ge ett fast pris eller ett takpris för hela arbetet, inklusive material och moms?'
      },
      {
        id: 'ungefarligt-pris',
        severity: 'medium',
        title: 'Priset är bara ungefärligt',
        patterns: [/ungefärligt?\s+pris|cirkapris|ca[.\s]+pris|uppskattad\s+(kostnad|totalkostnad)|preliminärt?\s+pris|prisuppskattning|riktpris|beräknad\s+kostnad/gi],
        explanation: 'Ett ungefärligt pris får enligt lag överskridas med högst 15 % – men bara om inget annat avtalats. Många offerter försöker kringgå regeln.',
        advice: 'Kontrollera att det inte står att 15 %-regeln inte gäller. Ännu bättre: be om fast pris.',
        law: '36 § konsumenttjänstlagen',
        question: 'Hur mycket kan slutpriset som mest avvika från det ungefärliga priset?'
      },
      {
        id: 'prisjustering',
        severity: 'high',
        title: 'Hantverkaren får höja priset',
        patterns: [
          /(förbehåller\s+sig|äger)\s+rätt(en)?\s+att\s+(justera|ändra|höja|reglera)\s+(priset|priser|kostnaden|offertbeloppet)/gi,
          /(pris(et|erna)?|kostnad(en|erna)?)\s+kan\s+(komma\s+att\s+)?(justeras|ändras|höjas|regleras)/gi,
          /prisjustering|indexreglering|materialprisförändring|vid\s+(ändrade|höjda)\s+materialpriser/gi
        ],
        explanation: 'Klausulen gör det offererade priset osäkert – du kan få en betydligt högre faktura.',
        advice: 'Be att klausulen stryks eller begränsas (t.ex. "endast vid dokumenterade prishöjningar hos grossist, max 5 %").',
        law: '36 § konsumenttjänstlagen; 36 § avtalslagen',
        question: 'Under vilka omständigheter kan priset höjas, och med hur mycket som mest?'
      },
      {
        id: 'forskott',
        severity: 'medium',
        title: 'Betalning i förskott',
        check(text) {
          const hits = findAll(text, /(förskott|förskottsbetalning|i\s+förväg|vid\s+(avtalets\s+)?(under)?tecknande|innan\s+arbetet\s+(påbörjas|startar|inleds)|vid\s+beställning|handpenning)[^.\n]{0,100}/gi);
          if (!hits.length) return null;
          let max = 0;
          for (const h of hits) {
            const around = text.slice(Math.max(0, h.start - 80), h.end);
            for (const p of around.matchAll(/(\d{1,3})\s*%/g)) max = Math.max(max, +p[1]);
          }
          if (max >= 30) return { matches: hits, severity: 'high', title: `Stort förskott (${max} %)` };
          return { matches: hits };
        },
        explanation: 'Om företaget går i konkurs eller försvinner är förskottet troligen förlorat. Förskott är dessutom ett vanligt kännetecken för oseriösa hantverkare.',
        advice: 'Betala i efterskott eller i takt med utfört arbete. Max 10–20 % i förskott, och då helst mot faktura till ett företag med F-skatt.',
        law: '40 § konsumenttjänstlagen (betalning när tjänsten är utförd)',
        question: 'Kan vi ha en betalningsplan där jag betalar i takt med utfört arbete i stället för i förskott?'
      },
      {
        id: 'friskrivning',
        severity: 'high',
        title: 'Hantverkaren friskriver sig från ansvar',
        patterns: [
          /(ansvarar|svarar)\s+(inte|ej)\s+för/gi,
          /friskriv(er|ning|s)/gi,
          /(inget|ingen|utan)\s+(ansvar|garanti)/gi,
          /lämnas\s+(inte|ej)\s+(någon\s+)?garanti/gi
        ],
        explanation: 'En hantverkare kan inte avtala bort sitt ansvar för fel i arbetet gentemot en konsument. Villkor som säger det är ogiltiga – men visar hur företaget tänker.',
        advice: 'Påpeka att konsumenttjänstlagen är tvingande. Be dem stryka klausulen, eller välj en annan hantverkare.',
        law: '3 § konsumenttjänstlagen (tvingande lag)',
        question: 'Varför friskriver ni er från ansvar, när konsumenttjänstlagen ger mig rätt att reklamera fel?'
      },
      {
        id: 'garanti-kort',
        severity: 'medium',
        title: 'Kort garantitid',
        check(text) {
          const hits = findAll(text, new RegExp('garanti(?:tid(?:en)?)?[^.\\n]{0,40}?' + NUM_N + '\\s*(?<u>år|månad(?:er)?|mån)', 'gi'));
          const bad = hits.filter(h => {
            let n = toNumber(h.m.groups.n);
            if (/år/i.test(h.m.groups.u)) n *= 12;
            return n < 24;
          });
          return bad.length ? { matches: bad } : null;
        },
        explanation: 'En kort garanti kan få dig att tro att du inte kan klaga efter garantitiden. Det stämmer inte.',
        advice: 'Oavsett garanti kan du reklamera fel i upp till 3 år, och 10 år för arbete på byggnad eller mark. Fel som visar sig inom 6 månader antas ha funnits från början.',
        law: '17 § konsumenttjänstlagen',
        question: 'Kan garantin förlängas till minst 2 år, och bekräftar ni att min reklamationsrätt enligt lag gäller utöver garantin?'
      },
      {
        id: 'tillaggsarbeten',
        severity: 'medium',
        title: 'Tilläggsarbeten utan krav på skriftligt godkännande',
        check(text) {
          const hits = findAll(text, /(ÄTA-?arbete(n)?|ändrings-?\s+och\s+tilläggsarbete(n)?|tilläggsarbete(n)?|extraarbete(n)?|tillkommande\s+arbete(n)?|merarbete(n)?|oförutsedda\s+(arbeten|kostnader))[^.\n]{0,140}/gi);
          if (!hits.length) return null;
          const bad = hits.filter(h => !/skriftlig|godkän|i\s+förväg|före\s+utförande/i.test(h.m[0]));
          return bad.length ? { matches: bad } : null;
        },
        explanation: 'Utan krav på skriftligt godkännande kan extraarbeten läggas till på fakturan i efterhand.',
        advice: 'Skriv in att alla tilläggsarbeten ska prissättas och godkännas skriftligt (sms/mejl räcker) innan de utförs.',
        law: '8 § konsumenttjänstlagen (tilläggsarbeten)',
        question: 'Kan vi skriva in att inga tilläggsarbeten utförs eller debiteras utan mitt skriftliga godkännande i förväg?'
      },
      {
        id: 'dolda-kostnader',
        severity: 'medium',
        title: 'Kostnader som tillkommer',
        patterns: [
          /(material|resekostnad(er)?|reseersättning|framkörning|etablering(skostnad)?|bilersättning|milersättning|avfallshantering|container|bortforsling|förbrukningsmaterial|maskinhyra|ställning(shyra)?|transport(er)?|parkering(savgift)?|moms)[^.\n]{0,40}(tillkommer|debiteras\s+(separat|extra|tillkommande)|ingår\s+(ej|inte))/gi,
          /exklusive\s+moms|exkl\.?\s+moms|ex\.?\s+moms/gi
        ],
        explanation: 'Offerten verkar inte inkludera alla kostnader. Det som "tillkommer" kan bli en stor del av slutsumman.',
        advice: 'Be om ett totalpris inklusive moms, material, resor, avfall och allt annat. Fråga vad varje tillkommande post uppskattas kosta.',
        law: 'Prisinformationslagen (2004:347); 36 § konsumenttjänstlagen',
        question: 'Vad blir totalpriset inklusive moms, material, resor och bortforsling?'
      },
      {
        id: 'rot-risk',
        severity: 'high',
        title: 'Du får betala om ROT-avdraget nekas',
        patterns: [/(rot-?avdrag(et)?|skattereduktion(en)?|\bROT\b)[^.\n]{0,120}(nekas|ej\s+godkänn|inte\s+godkänn|beviljas\s+(inte|ej)|avslås|återkrävs|underkänn)/gi,
          /(nekas|avslås|underkänns)[^.\n]{0,40}(rot-?avdrag|skattereduktion|\bROT\b)/gi],
        explanation: 'Om Skatteverket nekar ROT-avdraget kan du bli skyldig att betala mellanskillnaden – ofta 30 % av arbetskostnaden.',
        advice: 'Kontrollera själv att du har ROT-utrymme kvar på skatteverket.se. Se till att arbetskostnaden är tydligt särredovisad från material.',
        law: 'Inkomstskattelagen 67 kap.; lag (2009:194) om förfarandet vid skattereduktion för hushållsarbete',
        question: 'Hur stor del av priset är arbetskostnad (som ger ROT) respektive material?'
      },
      {
        id: 'avbestallning',
        severity: 'medium',
        title: 'Avbeställningsavgift',
        patterns: [/avbeställ(ning|er|s)?[^.\n]{0,80}(avgift|ersättning|debiteras|\d+\s*%)|avbokningsavgift|avbeställningsavgift/gi],
        explanation: 'Du har rätt att avbeställa ett hantverksarbete. Hantverkaren får då bara ersättning för redan utfört arbete och faktisk förlust – inte en fast "straffavgift".',
        advice: 'En schablonavgift som är högre än hantverkarens verkliga förlust kan vara oskälig. Be om att avgiften tas bort eller sänks.',
        law: '42 § konsumenttjänstlagen',
        question: 'Hur beräknas avbeställningsavgiften, och motsvarar den er faktiska kostnad?'
      },
      {
        id: 'svartjobb',
        severity: 'high',
        title: 'Tecken på svartjobb eller oseriös firma',
        patterns: [/kontant(betalning)?|utan\s+kvitto|utan\s+faktura|swish\s+till\s+(mitt|privat)|privat\s+konto|svartjobb|svart\s+arbete|betalas\s+svart|utan\s+moms/gi],
        explanation: 'Kontant- eller privatbetalning gör det mycket svårt att reklamera fel – och du förlorar ROT-avdraget och försäkringsskyddet.',
        advice: 'Betala endast mot faktura till ett företag med F-skatt. Kontrollera organisationsnumret på verksamt.se eller allabolag.se.',
        law: 'Skattebrottslagen; konsumenttjänstlagen',
        question: 'Kan jag få en korrekt faktura med organisationsnummer, F-skattebevis och särredovisad moms?'
      },
      {
        id: 'forsening',
        severity: 'medium',
        title: 'Hantverkaren ansvarar inte för förseningar',
        patterns: [/(förseningar|försening|dröjsmål)[^.\n]{0,60}(ansvarar\s+(inte|ej)|ersätts\s+(inte|ej)|berättigar\s+(inte|ej)|ger\s+(inte|ej)\s+rätt)/gi,
          /tidplanen\s+är\s+(preliminär|ungefärlig|ej\s+bindande|inte\s+bindande)/gi],
        explanation: 'Vid försening har du normalt rätt att hålla inne betalning, kräva prisavdrag, skadestånd eller häva avtalet.',
        advice: 'Kräv en bindande sluttid, gärna med ett vite per dag vid försening.',
        law: '28–33 §§ konsumenttjänstlagen',
        question: 'Kan vi avtala om en bindande sluttid och vad som händer om den inte hålls?'
      }
    ],
    missing: [
      {
        id: 'saknar-pris',
        title: 'Inget fast pris eller takpris',
        patterns: [/fast\s+pris|fastpris|takpris|maxpris|totalpris|kostnadstak|pris\s+totalt/gi],
        explanation: 'Offerten verkar sakna ett tydligt totalpris.',
        advice: 'Be om fast pris eller takpris inklusive moms.',
        question: 'Vad är det totala, fasta priset inklusive moms?'
      },
      {
        id: 'saknar-tid',
        title: 'Ingen start- eller sluttid',
        patterns: [/sluttid|färdigställ|klart\s+(senast|den|vecka)|slutdatum|startdatum|påbörjas\s+(den|vecka|senast)|vecka\s+\d{1,2}|\d{1,2}\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)|\d{4}-\d{2}-\d{2}/gi],
        explanation: 'Utan avtalade tider är det svårt att kräva något vid försening.',
        advice: 'Skriv in start- och slutdatum.',
        question: 'När påbörjas arbetet och när ska det vara klart?'
      },
      {
        id: 'saknar-fskatt',
        title: 'F-skatt och organisationsnummer nämns inte',
        patterns: [/f-?skatt|organisationsnummer|org\.?\s*nr|orgnr/gi],
        explanation: 'Utan F-skatt kan du bli ansvarig för arbetsgivaravgifter och får inget ROT-avdrag.',
        advice: 'Kontrollera F-skatt på skatteverket.se.',
        question: 'Vad är ert organisationsnummer och har ni F-skatt?'
      },
      {
        id: 'saknar-forsakring',
        title: 'Ingen ansvarsförsäkring nämns',
        patterns: [/ansvarsförsäkring|försäkring/gi],
        explanation: 'Om hantverkaren orsakar en vattenskada vill du att deras försäkring betalar – inte din hemförsäkring.',
        advice: 'Be om bevis på ansvarsförsäkring.',
        question: 'Har ni en ansvarsförsäkring, och kan jag få ett försäkringsbevis?'
      },
      {
        id: 'saknar-omfattning',
        title: 'Arbetets omfattning är otydlig',
        patterns: [/omfattning|arbetsbeskrivning|i\s+priset\s+ingår|ingår\s+i\s+(priset|offerten|arbetet)|följande\s+(arbete|moment)|specifikation/gi],
        explanation: 'Det är svårt att reklamera ett arbete om det inte står vad som ska göras.',
        advice: 'Be om en detaljerad arbetsbeskrivning med material och moment.',
        question: 'Kan ni specificera exakt vilka moment och material som ingår?'
      }
    ],
    good: [
      { id: 'bra-fastpris', title: 'Fast pris eller takpris', patterns: [/fast\s+pris|fastpris|takpris|maxpris|kostnadstak/gi],
        explanation: 'Bra! Ett fast pris eller takpris ger dig förutsägbarhet.' },
      { id: 'bra-formular', title: 'Hantverkarformuläret / konsumenttjänstlagen', patterns: [/hantverkarformuläret\s*\d*|konsumenttjänstlagen/gi],
        explanation: 'Bra! Hantverkarformuläret 17 är ett balanserat standardavtal framtaget av Konsumentverket och branschen.' },
      { id: 'bra-skriftligt', title: 'Tilläggsarbeten kräver skriftligt godkännande', patterns: [/(tilläggsarbete|ÄTA|extraarbete)[^.\n]{0,100}(skriftlig|godkän)/gi],
        explanation: 'Bra! Tilläggsarbeten ska godkännas skriftligt.' },
      { id: 'bra-efterskott', title: 'Betalning i efterskott', patterns: [/i\s+efterskott|efter\s+(godkänd\s+)?slutbesiktning|efter\s+utfört\s+arbete|när\s+arbetet\s+är\s+(slutfört|klart)/gi],
        explanation: 'Bra! Du betalar först när arbetet är utfört.' },
      { id: 'bra-fskatt', title: 'F-skatt anges', patterns: [/f-?skatt/gi], explanation: 'Bra! Företaget anger att de har F-skatt.' }
    ]
  };

  // =========================================================
  // HYRESKONTRAKT
  // =========================================================
  const hyra = {
    name: 'Hyreskontrakt',
    icon: '🏠',
    keywords: [/hyr(a|an|es|esgäst|esvärd|eskontrakt|esavtal)/gi, /uthyr/gi, /lägenhet/gi, /bostad/gi, /andrahand/gi, /deposition/gi,
      /besittningsskydd/gi, /hyreslagen|12\s+kap/gi, /inflytt|avflytt/gi, /bostadsrättsförening/gi, /kvadratmeter|kvm|m²/gi, /tillträde/gi],
    traps: [
      {
        id: 'besittningsskydd',
        severity: 'high',
        title: 'Du avstår från besittningsskyddet',
        patterns: [/(avstå|avstår|avsäger|avsäga|avstått)[^.\n]{0,50}besittningsskydd/gi,
          /besittningsskydd(et)?[^.\n]{0,50}(avtalas\s+bort|gäller\s+(inte|ej)|föreligger\s+(inte|ej)|är\s+avtalat\s+bort)/gi],
        explanation: 'Besittningsskyddet ger dig rätt att bo kvar. Utan det kan du tvingas flytta när avtalet löper ut. Vid andrahandsuthyrning finns inget besittningsskydd de första två åren, men för förstahandskontrakt krävs normalt hyresnämndens godkännande för att avstå.',
        advice: 'Fråga om avståendet är godkänt av hyresnämnden. Saknas godkännande är klausulen sannolikt ogiltig (förstahand).',
        law: '12 kap. 45 § och 45 a § jordabalken',
        question: 'Är avståendet från besittningsskydd godkänt av hyresnämnden, och i så fall kan jag få se beslutet?'
      },
      {
        id: 'uppsagningstid-hyra',
        severity: 'high',
        title: 'Felaktig uppsägningstid',
        check(text) {
          const hits = findAll(text, new RegExp('uppsägning(?:stid(?:en)?)?[^.\\n]{0,50}?' + NUM_N + '\\s*(?:kalender)?(?:månad(?:er)?|mån)', 'gi'));
          const longer = hits.filter(h => toNumber(h.m.groups.n) > 3);
          const shorter = hits.filter(h => toNumber(h.m.groups.n) < 3);
          if (longer.length) {
            return { matches: longer, title: 'Längre uppsägningstid än 3 månader',
              explanation: 'För en bostad som hyrs på obestämd tid är din uppsägningstid som hyresgäst högst tre kalendermånader – oavsett vad som står i avtalet.' };
          }
          if (shorter.length) {
            return { matches: shorter, severity: 'medium', title: 'Kortare uppsägningstid än 3 månader',
              explanation: 'Om detta gäller hyresvärdens uppsägning är det för kort. Hyresvärden måste normalt säga upp med minst tre kalendermånader (privatuthyrning: tre månader).' };
          }
          return null;
        },
        explanation: '',
        advice: 'Hyreslagen är tvingande till din förmån. Längre uppsägningstid för dig, eller kortare för hyresvärden, gäller inte.',
        law: '12 kap. 4 § jordabalken; 3 § privatuthyrningslagen',
        question: 'Bekräftar ni att uppsägningstiden är tre kalendermånader enligt hyreslagen?'
      },
      {
        id: 'deposition',
        severity: 'medium',
        title: 'Deposition',
        check(text) {
          const amountRe = /(\d{1,3}(?:[  .]\d{3})+|\d{3,6})\s*(kr|kronor|:-|sek)/i;
          const depHits = findAll(text, /deposition(en)?[^\n]{0,100}/gi);
          if (!depHits.length) return null;

          let months = null;
          for (const h of depHits) {
            const mm = h.m[0].match(new RegExp(NUM + '\\s*(månadshyr|månaders\\s+hyra|månader)', 'i'));
            if (mm) { months = toNumber(mm[1]); break; }
          }
          if (months == null) {
            let dep = null;
            for (const h of depHits) { const a = h.m[0].match(amountRe); if (a) { dep = toNumber(a[1]); break; } }
            const rentHits = findAll(text, /(månadshyra|hyran|hyra)[^.\n]{0,60}?(\d{1,3}(?:[  .]\d{3})+|\d{3,6})\s*(kr|kronor|:-|sek)/gi)
              .filter(r => !/deposition|förskott/i.test(r.m[0]));
            const rent = rentHits.length ? toNumber(rentHits[0].m[2]) : null;
            if (dep && rent) months = dep / rent;
          }

          const pre = has(text, /(deposition|hyra)[^.\n]{0,80}(innan|före)\s+(visning|kontraktsskrivning|nyckel|vi\s+ses|du\s+fått)/gi);
          if (pre) return { matches: depHits, severity: 'high', title: 'Deposition ska betalas innan visning/nycklar – bluffvarning!',
            explanation: 'Att kräva betalning innan du sett lägenheten eller fått nycklar är ett klassiskt tecken på hyresbedrägeri.' };
          if (months != null && months > 3) return { matches: depHits, severity: 'high', title: `Mycket hög deposition (≈ ${Math.round(months * 10) / 10} månadshyror)`,
            explanation: 'Deposition på mer än tre månadshyror är ovanligt hög och binder mycket av dina pengar.' };
          if (months != null) return { matches: depHits, severity: 'low', title: `Deposition (≈ ${Math.round(months * 10) / 10} månadshyror)`,
            explanation: 'Depositionen ligger på en vanlig nivå. Se till att det står när och hur den betalas tillbaka.' };
          return { matches: depHits, severity: 'low', explanation: 'Avtalet innehåller en deposition. Kontrollera beloppet och villkoren för återbetalning.' };
        },
        explanation: '',
        advice: 'Betala depositionen till ett konto i uthyrarens namn – aldrig kontant eller via utländska betaltjänster. Kräv att det står när depositionen ska återbetalas och vad den får användas till.',
        law: 'Allmänna avtalsrättsliga principer; 36 § avtalslagen',
        question: 'När och hur betalas depositionen tillbaka, och vad får den användas till?'
      },
      {
        id: 'hyreshojning',
        severity: 'high',
        title: 'Hyresvärden får höja hyran ensidigt',
        patterns: [
          /(hyresvärden|uthyraren|upplåtaren)[^.\n]{0,40}(har\s+rätt\s+att|får|äger\s+rätt\s+att|kan)[^.\n]{0,30}(höja|ändra|justera)[^.\n]{0,20}hyr/gi,
          /hyran\s+kan\s+(komma\s+att\s+)?(höjas|ändras|justeras)[^.\n]{0,40}(när\s+som\s+helst|utan|ensidigt|vid\s+behov)/gi
        ],
        explanation: 'Hyresvärden kan inte ensidigt höja hyran mitt i avtalsperioden. Höjningar kräver förhandling, en giltig indexklausul eller beslut av hyresnämnden.',
        advice: 'Be om att klausulen stryks. Vid privatuthyrning får hyran inte överstiga kapitalkostnad + driftkostnad.',
        law: '12 kap. 54–55 §§ jordabalken; 4 § privatuthyrningslagen',
        question: 'Hur och när kan hyran ändras under avtalstiden?'
      },
      {
        id: 'underhall',
        severity: 'high',
        title: 'Du ansvarar för allt underhåll',
        patterns: [/hyresgäst(en)?[^.\n]{0,40}(ansvarar|står|svarar|bekostar)[^.\n]{0,20}(för\s+)?(allt|samtliga|alla|samtligt)\s+(underhåll|reparationer|reparation)/gi,
          /(allt|samtligt)\s+(inre\s+)?underhåll[^.\n]{0,40}(hyresgäst|bekostas\s+av\s+hyresgäst)/gi],
        explanation: 'Hyresvärden är skyldig att hålla lägenheten i godtagbart skick. Du ansvarar bara för skador du själv orsakar genom vårdslöshet.',
        advice: 'Be om att klausulen ändras till att du endast ansvarar för skador som du orsakat.',
        law: '12 kap. 15–16 §§ och 24 § jordabalken',
        question: 'Vilket underhåll ansvarar jag för, och vad ansvarar hyresvärden för?'
      },
      {
        id: 'slitage',
        severity: 'high',
        title: 'Du ska betala för normalt slitage',
        patterns: [/(inklusive|inkl\.?|även|också)\s+(för\s+)?(normalt\s+)?slitage/gi,
          /(normalt|vanligt|allt)\s+slitage[^.\n]{0,60}(ersätt|betal|bekost|står\s+hyresgäst|debiteras)/gi],
        explanation: 'Normalt slitage ingår i hyran. Du behöver inte betala för att golv slits eller väggar bleknar.',
        advice: 'Stryk klausulen och gör ett inflyttningsprotokoll med foton.',
        law: '12 kap. 24 § jordabalken',
        question: 'Kan vi stryka klausulen om slitage och göra ett gemensamt besiktningsprotokoll vid inflyttning?'
      },
      {
        id: 'tilltrade',
        severity: 'high',
        title: 'Hyresvärden får gå in när som helst',
        patterns: [/(hyresvärden|uthyraren|upplåtaren)[^.\n]{0,40}(tillträde|gå\s+in|komma\s+in|nyckel|besöka)[^.\n]{0,60}(när\s+som\s+helst|utan\s+(föregående\s+)?(avisering|meddelande|förvarning)|utan\s+att\s+meddela)/gi],
        explanation: 'Hyresvärden får bara gå in i lägenheten för tillsyn eller nödvändiga arbeten – och då efter avisering, utom vid akuta fall.',
        advice: 'Kräv att tillträde aviseras i förväg (minst 24 timmar) utom vid akuta situationer.',
        law: '12 kap. 26 § jordabalken',
        question: 'Kan vi skriva in att tillträde till lägenheten alltid aviseras i förväg utom vid akuta fall?'
      },
      {
        id: 'gaster',
        severity: 'medium',
        title: 'Begränsningar för gäster eller sambo',
        patterns: [/(inte|ej|förbjudet|förbjuds|tillåts\s+inte|ej\s+tillåtet)[^.\n]{0,40}(övernatt|gäster|sambo|inneboende|besök|partner)/gi,
          /(gäster|besök|övernattning)[^.\n]{0,40}(inte|ej)\s+(tillåtna|tillåten|tillåtet|tillåts)/gi],
        explanation: 'Att ha gäster ingår i rätten att använda bostaden. Totalförbud mot gäster är oskäligt. Inneboende får du ha om det inte medför men för hyresvärden.',
        advice: 'Fråga vad klausulen innebär i praktiken och be om att den mjukas upp.',
        law: '12 kap. 41 § jordabalken',
        question: 'Vad gäller för gäster, övernattningar och en eventuell sambo?'
      },
      {
        id: 'vite',
        severity: 'medium',
        title: 'Vite eller straffavgift',
        patterns: [/\bvite\b|straffavgift|böter|bötesbelopp|kontraktsbrottsavgift/gi],
        explanation: 'Fasta straffavgifter för t.ex. sen hyra, rökning eller djur saknar ofta stöd i hyreslagen och kan vara oskäliga.',
        advice: 'Hyresvärden har rätt till ersättning för faktisk skada, men höga schablonbelopp kan jämkas.',
        law: '36 § avtalslagen; 12 kap. 1 § jordabalken',
        question: 'Vilka avgifter eller viten kan bli aktuella, och varför?'
      },
      {
        id: 'kontraktsavgift',
        severity: 'high',
        title: 'Avgift för att få kontraktet – kan vara olagligt',
        patterns: [/(förmedlingsavgift|kontraktsavgift|anmälningsavgift|bokningsavgift|reservationsavgift|kontraktsskrivningsavgift|nyckelpengar|handpenning)/gi],
        explanation: 'Det är förbjudet att ta betalt för att upplåta en hyreslägenhet (s.k. svarthandel med kontrakt). Avgiften kan krävas tillbaka.',
        advice: 'Betala inte. Du kan kräva tillbaka avgiften i hyresnämnden, och den som tar ut den kan dömas till fängelse.',
        law: '12 kap. 65 § jordabalken',
        question: 'Vad är det för avgift, och vilken motprestation får jag för den?'
      },
      {
        id: 'bluff',
        severity: 'high',
        title: 'Varningstecken för hyresbedrägeri',
        patterns: [/western\s+union|moneygram|befinner\s+mig\s+(utomlands|i\s+utlandet)|bor\s+(utomlands|i\s+utlandet)|nycklarna\s+(skickas|postas)|airbnb\s+(hanterar|förmedlar)|kryptovaluta|bitcoin|presentkort/gi],
        explanation: 'Uthyrare som är utomlands, skickar nycklar med posten eller vill ha betalt via ovanliga kanaler är ett mycket vanligt bedrägerimönster.',
        advice: 'Betala aldrig något innan du har sett lägenheten, träffat uthyraren och kontrollerat att hen äger eller har rätt att hyra ut den (t.ex. via Lantmäteriet eller föreningen).',
        law: 'Brottsbalken 9 kap. 1 § (bedrägeri)',
        question: 'Kan vi ses i lägenheten och kan du visa legitimation och bevis på att du äger eller får hyra ut bostaden?'
      },
      {
        id: 'andrahand-tillstand',
        severity: 'high',
        title: 'Andrahandsuthyrning utan tillstånd',
        patterns: [/(utan|ej|inte\s+(har|fått|erhållit|sökt))[^.\n]{0,20}(hyresvärdens|föreningens|bostadsrättsföreningens|styrelsens|värdens)\s+(godkännande|tillstånd|samtycke)/gi,
          /(föreningen|hyresvärden|styrelsen|grannarna)\s+(behöver|ska|får)\s+(inte|ej)\s+(veta|informeras|känna\s+till)/gi],
        explanation: 'Om lägenheten hyrs ut i andra hand utan tillstånd kan förstahandshyresgästen förlora kontraktet – och du kan tvingas flytta med kort varsel.',
        advice: 'Be om kopia på hyresvärdens eller föreningens skriftliga godkännande, eller hyresnämndens beslut.',
        law: '12 kap. 39–40 §§ jordabalken; 7 kap. 10–11 §§ bostadsrättslagen',
        question: 'Kan jag få se det skriftliga godkännandet för andrahandsuthyrningen?'
      },
      {
        id: 'forskottshyra',
        severity: 'medium',
        title: 'Flera månaders hyra i förskott',
        patterns: [new RegExp(NUM + '\\s*(månaders|månadshyror)[^.\\n]{0,20}(hyra\\s+)?i\\s+förskott', 'gi'),
          /hyra(n)?[^.\n]{0,30}i\s+förskott\s+för\s+(hela|\d+)/gi],
        explanation: 'Hyran ska normalt betalas senast sista vardagen före varje kalendermånad. Att betala flera månader i förväg ökar risken om något går fel.',
        advice: 'Betala en månad i taget och alltid till ett konto som tillhör uthyraren.',
        law: '12 kap. 20 § jordabalken',
        question: 'Kan hyran betalas månadsvis i stället för flera månader i förskott?'
      }
    ],
    missing: [
      {
        id: 'saknar-besiktning',
        title: 'Inget besiktningsprotokoll',
        patterns: [/besiktning|protokoll|inventarielista|inventarieförteckning|fotodokument/gi],
        explanation: 'Utan protokoll vid inflytt är det svårt att bevisa att skador fanns innan du flyttade in.',
        advice: 'Gör en gemensam besiktning och fotografera allt.',
        question: 'Kan vi göra en gemensam inflyttningsbesiktning med protokoll och foton?'
      },
      {
        id: 'saknar-avtalstid',
        title: 'Avtalstiden är otydlig',
        patterns: [/tillsvidare|obestämd\s+tid|bestämd\s+tid|fr\.?\s*o\.?\s*m|t\.?\s*o\.?\s*m|från\s+och\s+med|till\s+och\s+med|avtalstid|hyrestid|kontraktstid|\d{4}-\d{2}-\d{2}/gi],
        explanation: 'Det framgår inte tydligt hur länge kontraktet gäller.',
        advice: 'Skriv in start- och slutdatum, eller att kontraktet gäller tillsvidare.',
        question: 'Från och med vilket datum gäller kontraktet, och är det tidsbestämt eller tillsvidare?'
      },
      {
        id: 'saknar-ingar',
        title: 'Oklart vad som ingår i hyran',
        patterns: [/ingår|inkluderar|inklusive|inkl\.|exklusive|(^|\s)el\b|värme|vatten|bredband|internet|hushållsel/gi],
        explanation: 'Det framgår inte om el, värme, vatten eller internet ingår.',
        advice: 'Be om en lista över vad hyran inkluderar.',
        question: 'Ingår el, värme, vatten och internet i hyran?'
      },
      {
        id: 'saknar-uppsagning',
        title: 'Ingen uppsägningstid anges',
        patterns: [/uppsägning|säga\s+upp|sägas\s+upp/gi],
        explanation: 'Utan angiven uppsägningstid gäller lagens regler – men det är tydligare om det står i avtalet.',
        advice: 'Be att det skrivs in att uppsägningstiden är tre kalendermånader.',
        question: 'Vilken uppsägningstid gäller för mig respektive uthyraren?'
      }
    ],
    good: [
      { id: 'bra-besiktning', title: 'Besiktning vid in- och utflytt', patterns: [/(inflyttnings|utflyttnings)?besiktning(sprotokoll)?/gi],
        explanation: 'Bra! Ett besiktningsprotokoll skyddar dig mot ersättningskrav för skador som redan fanns.' },
      { id: 'bra-hyreslagen', title: 'Hänvisar till hyreslagen', patterns: [/hyreslagen|12\s+kap(\.|itlet)?\s+(jordabalken|JB)|privatuthyrningslagen/gi],
        explanation: 'Bra! Avtalet hänvisar till lagen som skyddar dig.' },
      { id: 'bra-tillstand', title: 'Tillstånd för andrahandsuthyrning finns', patterns: [/(godkänt|godkännande|tillstånd|samtycke)\s+(av|från)\s+(hyresvärden|föreningen|styrelsen|hyresnämnden)(?![^.\n]{0,10}(saknas|finns\s+inte))/gi],
        explanation: 'Bra! Andrahandsuthyrningen verkar vara godkänd.' },
      { id: 'bra-aterbetalning', title: 'Depositionen återbetalas', patterns: [/deposition(en)?[^.\n]{0,60}(återbetalas|betalas\s+tillbaka)/gi],
        explanation: 'Bra! Det står att depositionen ska betalas tillbaka.' }
    ]
  };

  // =========================================================
  // GYMAVTAL
  // =========================================================
  const gym = {
    name: 'Gymavtal',
    icon: '🏋️',
    keywords: [/gym/gi, /medlemskap/gi, /träning/gi, /bindningstid/gi, /autogiro/gi, /frys/gi, /träningskort|årskort|medlemskort/gi,
      /pass|gruppträning|personlig\s+tränare|PT\b/gi, /anläggning/gi, /medlem(men)?/gi, /månadsavgift/gi],
    traps: [
      {
        id: 'auto-forlangning',
        severity: 'high',
        title: 'Avtalet förlängs automatiskt med ny bindningstid',
        check(text) {
          const { bad, ok } = autoRenewInfo(text);
          if (bad.length) return { matches: bad };
          if (ok.length) return { matches: ok, severity: 'low', title: 'Övergår till löpande medlemskap',
            explanation: 'Efter bindningstiden fortsätter medlemskapet löpande. Det är vanligt och okej – men glöm inte att säga upp om du slutar träna.' };
          return null;
        },
        explanation: 'Om du inte säger upp i tid låses du in i en ny bindningsperiod – kanske ett helt år till.',
        advice: 'Sätt en påminnelse i kalendern före bindningstidens slut. Be om att avtalet i stället övergår till tillsvidare med en månads uppsägning.',
        law: '36 § avtalslagen; Konsumentverkets riktlinjer om automatisk förlängning',
        question: 'Vad händer när bindningstiden löper ut – förlängs avtalet med en ny bindningstid?'
      },
      {
        id: 'bindningstid',
        severity: 'medium',
        title: 'Bindningstid',
        check(text) {
          const { hits, max } = bindingInfo(text);
          if (!hits.length) return null;
          if (max > 12) return { matches: hits, severity: 'high', title: `Lång bindningstid (${max} månader)`,
            explanation: 'Bindningstider över ett år är ovanligt långa. Mycket kan hända – flytt, skada, ändrad ekonomi.' };
          if (max === 12) return { matches: hits, severity: 'medium', title: 'Bindningstid 12 månader',
            explanation: 'Tolv månaders bindning är vanligt, men det innebär att du betalar hela året även om du slutar träna.' };
          if (max > 0) return { matches: hits, severity: 'low', title: `Bindningstid ${max} månader`,
            explanation: 'En kortare bindningstid – rimligt, men kontrollera vad som gäller efteråt.' };
          return null;
        },
        explanation: '',
        advice: 'Jämför totalkostnaden med ett medlemskap utan bindning. Fråga vad det kostar att bryta bindningstiden.',
        law: '36 § avtalslagen',
        question: 'Vad kostar det att avsluta avtalet i förtid, och finns det ett alternativ utan bindningstid?'
      },
      {
        id: 'prishojning-gym',
        severity: 'high',
        title: 'Gymmet får höja priset',
        check(text) {
          const { hits, canCancel } = priceChangeInfo(text);
          if (!hits.length) return null;
          return canCancel
            ? { matches: hits, severity: 'medium', title: 'Prishöjning möjlig – med rätt att säga upp',
                explanation: 'Gymmet kan höja priset, men du verkar få säga upp avtalet om det sker. Kontrollera att det gäller även under bindningstiden.' }
            : { matches: hits };
        },
        explanation: 'Under bindningstiden har du låst dig – men gymmet kan höja priset. Utan rätt att säga upp vid höjning är det en ensidig fälla.',
        advice: 'Kräv att priset är fast under bindningstiden, eller att du får säga upp avtalet utan kostnad vid prishöjning.',
        law: '36 § avtalslagen; avtalsvillkorslagen (1994:1512)',
        question: 'Är priset låst under bindningstiden? Får jag säga upp avtalet om priset höjs?'
      },
      {
        id: 'uppsagningstid-gym',
        severity: 'medium',
        title: 'Uppsägningstid',
        check(text) {
          const { hits, max } = noticeInfo(text);
          if (!hits.length) return null;
          if (max >= 3) return { matches: hits, severity: 'high', title: `Lång uppsägningstid (${max} månader)` };
          if (max === 2) return { matches: hits, severity: 'medium', title: 'Uppsägningstid 2 månader' };
          return { matches: hits, severity: 'ok', title: 'Kort uppsägningstid', explanation: 'Bra! En månads uppsägningstid är rimligt.' };
        },
        explanation: 'En lång uppsägningstid ovanpå bindningstiden gör att du betalar flera månader extra.',
        advice: 'En månads uppsägningstid är branschstandard. Be om det.',
        law: '36 § avtalslagen',
        question: 'Kan uppsägningstiden kortas till en månad?'
      },
      {
        id: 'uppsagning-krangel',
        severity: 'medium',
        title: 'Krångligt att säga upp',
        patterns: [/(uppsägning(en)?|säga\s+upp)[^.\n]{0,80}(personligen|på\s+plats|i\s+receptionen|på\s+anläggningen|rekommenderat\s+brev|per\s+brev|skriftligen\s+per\s+post|med\s+underskrift|vanlig\s+post)/gi,
          /(kan|får)\s+(inte|ej)\s+sägas\s+upp\s+(via|per|genom)\s+(telefon|mejl|e-?post|app)/gi],
        explanation: 'Uppsägningsregler som kräver brev eller besök gör det svårt att avsluta avtalet – särskilt om du flyttar eller är sjuk.',
        advice: 'Det ska vara lika lätt att säga upp som att teckna avtalet. Spara alltid en bekräftelse på uppsägningen.',
        law: 'Konsumentverkets riktlinjer; 36 § avtalslagen',
        question: 'Kan jag säga upp avtalet via mejl, app eller webben, och får jag en bekräftelse?'
      },
      {
        id: 'brytavgift',
        severity: 'high',
        title: 'Avgift om du bryter avtalet i förtid',
        patterns: [/brytavgift|lösenavgift|avslutsavgift|uppsägningsavgift|förtidslösen|(resterande|återstående)\s+(månader|avgifter|månadsavgifter|bindningstid(en)?)|hela\s+bindningstiden\s+(debiteras|ska\s+betalas|faktureras)/gi],
        explanation: 'Att bryta ett bundet avtal kan innebära att du måste betala alla resterande månader direkt.',
        advice: 'Fråga om det finns undantag vid sjukdom, skada eller flytt. Ett oskäligt högt belopp kan jämkas.',
        law: '36 § avtalslagen',
        question: 'Vad kostar det exakt att bryta avtalet, och finns det undantag vid sjukdom eller flytt?'
      },
      {
        id: 'startavgift',
        severity: 'low',
        title: 'Startavgift eller kortavgift',
        patterns: [/(startavgift|inskrivningsavgift|kortavgift|aktiveringsavgift|anslutningsavgift|engångsavgift|medlemskortsavgift|nyckelbricka)/gi],
        explanation: 'Engångsavgifter höjer den verkliga kostnaden för medlemskapet.',
        advice: 'Räkna ut totalkostnaden för hela bindningstiden inklusive avgifter. Startavgiften kan ofta förhandlas bort.',
        law: 'Prisinformationslagen (2004:347)',
        question: 'Kan ni slopa startavgiften? Vad blir totalkostnaden för hela bindningstiden?'
      },
      {
        id: 'ingen-frysning',
        severity: 'medium',
        title: 'Ingen möjlighet att frysa medlemskapet',
        patterns: [/(frysning|frysa|uppehåll|vilande)[^.\n]{0,40}(ej\s+möjlig|inte\s+möjlig|medges\s+(inte|ej)|tillåts\s+(inte|ej)|erbjuds\s+(inte|ej))/gi,
          /(ingen|ej|inte)\s+(möjlighet|rätt)\s+(till|att)\s+(frys|uppehåll|göra\s+uppehåll)/gi],
        explanation: 'Utan frysning betalar du även när du är sjuk, skadad eller gravid.',
        advice: 'Be om rätt att frysa medlemskapet mot läkarintyg.',
        law: '36 § avtalslagen',
        question: 'Kan jag frysa medlemskapet vid sjukdom, skada, graviditet eller långa resor?'
      },
      {
        id: 'ingen-aterbetalning',
        severity: 'medium',
        title: 'Ingen återbetalning',
        patterns: [/(ingen|ej|inte)\s+(återbetalning|återbetalas|ersättning\s+utgår)|återbetalas\s+(ej|inte)|erlagda\s+avgifter\s+återbetalas\s+(ej|inte)/gi],
        explanation: 'Om gymmet stänger, byter lokal eller drar ner på utbudet ska du inte betala för något du inte får.',
        advice: 'Vid väsentliga försämringar från gymmets sida har du rätt till prisavdrag eller att häva avtalet.',
        law: '36 § avtalslagen; allmänna kontraktsrättsliga principer',
        question: 'Vad händer med mina betalningar om anläggningen stänger eller utbudet minskar?'
      },
      {
        id: 'andra-utbud',
        severity: 'medium',
        title: 'Gymmet får ändra öppettider och utbud',
        patterns: [/(förbehåller\s+sig|äger|har)\s+rätt(en)?\s+att[^.\n]{0,40}(ändra|begränsa|stänga|flytta|minska)[^.\n]{0,40}(öppettider|utbud|schema|anläggning(en|ar)?|klasser|pass|gruppträning|lokal)/gi],
        explanation: 'Gymmet kan försämra tjänsten medan du fortfarande är bunden.',
        advice: 'Kräv att du får säga upp avtalet utan kostnad vid väsentliga förändringar.',
        law: '36 § avtalslagen',
        question: 'Får jag säga upp avtalet om öppettider eller utbud försämras väsentligt?'
      },
      {
        id: 'angerratt-bort',
        severity: 'high',
        title: 'Ångerrätten tas bort',
        patterns: [/ångerrätt(en)?[^.\n]{0,40}(gäller\s+(inte|ej)|bortfaller|upphör|förfaller|frånsäger)|ingen\s+ångerrätt|utan\s+ångerrätt/gi],
        explanation: 'Tecknar du online eller utanför gymmets lokaler har du som regel 14 dagars ångerrätt. Den kan inte avtalas bort. Om du börjar träna under ångerfristen kan du dock få betala för den tid du utnyttjat.',
        advice: 'Spara bekräftelsen och ångra skriftligt inom 14 dagar om du ångrar dig.',
        law: '2 kap. 10 § distansavtalslagen (2005:59)',
        question: 'Bekräftar ni att jag har 14 dagars ångerrätt eftersom jag tecknar avtalet online?'
      },
      {
        id: 'skadeansvar-gym',
        severity: 'medium',
        title: 'Gymmet friskriver sig från skador',
        patterns: [/(ansvarar\s+(inte|ej)|friskriv(er|s)|inget\s+ansvar)[^.\n]{0,80}(skad(a|or)|olyck|personskad|stöld|förlust|egendom)/gi,
          /träning\s+sker\s+på\s+egen\s+risk/gi],
        explanation: 'Gymmet kan inte friskriva sig från ansvar för skador som beror på deras eget slarv, t.ex. trasig utrustning.',
        advice: 'Kontrollera att din hemförsäkring eller en olycksfallsförsäkring täcker träningsskador.',
        law: '36 § avtalslagen; skadeståndslagen',
        question: 'Vem ansvarar om jag skadas på grund av trasig eller felaktigt underhållen utrustning?'
      }
    ],
    missing: [
      {
        id: 'saknar-angerratt',
        title: 'Ångerrätt nämns inte',
        patterns: [/ångerrätt|ångra|ångerfrist/gi],
        explanation: 'Om du tecknar online har du 14 dagars ångerrätt – men avtalet berättar inte om det.',
        advice: 'Fråga hur du utövar ångerrätten.',
        question: 'Hur gör jag om jag vill utnyttja ångerrätten?'
      },
      {
        id: 'saknar-frysning',
        title: 'Frysning vid sjukdom nämns inte',
        patterns: [/frys|uppehåll|vilande|läkarintyg|sjukdom|skada/gi],
        explanation: 'Det framgår inte vad som händer om du blir sjuk eller skadad.',
        advice: 'Be om villkor för frysning mot läkarintyg.',
        question: 'Vad gäller om jag blir sjuk eller skadad och inte kan träna?'
      },
      {
        id: 'saknar-uppsagning-gym',
        title: 'Hur man säger upp avtalet framgår inte',
        patterns: [/uppsägning|säga\s+upp|sägas\s+upp|avsluta/gi],
        explanation: 'Det framgår inte hur du säger upp medlemskapet.',
        advice: 'Fråga hur uppsägning går till och be om skriftlig bekräftelse.',
        question: 'Hur säger jag upp medlemskapet, och vilken uppsägningstid gäller?'
      },
      {
        id: 'saknar-pris-gym',
        title: 'Totalkostnad framgår inte',
        patterns: [/\d+\s*(kr|kronor|:-|sek)/gi],
        explanation: 'Avtalet anger inget tydligt pris.',
        advice: 'Be om totalkostnaden för hela bindningstiden.',
        question: 'Vad blir den totala kostnaden för hela avtalsperioden inklusive alla avgifter?'
      }
    ],
    good: [
      { id: 'bra-ingen-bindning', title: 'Ingen bindningstid', patterns: [/(ingen|utan)\s+bindning(stid)?/gi],
        explanation: 'Bra! Utan bindningstid kan du sluta när du vill.' },
      { id: 'bra-frysning', title: 'Frysning vid sjukdom', patterns: [/(frys(a|ning)|uppehåll|vilande)[^.\n]{0,80}(sjukdom|skada|graviditet|läkarintyg|föräldraledig)/gi],
        explanation: 'Bra! Du kan frysa medlemskapet om du blir sjuk eller skadad.' },
      { id: 'bra-angerratt', title: '14 dagars ångerrätt', patterns: [/ångerrätt[^.\n]{0,30}14\s+dagar|14\s+dagars\s+ångerrätt/gi],
        explanation: 'Bra! Avtalet informerar om ångerrätten.' },
      { id: 'bra-digital-uppsagning', title: 'Enkel uppsägning digitalt', patterns: [/(säga\s+upp|uppsägning)[^.\n]{0,60}(app(en)?|online|mina\s+sidor|webb(en)?|e-?post|mejl)/gi],
        explanation: 'Bra! Du kan säga upp avtalet digitalt.' }
    ]
  };

  // =========================================================
  // AVBETALNINGSKONTRAKT (delbetalning, konsumentkredit)
  // =========================================================
  const avbetalning = {
    name: 'Avbetalningskontrakt',
    icon: '💳',
    keywords: [/avbetalning/gi, /delbetalning/gi, /kredit(givare|givaren|belopp|beloppet|tagare|tagaren|en|avtal)?/gi, /effektiv(a)?\s+ränta/gi,
      /nominell(a)?\s+ränta/gi, /uppläggningsavgift/gi, /aviavgift/gi, /konsumentkredit/gi, /räntefri/gi, /kontantpris/gi,
      /återbetalning(stid|splan)?/gi, /låntagare|kredittagare|lån(et)?\b/gi, /betalningsplan/gi, /äganderättsförbehåll/gi],
    traps: [
      {
        id: 'effektiv-ranta',
        severity: 'medium',
        title: 'Effektiv ränta',
        check(text) {
          const hits = findAll(text, /effektiv(?:a)?\s+ränta(?:n)?[^.\n]{0,40}?(\d+(?:[,.]\d+)?)\s*%/gi);
          if (!hits.length) return null;
          const max = Math.max(...hits.map(h => toNumber(h.m[1])));
          const pct = String(max).replace('.', ',');
          if (max >= 30) return { matches: hits, severity: 'high', title: `Mycket hög effektiv ränta (${pct} %)`,
            explanation: 'Den effektiva räntan visar vad krediten egentligen kostar per år, inklusive alla avgifter. Över 30 % är mycket dyrt – i närheten av lagens räntetak.' };
          if (max >= 15) return { matches: hits, severity: 'medium', title: `Hög effektiv ränta (${pct} %)`,
            explanation: 'Krediten är dyr. Ett vanligt privatlån eller att spara ihop till köpet är ofta betydligt billigare.' };
          return { matches: hits, severity: 'low', title: `Effektiv ränta ${pct} %`,
            explanation: 'Den effektiva räntan är på en rimlig nivå. Jämför ändå med andra alternativ.' };
        },
        explanation: '',
        advice: 'Jämför alltid den effektiva räntan – inte den nominella eller månadsbeloppet. Räkna ut totalbeloppet du betalar och jämför med kontantpriset.',
        law: '7–8 §§ och 19 a § konsumentkreditlagen (2010:1846)',
        question: 'Vad blir det totala beloppet jag betalar, och hur mycket mer är det än kontantpriset?'
      },
      {
        id: 'rantefri-kampanj',
        severity: 'high',
        title: 'Räntefri period övergår till hög ränta',
        // Får sträcka sig över en meningsgräns: "Räntefri i 6 månader. Därefter …"
        patterns: [/(räntefri(tt|a)?|0\s*%\s*ränta|ränta\s*0\s*%|kampanjränta)[^\n]{0,120}?(därefter|efter\s+(kampanj|\d+|de\s+första)|övergår|ordinarie\s+ränta|kampanjperioden)/gi],
        explanation: 'Kampanjen lockar med 0 % ränta, men efter en tid övergår krediten ofta till en hög ränta – ibland retroaktivt eller till en dyr kontokredit.',
        advice: 'Ta reda på exakt vad som händer när kampanjen tar slut. Betala hela skulden innan dess om du kan.',
        law: '8 § konsumentkreditlagen (information om kreditkostnader)',
        question: 'Vad blir räntan och månadsbeloppet när den räntefria perioden är slut?'
      },
      {
        id: 'rantefri-avgifter',
        severity: 'medium',
        title: '"Räntefritt" – men med avgifter',
        check(text) {
          const free = findAll(text, /räntefri(tt|a)?|0\s*%\s*ränta|ränta\s*0\s*%/gi);
          if (!free.length) return null;
          const fees = findAll(text, /(uppläggningsavgift|aviavgift|administrationsavgift|kontoavgift|årsavgift|månadsavgift|startavgift)/gi);
          return fees.length ? { matches: [...free, ...fees] } : null;
        },
        explanation: 'Även om räntan är 0 % kan avgifterna göra krediten dyr. En aviavgift på 39 kr per månad kan motsvara en effektiv ränta på över 10 %.',
        advice: 'Titta på den effektiva räntan och totalbeloppet – de inkluderar alla avgifter.',
        law: '8 § konsumentkreditlagen',
        question: 'Vad blir den effektiva räntan när alla avgifter är inräknade?'
      },
      {
        id: 'hela-skulden-forfaller',
        severity: 'high',
        title: 'Hela skulden förfaller vid en sen betalning',
        patterns: [/(hela|resterande|återstående|samtliga)\s+(skulden|krediten|beloppet|kreditbeloppet|avbetalningar(na)?)[^.\n]{0,60}(förfaller|omedelbart|i\s+sin\s+helhet|till\s+betalning)/gi,
          /(förfaller|förfalla)\s+(hela|resterande|återstående)\s+(skulden|krediten|beloppet|kreditbeloppet)[^.\n]{0,40}/gi,
          /(kreditgivaren|säljaren|bolaget)[^.\n]{0,40}(rätt\s+att\s+)?(säga\s+upp|kräva\s+betalning\s+av)\s+(hela\s+)?(krediten|skulden)[^.\n]{0,40}(omedelbart|direkt|till\s+betalning)/gi],
        explanation: 'Kreditgivaren får bara kräva hela skulden i förtid om du är mer än en månad sen med en betydande del (normalt mer än 10 %), och då med minst fyra veckors varsel – där du kan betala in det sena beloppet och behålla avbetalningen.',
        advice: 'Villkor som ger kreditgivaren rätt att kräva hela skulden direkt vid en sen betalning är inte giltiga mot dig.',
        law: '34 § konsumentkreditlagen',
        question: 'Under vilka villkor kan ni kräva att jag betalar hela skulden i förtid?'
      },
      {
        id: 'fortidsbetalning-avgift',
        severity: 'medium',
        title: 'Avgift för att betala i förtid',
        patterns: [/(förtida\s+(betalning|inlösen|återbetalning|lösen)|lösa\s+(krediten|lånet|skulden)\s+i\s+förtid|betala\s+(i\s+förtid|hela\s+skulden\s+i\s+förtid)|ränteskillnadsersättning)[^.\n]{0,80}(avgift|ersättning|debiteras|\d+\s*%)/gi],
        explanation: 'Du har alltid rätt att betala hela eller delar av krediten i förtid. Kreditgivaren får bara ta ut ränteskillnadsersättning vid bunden ränta – max 1 % av beloppet (0,5 % om det är mindre än ett år kvar).',
        advice: 'Kontrollera att avgiften inte överstiger lagens tak. Vid rörlig ränta får ingen ersättning tas ut alls.',
        law: '32 § och 36 § konsumentkreditlagen',
        question: 'Vad kostar det att lösa krediten i förtid?'
      },
      {
        id: 'kontokredit',
        severity: 'medium',
        title: 'Avbetalningen är en kontokredit',
        patterns: [/kontokredit|revolverande\s+kredit|kreditkonto|kreditram|beviljad\s+kreditgräns|(minsta|lägsta)\s+(belopp|månadsbelopp|betalning)\s+att\s+betala/gi],
        explanation: 'En kontokredit har ingen fast slutpunkt. Om du bara betalar lägsta belopp kan skulden ta många år att betala av och kosta mycket i ränta.',
        advice: 'Betala mer än lägsta belopp varje månad. Fråga om du kan få en fast avbetalningsplan i stället.',
        law: 'Konsumentkreditlagen (2010:1846)',
        question: 'Hur lång tid tar det att betala av hela skulden om jag bara betalar lägsta belopp, och vad blir totalkostnaden?'
      },
      {
        id: 'ranteandring',
        severity: 'medium',
        title: 'Räntan kan ändras',
        patterns: [/(kreditgivaren|långivaren|bolaget|säljaren)[^.\n]{0,40}(rätt\s+att|får|kan)[^.\n]{0,30}(ändra|höja|justera)[^.\n]{0,20}ränta/gi,
          /rörlig(a)?\s+ränta|räntan\s+är\s+rörlig|räntan\s+kan\s+(komma\s+att\s+)?(ändras|höjas|justeras)/gi],
        explanation: 'Med rörlig ränta kan månadskostnaden stiga under avtalstiden. Kreditgivaren får bara ändra räntan av de skäl som står i avtalet och måste meddela dig i förväg.',
        advice: 'Fråga vilka omständigheter som styr räntan och hur stor höjning du skulle klara.',
        law: 'Konsumentkreditlagen (2010:1846)',
        question: 'Hur och varför kan räntan ändras, och hur får jag reda på det?'
      },
      {
        id: 'betalskydd',
        severity: 'medium',
        title: 'Försäkring kopplad till krediten',
        patterns: [/betalskydd|låneskydd|kreditförsäkring|låneförsäkring|betalningsskydd/gi],
        explanation: 'Betalskyddsförsäkringar kostar ofta mycket i förhållande till vad de betalar ut och har många undantag.',
        advice: 'Kontrollera om försäkringen är frivillig. Om den är obligatorisk ska kostnaden räknas in i den effektiva räntan.',
        law: '8 § konsumentkreditlagen; försäkringsavtalslagen',
        question: 'Är försäkringen frivillig, vad kostar den och vad täcker den?'
      },
      {
        id: 'borgen',
        severity: 'medium',
        title: 'Borgen eller medsökande',
        patterns: [/borgen(såtagande)?|borgensman|borgensförbindelse|medsökande|medlåntagare|solidariskt\s+(betalnings)?ansvar/gi],
        explanation: 'Som borgensman eller medsökande kan du bli skyldig att betala hela skulden om den andra inte betalar.',
        advice: 'Gå bara i borgen för någon du litar helt på, och för belopp du själv klarar att betala.',
        law: 'Handelsbalken 10 kap.; konsumentkreditlagen',
        question: 'Vad exakt ansvarar en borgensman eller medsökande för?'
      },
      {
        id: 'aganderattsforbehall',
        severity: 'low',
        title: 'Säljaren kan ta tillbaka varan',
        patterns: [/äganderättsförbehåll|återtaganderätt|(varan|produkten|bilen|möbeln|telefonen)\s+(tillhör|förblir)\s+(säljarens|säljaren|kreditgivaren|kreditgivarens)[^.\n]{0,40}/gi],
        explanation: 'Varan tillhör säljaren tills allt är betalt. Betalar du inte kan säljaren under vissa förutsättningar ta tillbaka den – och du kan ändå bli skyldig pengar.',
        advice: 'Se till att du klarar betalningarna under hela perioden. Kontakta kreditgivaren direkt om du får problem att betala.',
        law: 'Konsumentkreditlagen (2010:1846), bestämmelserna om återtagande',
        question: 'Vad händer med varan och skulden om jag inte kan betala?'
      },
      {
        id: 'angerratt-kredit',
        severity: 'high',
        title: 'Ångerrätten tas bort',
        patterns: [/ångerrätt(en)?[^.\n]{0,40}(gäller\s+(inte|ej)|bortfaller|upphör|förfaller)|ingen\s+ångerrätt|utan\s+ångerrätt/gi],
        explanation: 'Du har alltid 14 dagars ångerrätt på ett kreditavtal. Den kan inte avtalas bort.',
        advice: 'Vill du ångra dig: meddela kreditgivaren inom 14 dagar och betala tillbaka kreditbeloppet plus upplupen ränta inom 30 dagar.',
        law: '16 § konsumentkreditlagen',
        question: 'Bekräftar ni att jag har 14 dagars ångerrätt på krediten?'
      }
    ],
    missing: [
      { id: 'saknar-effektiv-ranta', title: 'Effektiv ränta anges inte', patterns: [/effektiv(a)?\s+ränta/gi],
        explanation: 'Kreditgivaren måste ange den effektiva räntan. Utan den kan du inte jämföra vad krediten kostar.',
        advice: 'Kräv att få den effektiva räntan och ett räkneexempel.',
        question: 'Vad är den effektiva räntan?' },
      { id: 'saknar-totalbelopp', title: 'Totalbelopp att betala saknas', patterns: [/totalt\s+(belopp\s+)?att\s+betala|totalbelopp(et)?|total\s+kostnad|totalkostnad|sammanlagt\s+belopp|att\s+betala\s+totalt/gi],
        explanation: 'Det framgår inte hur mycket du betalar totalt, inklusive ränta och avgifter.',
        advice: 'Be om totalbeloppet och jämför det med kontantpriset.',
        question: 'Vad är det totala beloppet jag ska betala, inklusive ränta och avgifter?' },
      { id: 'saknar-angerratt-kredit', title: 'Ångerrätt nämns inte', patterns: [/ångerrätt|ångra/gi],
        explanation: 'Kreditavtal ska innehålla information om din ångerrätt.',
        advice: 'Fråga hur du utövar ångerrätten.',
        question: 'Hur gör jag om jag vill ångra krediten?' },
      { id: 'saknar-betalningsplan', title: 'Ingen tydlig betalningsplan', patterns: [/betalningsplan|återbetalningstid|återbetalningsplan|löptid|antal\s+(betalningar|avbetalningar|månader)|\d+\s+(månatliga\s+)?(betalningar|avbetalningar|delbetalningar)/gi],
        explanation: 'Det framgår inte hur många betalningar du ska göra och hur länge krediten löper.',
        advice: 'Be om en betalningsplan med antal betalningar, belopp och datum.',
        question: 'Hur många betalningar blir det, och när är krediten färdigbetald?' }
    ],
    good: [
      { id: 'bra-fortid', title: 'Förtidsbetalning utan avgift', patterns: [/(betala|lösa)[^.\n]{0,40}i\s+förtid[^.\n]{0,40}(utan\s+(avgift|kostnad)|kostnadsfritt|avgiftsfritt)/gi],
        explanation: 'Bra! Du kan betala av krediten tidigare utan extra kostnad.' },
      { id: 'bra-angerratt-kredit', title: '14 dagars ångerrätt', patterns: [/ångerrätt[^.\n]{0,30}14\s+dagar|14\s+dagars\s+ångerrätt/gi],
        explanation: 'Bra! Avtalet informerar om ångerrätten.' },
      { id: 'bra-kkl', title: 'Hänvisar till konsumentkreditlagen', patterns: [/konsumentkreditlagen/gi],
        explanation: 'Bra! Avtalet hänvisar till lagen som skyddar dig som kredittagare.' },
      { id: 'bra-fast-ranta', title: 'Fast ränta', patterns: [/fast\s+ränta|räntan\s+är\s+fast/gi],
        explanation: 'Bra! Med fast ränta vet du vad krediten kostar varje månad.' }
    ]
  };

  // =========================================================
  // ABONNEMANG (mobil, bredband, tv, streaming, larm m.m.)
  // =========================================================
  const abonnemang = {
    name: 'Abonnemang',
    icon: '📱',
    keywords: [/abonnemang/gi, /prenumeration/gi, /operatör(en)?/gi, /\bsurf/gi, /\d+\s*GB\b/g, /bredband/gi, /mbit/gi, /router(n)?/gi,
      /sim-?kort/gi, /mobilnummer|mobiltelefon/gi, /streaming/gi, /tv-?paket|kanalpaket|digitalbox/gi, /\blarm(et)?\b/gi,
      /provperiod|gratisperiod/gi, /tjänsten/gi, /samtal|sms/gi],
    traps: [
      {
        id: 'provperiod',
        severity: 'medium',
        title: 'Gratis- eller kampanjperiod övergår till fullpris',
        check(text) {
          const hits = findAll(text, /(provperiod|gratisperiod|testperiod|gratis\s+(i|de\s+första)\s+\d+|introduktionspris|kampanjpris|rabatterat\s+pris|första\s+\d+\s+månaderna)[^.\n]{0,140}/gi);
          if (!hits.length) return null;
          const bad = hits.filter(h => /därefter|övergår|sedan|ordinarie|fullpris|automatiskt|efter\s+(kampanj|perioden)/i.test(h.m[0]));
          if (bad.length) return { matches: bad };
          return { matches: hits, severity: 'low', title: 'Kampanj- eller provperiod',
            explanation: 'Avtalet har ett erbjudande under en begränsad tid. Ta reda på vad som gäller när perioden är slut.' };
        },
        explanation: 'Efter gratis- eller kampanjperioden fortsätter abonnemanget automatiskt till ordinarie pris om du inte säger upp i tid.',
        advice: 'Skriv in slutdatumet i kalendern direkt. Säg upp i god tid om du inte vill fortsätta.',
        law: 'Distansavtalslagen (2005:59); Konsumentverkets riktlinjer om prenumerationer',
        question: 'Vad kostar abonnemanget när kampanjperioden är slut, och när senast måste jag säga upp?'
      },
      {
        id: 'bindningstid-abonnemang',
        severity: 'medium',
        title: 'Bindningstid',
        check(text) {
          const { hits, max } = bindingInfo(text);
          if (!hits.length) return null;
          if (max > 24) return { matches: hits, severity: 'high', title: `Bindningstid över 24 månader (${max} månader)`,
            explanation: 'För mobil-, bredbands- och andra elektroniska kommunikationstjänster får bindningstiden vara högst 24 månader. Längre bindning gäller inte mot dig.' };
          if (max > 12) return { matches: hits, severity: 'medium', title: `Lång bindningstid (${max} månader)`,
            explanation: 'En lång bindningstid låser dig vid operatören även om du hittar ett billigare eller bättre alternativ. Operatörer av mobil och bredband måste även erbjuda ett avtal med högst 12 månaders bindning.' };
          return { matches: hits, severity: 'low', title: `Bindningstid ${max} månader`,
            explanation: 'Bindningstiden är kort eller normal. Kontrollera vad som gäller när den löper ut.' };
        },
        explanation: '',
        advice: 'Fråga efter ett alternativ med kortare eller ingen bindningstid och jämför totalkostnaden.',
        law: 'Lag (2022:482) om elektronisk kommunikation',
        question: 'Finns abonnemanget utan bindningstid eller med högst 12 månaders bindning, och vad kostar det då?'
      },
      {
        id: 'auto-forlangning-abonnemang',
        severity: 'high',
        title: 'Abonnemanget förlängs automatiskt med ny bindningstid',
        check(text) {
          const { bad, ok } = autoRenewInfo(text);
          if (bad.length) return { matches: bad };
          if (ok.length) return { matches: ok, severity: 'low', title: 'Övergår till löpande abonnemang',
            explanation: 'Efter bindningstiden fortsätter abonnemanget löpande. Det är vanligt – men kontrollera priset och säg upp om du inte använder tjänsten.' };
          return null;
        },
        explanation: 'Om abonnemanget förlängs med en ny bindningsperiod kan du låsas fast i ytterligare ett eller två år.',
        advice: 'För mobil och bredband får du efter bindningstiden alltid säga upp med högst en månads uppsägningstid. Be om att avtalet i stället övergår till löpande.',
        law: 'Lag (2022:482) om elektronisk kommunikation; 36 § avtalslagen',
        question: 'Vad händer när bindningstiden löper ut – förlängs abonnemanget med en ny bindningstid?'
      },
      {
        id: 'uppsagningstid-abonnemang',
        severity: 'medium',
        title: 'Uppsägningstid',
        check(text) {
          const { hits, max } = noticeInfo(text);
          if (!hits.length) return null;
          if (max >= 3) return { matches: hits, severity: 'high', title: `Lång uppsägningstid (${max} månader)` };
          if (max === 2) return { matches: hits, severity: 'medium', title: 'Uppsägningstid 2 månader' };
          return { matches: hits, severity: 'ok', title: 'Kort uppsägningstid', explanation: 'Bra! En månads uppsägningstid är rimligt.' };
        },
        explanation: 'En lång uppsägningstid gör att du betalar för tjänsten flera månader efter att du sagt upp den.',
        advice: 'För mobil och bredband får uppsägningstiden efter bindningstiden vara högst en månad. Be om det även för andra abonnemang.',
        law: 'Lag (2022:482) om elektronisk kommunikation; 36 § avtalslagen',
        question: 'Kan uppsägningstiden vara en månad?'
      },
      {
        id: 'prishojning-abonnemang',
        severity: 'high',
        title: 'Operatören får höja priset',
        check(text) {
          const { hits, canCancel } = priceChangeInfo(text);
          if (!hits.length) return null;
          return canCancel
            ? { matches: hits, severity: 'medium', title: 'Prishöjning möjlig – med rätt att säga upp',
                explanation: 'Priset kan höjas, men du verkar få säga upp avtalet om det sker. Kontrollera att det gäller utan kostnad även under bindningstiden.' }
            : { matches: hits };
        },
        explanation: 'Du är bunden, men företaget kan höja priset. För mobil och bredband har du rätt att säga upp avtalet utan kostnad om villkoren ändras till din nackdel.',
        advice: 'Kräv att priset är låst under bindningstiden, eller att du får säga upp avtalet kostnadsfritt vid prishöjning.',
        law: 'Lag (2022:482) om elektronisk kommunikation; avtalsvillkorslagen (1994:1512)',
        question: 'Är priset låst under bindningstiden? Får jag säga upp avtalet utan kostnad om priset höjs?'
      },
      {
        id: 'losen-abonnemang',
        severity: 'high',
        title: 'Kostnad om du avslutar i förtid',
        patterns: [/lösenavgift|lösensumma|brytavgift|avslutsavgift|(förtida\s+uppsägning|bryta\s+(avtalet|abonnemanget))[^.\n]{0,80}(debiteras|avgift|betala|faktureras)|(resterande|kvarvarande|återstående)\s+(månadsavgifter|avgifter|månader|delbetalningar|bindningstid(en)?)/gi],
        explanation: 'Att avsluta abonnemanget i förtid kan innebära att du måste betala alla återstående månader på en gång.',
        advice: 'Fråga exakt vad det kostar att avsluta i förtid. Vid flytt till en adress där tjänsten inte går att leverera kan du ofta säga upp utan kostnad.',
        law: 'Lag (2022:482) om elektronisk kommunikation; 36 § avtalslagen',
        question: 'Vad kostar det att avsluta abonnemanget i förtid, och finns det undantag vid flytt?'
      },
      {
        id: 'hardvara',
        severity: 'medium',
        title: 'Telefon eller utrustning betalas via abonnemanget',
        patterns: [/(telefonen|mobilen|surfplattan|klockan|routern|utrustningen|hårdvaran|tv-boxen|digitalboxen)[^.\n]{0,60}(delbetal|avbetal|betalas\s+(av\s+)?månadsvis|ingår\s+i\s+(månads)?avgiften|subventionerad)/gi],
        explanation: 'När en telefon eller utrustning betalas via abonnemanget är det svårt att se vad den egentligen kostar – och du kan bli skyldig resten om du avslutar i förtid.',
        advice: 'Räkna ut totalkostnaden för hela bindningstiden och jämför med att köpa telefonen kontant och välja ett billigare abonnemang.',
        law: 'Konsumentkreditlagen (om delbetalningen är en kredit); prisinformationslagen',
        question: 'Vad kostar utrustningen separat, och vad händer med delbetalningen om jag säger upp abonnemanget?'
      },
      {
        id: 'returnera-utrustning',
        severity: 'medium',
        title: 'Avgift om utrustning inte lämnas tillbaka',
        patterns: [/(router(n)?|modem(et)?|box(en)?|digitalbox(en)?|utrustning(en)?|larmutrustning(en)?|mottagare(n)?)[^.\n]{0,80}(returneras|återlämnas|skickas\s+tillbaka|lämnas\s+tillbaka)[^.\n]{0,100}(debiteras|avgift|ersättning|faktureras|\d+\s*(kr|kronor))/gi],
        explanation: 'Om utrustningen inte kommer tillbaka i tid kan du få betala ett högt belopp – ofta mer än den är värd.',
        advice: 'Skicka tillbaka utrustningen spårbart och spara kvittot.',
        law: '36 § avtalslagen',
        question: 'Hur och när ska utrustningen skickas tillbaka, och vem betalar frakten?'
      },
      {
        id: 'negativ-forsaljning',
        severity: 'high',
        title: 'Tjänster läggs till om du inte säger nej',
        patterns: [/om\s+du\s+inte\s+(avböjer|säger\s+nej|avbeställer|meddelar\s+(annat|oss))|(aktiveras|läggs\s+till|ingår)\s+automatiskt[^.\n]{0,60}(tilläggstjänst|tjänst|kostnad|avgift|debiteras)|tyst\s+accept/gi],
        explanation: 'Ett företag får inte ta betalt för något du inte aktivt har beställt. Att tystnad räknas som ett ja är inte tillåtet.',
        advice: 'Du behöver inte betala för tjänster du inte beställt. Bestrid fakturan skriftligt.',
        law: 'Marknadsföringslagen (2008:486), bilagan p. 29; 3 kap. 3 § distansavtalslagen',
        question: 'Vilka tjänster läggs till automatiskt, och hur avböjer jag dem?'
      },
      {
        id: 'tillaggstjanster',
        severity: 'medium',
        title: 'Tilläggstjänster och betalning via mobilräkningen',
        patterns: [/(tilläggstjänst(er)?|tredjepartstjänst(er)?|tredje\s+part|betala\s+via\s+(mobil|telefon)räkning(en)?|betaltjänster|premiumtjänster|betalsamtal|betal-?sms)[^.\n]{0,80}/gi],
        explanation: 'Tjänster från tredje part kan debiteras via din mobilräkning – ibland utan att du märker det.',
        advice: 'Be operatören spärra betalning via mobilräkningen och betalsamtal om du inte behöver det.',
        law: 'Lag (2022:482) om elektronisk kommunikation',
        question: 'Kan ni spärra tredjepartsbetalningar och betalsamtal på mitt abonnemang?'
      },
      {
        id: 'overskridande',
        severity: 'low',
        title: 'Extra kostnader utöver månadsavgiften',
        patterns: [/(debiteras|kostar)\s+per\s+(mb|gb|minut|sms|samtal)|utöver\s+(din\s+)?(surf|datamängd|ingående)|extra\s+surf|roaming|utlandssamtal|samtal\s+(till|från)\s+utlandet/gi],
        explanation: 'Surf, samtal och roaming utöver det som ingår kan ge en oväntat hög faktura.',
        advice: 'Ställ in en kostnadsgräns eller ett spärrbelopp hos operatören.',
        law: 'EU:s roamingförordning; lag (2022:482) om elektronisk kommunikation',
        question: 'Vad kostar det om jag använder mer än det som ingår, och kan jag sätta ett kostnadstak?'
      },
      {
        id: 'startavgift-abonnemang',
        severity: 'low',
        title: 'Startavgift eller engångsavgift',
        patterns: [/(startavgift|aktiveringsavgift|anslutningsavgift|uppläggningsavgift|engångsavgift|installationsavgift|öppningsavgift)/gi],
        explanation: 'Engångsavgifter höjer den verkliga kostnaden, särskilt om du byter abonnemang ofta.',
        advice: 'Räkna in avgiften i totalkostnaden. Den går ofta att förhandla bort.',
        law: 'Prisinformationslagen (2004:347)',
        question: 'Kan ni slopa startavgiften? Vad blir totalkostnaden för hela bindningstiden?'
      },
      {
        id: 'upp-till-hastighet',
        severity: 'low',
        title: 'Hastigheten är bara "upp till"',
        patterns: [/upp\s+till\s+\d+\s*(mbit|mb\/s|mbps|gbit|gb\/s)/gi],
        explanation: '"Upp till" betyder att du inte är garanterad den hastigheten. Om den verkliga hastigheten ofta är mycket lägre har du rätt till prisavdrag eller att häva avtalet.',
        advice: 'Mät hastigheten med Bredbandskollen.se och spara resultaten om den är för låg.',
        law: 'EU-förordning 2015/2120 art. 4; lag (2022:482) om elektronisk kommunikation',
        question: 'Vilken lägsta och normalt tillgänglig hastighet lovar ni?'
      },
      {
        id: 'telefonforsaljning',
        severity: 'medium',
        title: 'Avtalet ingicks via telefon',
        patterns: [/(telefon(samtal|försäljning|säljare)?|muntligt?)[^.\n]{0,60}(är\s+bindande|gäller\s+(från|som)|har\s+ingåtts|ingicks|bekräftats)/gi],
        explanation: 'Om företaget ringde dig och sålde avtalet måste du bekräfta det skriftligt för att det ska bli bindande. Du har dessutom 14 dagars ångerrätt.',
        advice: 'Bekräfta inte avtalet om du inte vill ha det. Har du redan fått en faktura utan att ha bekräftat – bestrid den.',
        law: '3 kap. 3 a § distansavtalslagen (2005:59)',
        question: 'Kan jag få avtalet skriftligt, så att jag kan läsa igenom det innan jag bekräftar?'
      },
      {
        id: 'angerratt-abonnemang',
        severity: 'high',
        title: 'Ångerrätten tas bort',
        patterns: [/ångerrätt(en)?[^.\n]{0,40}(gäller\s+(inte|ej)|bortfaller|upphör|förfaller)|ingen\s+ångerrätt|utan\s+ångerrätt/gi],
        explanation: 'Tecknar du online, per telefon eller vid dörren har du 14 dagars ångerrätt. Om tjänsten börjar användas under ångerfristen kan du behöva betala för den tid du använt.',
        advice: 'Ångra skriftligt inom 14 dagar och spara bekräftelsen.',
        law: '2 kap. 10 § distansavtalslagen (2005:59)',
        question: 'Bekräftar ni att jag har 14 dagars ångerrätt?'
      },
      {
        id: 'uppsagning-krangel-abonnemang',
        severity: 'medium',
        title: 'Krångligt att säga upp',
        patterns: [/(uppsägning(en)?|säga\s+upp)[^.\n]{0,80}(endast\s+(via\s+)?telefon|rekommenderat\s+brev|per\s+brev|vanlig\s+post|skriftligen\s+per\s+post|med\s+underskrift|personligen|i\s+butik)/gi,
          /(kan|får)\s+(inte|ej)\s+sägas\s+upp\s+(via|per|genom)\s+(mejl|e-?post|app|webben|chatt)/gi],
        explanation: 'Det ska vara lika enkelt att säga upp ett abonnemang som att teckna det.',
        advice: 'Säg upp skriftligt (t.ex. mejl) och spara bekräftelsen.',
        law: 'Konsumentverkets riktlinjer; 36 § avtalslagen',
        question: 'Kan jag säga upp abonnemanget via mejl, app eller webben?'
      }
    ],
    missing: [
      { id: 'saknar-bindning-info', title: 'Bindningstid framgår inte', patterns: [/bindning/gi],
        explanation: 'Det framgår inte om abonnemanget har bindningstid.',
        advice: 'Fråga om det finns bindningstid och hur lång den är.',
        question: 'Har abonnemanget bindningstid, och hur lång är den?' },
      { id: 'saknar-uppsagning-abonnemang', title: 'Hur man säger upp framgår inte', patterns: [/uppsägning|säga\s+upp|sägas\s+upp|avsluta/gi],
        explanation: 'Det framgår inte hur du säger upp abonnemanget.',
        advice: 'Fråga hur uppsägning går till och vilken uppsägningstid som gäller.',
        question: 'Hur säger jag upp abonnemanget, och vilken uppsägningstid gäller?' },
      { id: 'saknar-angerratt-abonnemang', title: 'Ångerrätt nämns inte', patterns: [/ångerrätt|ångra|ångerfrist/gi],
        explanation: 'Om du tecknar på distans har du 14 dagars ångerrätt – men avtalet berättar inte om det.',
        advice: 'Fråga hur du utövar ångerrätten.',
        question: 'Hur gör jag om jag vill ångra abonnemanget?' },
      { id: 'saknar-pris-abonnemang', title: 'Månadskostnad framgår inte', patterns: [/\d+\s*(kr|kronor|:-|sek)/gi],
        explanation: 'Avtalet anger ingen tydlig kostnad.',
        advice: 'Be om månadskostnaden och totalkostnaden för hela bindningstiden.',
        question: 'Vad blir den totala kostnaden för hela bindningstiden, inklusive alla avgifter?' }
    ],
    good: [
      { id: 'bra-ingen-bindning-abonnemang', title: 'Ingen bindningstid', patterns: [/(ingen|utan)\s+bindning(stid)?/gi],
        explanation: 'Bra! Utan bindningstid kan du byta när du vill.' },
      { id: 'bra-digital-uppsagning-abonnemang', title: 'Enkel uppsägning digitalt', patterns: [/(säga\s+upp|uppsägning)[^.\n]{0,60}(app(en)?|online|mina\s+sidor|webb(en)?|e-?post|mejl|chatt)/gi],
        explanation: 'Bra! Du kan säga upp abonnemanget digitalt.' },
      { id: 'bra-uppsagning-prisandring', title: 'Rätt att säga upp vid prisändring', patterns: [/(säga\s+upp|frånträda)[^.\n]{0,60}(utan\s+kostnad|kostnadsfritt|avgiftsfritt)[^.\n]{0,60}(pris|villkor|ändring)|(pris|villkor)[^.\n]{0,60}(ändras|höjs)[^.\n]{0,60}(säga\s+upp|frånträda)[^.\n]{0,30}(utan\s+kostnad|kostnadsfritt)/gi],
        explanation: 'Bra! Du får säga upp avtalet utan kostnad om priset eller villkoren ändras.' },
      { id: 'bra-angerratt-abonnemang', title: '14 dagars ångerrätt', patterns: [/ångerrätt[^.\n]{0,30}14\s+dagar|14\s+dagars\s+ångerrätt/gi],
        explanation: 'Bra! Avtalet informerar om ångerrätten.' }
    ]
  };

  window.AvtalsRules = { common, types: { hantverkare, hyra, gym, avbetalning, abonnemang }, findAll, has, toNumber };
})();
