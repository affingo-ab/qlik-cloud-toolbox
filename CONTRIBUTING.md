# Utvecklarguide & Riktlinjer för Bidrag (Contributing Guide)

Välkommen till **Qlik Cloud Toolbox**, utvecklat av och för **Affingo AB**.

Detta dokument beskriver projektets arkitektur, utvecklingsmiljö och riktlinjer för hur både konsulter och AI-assistenter (Mates) samarbetar för att bygga och underhålla pålitlig, högkvalitativ mjukvara.

---

## 🏛️ Arkitektur & Teknikstack

Applikationen är en modern SPA (Single Page Application) byggd med:
* **Frontend:** React 19, TypeScript
* **Byggverktyg & Dev Server:** Vite
* **Stil & UI:** Tailwind CSS / CSS Modules
* **Ikoner:** Lucide React
* **Hosting & CI/CD:** Vercel (hosting) och GitHub Actions (automatiserad linting och byggtest)

### Mappstruktur

```text
├── api/             # Eventuella serverless API-funktioner (Vercel)
├── src/
│   ├── components/  # Återanvändbara UI-komponenter
│   ├── types/       # TypeScript-typer och datamodeller
│   ├── assets/      # Statiska resurser, ikoner och bilder
│   ├── App.tsx      # Huvudapplikation och flikhantering
│   ├── CapacityOptimization.tsx      # Kapacitets- och licensoptimering
│   ├── SemanticUnderstandingTab.tsx  # Semantiska modeller & ordförråd
│   ├── SpacePermissionMatrix.tsx     # Behörighetsmatris för spaces
│   └── sanitizer.ts # Hjälpfunktioner för datasanering
├── .github/
│   └── workflows/   # CI/CD-konfigurationer (GitHub Actions)
└── package.json     # Beroenden och npm-skript
```

---

## 🛠️ Komma igång lokalt

1. **Klona repot:**
   ```bash
   git clone https://github.com/affingo-ab/qlik-cloud-toolbox.git
   cd qlik-cloud-toolbox
   ```

2. **Installera beroenden:**
   ```bash
   npm install
   ```

3. **Starta utvecklingsservern:**
   ```bash
   npm run dev
   ```

4. **Kör typkontroll och linting:**
   ```bash
   npm run lint
   npm run build
   ```

---

## 🤝 Arbetsflöde & Samarbete (Human + Mate Collaboration)

För att säkerställa hög stabilitet och spårbarhet tillämpar vi följande principer:

### 1. Branching-strategi
* **`main` är alltid skyddad och produktionsredo.** All kod som mergas till `main` driftsätts automatiskt till produktion via Vercel.
* Skapa alltid en specifik feature-branch för nytt arbete:
  * `feature/<funktionsnamn>` för ny funktionalitet.
  * `fix/<buggbeskrivning>` för felrättningar.
  * `docs/<ämne>` för dokumentationsuppdateringar.

### 2. Pull Requests (PR) & Granskning
1. Utveckla och testa koden lokalt (eller i sandlådemiljö).
2. Skapa en **Pull Request mot `main`**.
3. Beskriv tydligt:
   * **Vad** som har förändrats.
   * **Varför** förändringen gjorts.
   * **Hur** det har testats.
4. **CI-kontroll:** GitHub Actions kör automatiskt `npm run lint` och `npm run build`. PR:en ska ha en grön bock innan merge.
5. **Code Review:** Minst en person (eller granskande Mate) granskar och godkänner PR:en innan den mergas.

### 3. Kodkvalitet & Konventioner
* **TypeScript First:** Använd strikta typer. Undvik `any`.
* **Säkerhet:** Committa aldrig API-nycklar, tokens eller känslig kunddata. Använd miljövariabler (`.env`) vid behov.
* **Tonalitet & Affingo-anda:** Ren, välstrukturerad och läsbar kod som är enkel att vidareutveckla för nästa kollega.

---

*Har du frågor eller idéer på förbättringar? Skapa en Issue eller ta upp det i teamchatten!*
