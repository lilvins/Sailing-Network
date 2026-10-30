# Allenamento del bot — cosa ha imparato

> Generato da `npm run train:autosim`. Ultimo aggiornamento: 2026-10-29T22:15:46.680Z. Partite giocate in tutto: 20000.
> Teoria dei pesi: [teoria-del-vantaggio.md](teoria-del-vantaggio.md). Un cambio si adotta solo se il Pro con il peso nuovo batte quello col peso attuale in modo significativo (test dei segni, p < 0.05).

## Conclusione della prima notte (2026-10-29)

- **20.000 partite, 100 tentativi, 1 cambio adottato** (`counter` da 10 a 7,5).
- **Conferma su 600 partite nuove**: 7,5 contro 10 dà il 50,5%, cioè nessun effetto. Il cambio era un falso positivo: su 100 tentativi a p < 0,05 se ne aspettano circa 5 per pura fortuna. È stato **annullato**.
- **Lettura.** Cambiare un peso alla volta del ±25% non sposta niente: tutti i tentativi stanno tra 44% e 58%, cioè nel rumore. I pesi ricavati dalla teoria sono già vicini a un ottimo piatto. Il margine vero non sta nel ritoccare questi pesi, ma in:
  1. pesi per Leader e per matchup;
  2. i mazzi su cui il bot gioca male (Kaido OP17-058: 1 vittoria su 14 contro il Greedy);
  3. la ricerca.
- **Forza attuale** (valutazione v2, sia per il Pro sia per il Greedy): Pro contro Greedy **64,1%** su 128 partite in coppia (era 61,7% con la v1), 61 ms a decisione.

## Pesi attuali

| Peso | Di partenza | Adesso | |
|---|---|---|---|
| myLifeBase | 70 | 70 |  |
| oppLifeBase | 70 | 70 |  |
| lifeConvex | 20 | 20 |  |
| hand | 6 | 6 |  |
| oppHand | 5 | 5 |  |
| counter | 10 | 10 | |
| chars | 12 | 12 |  |
| powerDivisor | 100 | 100 |  |
| blocker | 8 | 8 |  |
| don | 12 | 12 |  |
| rested | 2 | 2 |  |
| expendableCost | 1 | 1 |  |
| pressure | 15 | 15 |  |
| lethalBonus | 60 | 60 |  |
| roleShift | 0.15 | 0.15 |  |

## Ultimi tentativi (dal più recente)

| # | Peso | Cambio | Vinte-perse | p | Esito |
|---|---|---|---|---|---|
| 99 | pressure | 15 → 11.25 | 100-100 | 0.5282 | scartato |
| 98 | lethalBonus | 60 → 45 | 101-99 | 0.4718 | scartato |
| 97 | powerDivisor | 100 → 125 | 95-105 | 0.7816 | scartato |
| 96 | roleShift | 0.15 → 0.188 | 107-93 | 0.179 | scartato |
| 95 | rested | 2 → 2.5 | 105-95 | 0.2623 | scartato |
| 94 | don | 12 → 15 | 98-102 | 0.6381 | scartato |
| 93 | blocker | 8 → 10 | 101-99 | 0.4718 | scartato |
| 92 | chars | 12 → 15 | 96-104 | 0.7377 | scartato |
| 91 | oppHand | 5 → 6.25 | 98-102 | 0.6381 | scartato |
| 90 | hand | 6 → 7.5 | 99-101 | 0.584 | scartato |
| 89 | myLifeBase | 70 → 87.5 | 95-105 | 0.7816 | scartato |
| 88 | oppLifeBase | 70 → 87.5 | 104-96 | 0.3104 | scartato |
| 87 | lifeConvex | 20 → 25 | 107-93 | 0.179 | scartato |
| 86 | counter | 7.5 → 9.375 | 106-94 | 0.2184 | scartato |
| 85 | pressure | 15 → 18.75 | 102-98 | 0.416 | scartato |
| 84 | lethalBonus | 60 → 75 | 95-105 | 0.7816 | scartato |
| 83 | powerDivisor | 100 → 75 | 105-95 | 0.2623 | scartato |
| 82 | roleShift | 0.15 → 0.112 | 101-99 | 0.4718 | scartato |
| 81 | rested | 2 → 1.5 | 97-103 | 0.6896 | scartato |
| 80 | don | 12 → 9 | 98-102 | 0.6381 | scartato |
| 79 | blocker | 8 → 6 | 93-107 | 0.8556 | scartato |
| 78 | chars | 12 → 9 | 109-91 | 0.1146 | scartato |
| 77 | oppHand | 5 → 3.75 | 102-98 | 0.416 | scartato |
| 76 | hand | 6 → 4.5 | 107-93 | 0.179 | scartato |
| 75 | myLifeBase | 70 → 52.5 | 101-99 | 0.4718 | scartato |
| 74 | oppLifeBase | 70 → 52.5 | 98-102 | 0.6381 | scartato |
| 73 | lifeConvex | 20 → 15 | 104-96 | 0.3104 | scartato |
| 72 | counter | 7.5 → 5.625 | 92-108 | 0.8854 | scartato |
| 71 | pressure | 15 → 11.25 | 105-95 | 0.2623 | scartato |
| 70 | lethalBonus | 60 → 45 | 104-96 | 0.3104 | scartato |
| 69 | powerDivisor | 100 → 125 | 91-109 | 0.9105 | scartato |
| 68 | roleShift | 0.15 → 0.188 | 109-91 | 0.1146 | scartato |
| 67 | rested | 2 → 2.5 | 97-103 | 0.6896 | scartato |
| 66 | don | 12 → 15 | 93-107 | 0.8556 | scartato |
| 65 | blocker | 8 → 10 | 102-98 | 0.416 | scartato |
| 64 | chars | 12 → 15 | 99-101 | 0.584 | scartato |
| 63 | oppHand | 5 → 6.25 | 96-104 | 0.7377 | scartato |
| 62 | hand | 6 → 7.5 | 102-98 | 0.416 | scartato |
| 61 | myLifeBase | 70 → 87.5 | 98-102 | 0.6381 | scartato |
| 60 | oppLifeBase | 70 → 87.5 | 102-98 | 0.416 | scartato |
| 59 | lifeConvex | 20 → 25 | 102-98 | 0.416 | scartato |
| 58 | counter | 7.5 → 9.375 | 101-99 | 0.4718 | scartato |
| 57 | pressure | 15 → 18.75 | 96-104 | 0.7377 | scartato |
| 56 | lethalBonus | 60 → 75 | 92-108 | 0.8854 | scartato |
| 55 | powerDivisor | 100 → 75 | 104-96 | 0.3104 | scartato |
| 54 | roleShift | 0.15 → 0.112 | 107-93 | 0.179 | scartato |
| 53 | rested | 2 → 1.5 | 103-97 | 0.3619 | scartato |
| 52 | don | 12 → 9 | 97-103 | 0.6896 | scartato |
| 51 | blocker | 8 → 6 | 98-102 | 0.6381 | scartato |
| 50 | chars | 12 → 9 | 100-100 | 0.5282 | scartato |
| 49 | oppHand | 5 → 3.75 | 96-104 | 0.7377 | scartato |
| 48 | hand | 6 → 4.5 | 89-111 | 0.9482 | scartato |
| 47 | myLifeBase | 70 → 52.5 | 96-104 | 0.7377 | scartato |
| 46 | oppLifeBase | 70 → 52.5 | 103-97 | 0.3619 | scartato |
| 45 | lifeConvex | 20 → 15 | 103-97 | 0.3619 | scartato |
| 44 | counter | 10 → 7.5 | 116-84 | 0.0141 | **adottato** |
| 43 | pressure | 15 → 11.25 | 103-97 | 0.3619 | scartato |
| 42 | lethalBonus | 60 → 45 | 103-97 | 0.3619 | scartato |
| 41 | powerDivisor | 100 → 125 | 92-108 | 0.8854 | scartato |
| 40 | roleShift | 0.15 → 0.188 | 98-102 | 0.6381 | scartato |
