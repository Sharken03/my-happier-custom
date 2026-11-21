# Lokal typecheck på 8T: resultat (17/11-2026)

Script: `scripts/typecheck-local.sh <ui|cli|protocol|agents|...>` (planlægger: `tools/typecheck-local/steps.mjs`).
Det kører den native TS 7-compiler via `runTypeScriptCli.mjs` med `--singleThreaded --checkers 1`,
`GOMEMLIMIT` = 3/4 af loftet, `GOGC=25`, incremental med `.tsbuildinfo` i `~/.cache/happier-typecheck`.
Det måler RSS for hele procestræet hvert 0,5 s og dræber sin egen procesgruppe over loftet
(standard 1200 MB). Exit: 0 = ok, 2 = typefejl, 137 = loft ramt (resultat ugyldigt), 75 = for lidt fri RAM.

## Målinger (peak RSS / tid inkl. ca. 3 s planlægning)

| Mål | Kold | Varm (ingen ændring) |
|---|---|---|
| protocol | 410 MB / 14,6 s | 102 MB / 4,2 s |
| agents | 162 MB / 7,8 s | 157 MB / 7,0 s |
| cli-common | 247 MB / 9,8 s | 206 MB / 4,6 s |
| transfers | 113 MB / 2,8 s | 101 MB / 2,7 s |
| connection-supervisor | 84 MB / 2,1 s | 85 MB / 2,3 s |
| cli | dræbt ved 1235 MB efter 18 s | - |
| ui | dræbt ved 1204 MB efter 28 s (trin 1) | - |

- Varm kørsel efter en ændring inde i en funktion (kopi af protocol): 109 MB, 3 s.
  Efter en ændring af eksporterne i en central fil (`lazySchema.ts`): 392 MB, 10,6 s (næsten koldt).
- Typefejl i en midlertidig kopi blev rapporteret (`TS2322`, exit 2). Kopien er slettet.

## Hvorfor cli og ui ikke kan under 1,2 GB
- Det er vores egen kildekode, ikke node_modules: cli har 48 MB TS (28 MB tests), ui 76 MB (35 MB tests).
  I cli-programmet er 19 MB af 31 MB indlæste filer vores egen `src`.
- Kun at parse (`--listFilesOnly`) koster ca. 25-30 byte RAM pr. byte kilde: cli 349 MB (6 MB kilde)
  til 1067 MB (36 MB); over 1,2 GB ved 42 MB. Det fulde program kan altså ikke engang parses under loftet.
- Opdeling hjælper ikke: halvdelen af cli-filerne importerer (transitivt) ca. 19 MB/3000 filer;
  en typisk ui-fil 20 MB/1900 filer. Største importcyklus: cli 807 filer, ui 869 filer.
- Trinvis check (voksende programmer med fælles `.tsbuildinfo`, kun nye filer tjekkes): cli trin 1-3
  gik (644, 683, 1059 MB), trin 4 (25 MB program) ramte loftet. ui trin 1 ramte loftet (oversættelserne
  og filerne med `declare global`/`declare module` trækker allerede et stort program ind).
- Uden effekt (højst ca. 10 %): `GOGC` 10/25/100, `GOMEMLIMIT`, `--declaration false`.
  `skipLibCheck` er allerede slået til. `--builders` virker kun med `--build`.

## Konklusion
- Beslutning 17/11-2026 (brugeren): typecheck af cli og ui bliver i CI indtil videre.
- Pakkerne (`packages/*`) er sikre og hurtige lokalt med scriptet.
- cli og ui er IKKE sikre lokalt med et loft på 1,2 GB. Behold GitHub Actions (`typecheck/<navn>`).
  Skøn (ekstrapoleret, ikke målt): cli kræver mindst ca. 1,4 GB, ui mindst ca. 1,8 GB, alene for at parse.
- Et højere loft (`--cap-mb 1600`) er brugerens beslutning; scriptet starter kun, hvis
  `MemAvailable` er mindst loft + 600 MB. Det er ikke testet over 1,2 GB.
- Obs: `packages/agents/dist` og `packages/protocol/dist` er ældre end deres `src` (scriptet advarer);
  cli/ui læser typerne fra `dist`.
