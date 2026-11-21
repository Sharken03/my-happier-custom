# Parallelle session-metadata-skrivninger: hvor grænsen går

Målt 14/11-2026 på OnePlus 8T (Termux), Pi-session `cmwfmxox904crs6acfi2wydxo`,
gennem session runneren (host tool-call pipe).

## Grænsen

| Parallelle `change_title` | Tid pr. kald | Fejl |
|---|---|---|
| 4 | 0,25–0,69 s | 0 |
| 8 | 0,4–1,6 s | 2 af 8 (`Metadata update conflict`) |
| 10 | 5,6–27 s | 2–6 af 10 (HTTP 500 på `/v2/sessions/:id`) |

Ved 10 kald loggede relayen `PrismaClientKnownRequestError P1008 — Socket timeout` i
`session-publisher-presence` (`db.session.updateMany()`), og alle svar blev frigivet i samme
millisekund, da den sidste gav op.

## Hvorfor

- `serveToolCalls` (`apps/cli/src/cli/commands/toolsServe.ts`) er concurrent: 10 linjer på
  pipen giver 10 samtidige `runCall`.
- Hvert kald går gennem `updateSessionMetadataForTarget` → `resolveSessionTransportContext`
  (GET `/v2/sessions/:id`) → `updateSessionMetadataWithRetry`, som **åbner en ny socket.io-
  forbindelse pr. kald** og emitter `update-metadata` med `expectedVersion` (optimistisk
  versionskontrol, op til 6 forsøg).
- 10 samtidige sockets for samme session, som runneren selv er live publisher på, udløser
  relayens presence-fence pr. socket. På en telefon-hostet relay med SQLite/Prisma giver det
  DB-timeout, hvorefter GET/PATCH svarer 500.
- Uden en live publisher (test med `happier tools serve` direkte, 10 linjer på én gang) kom alle
  svar på 0,85–1,87 s som pæne `Metadata update conflict`. Selve pipe-håndteringen er altså ikke
  serialiseret; det er socket- og DB-vejen, der køer.

## Normal brug

Ikke ramt: værktøjer sendes typisk 2–4 ad gangen, og kun metadata-skrivende værktøjer
(`change_title`, `session.mode.set`, `session.goal.set`, `session.archive`) bruger vejen.
Læsende værktøjer er upåvirkede. I 107 andre Pi-sessioner er der nul forekomster af
`Unexpected status from /v2/sessions`; alle 18 ligger i testsessionen.

## Mulige retninger (ikke gjort)

- Genbrug én session-control-socket pr. session, eller serialisér metadata-skrivninger pr.
  session i processen.
- Gør presence-fencen billigere/batch, så N sockets ikke giver N `updateMany`.
- Gør 500 fra GET/PATCH retryable med backoff i stedet for at fejle kaldet.
