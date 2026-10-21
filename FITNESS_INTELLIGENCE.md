# Fitness Intelligence – Bestandsaufnahme, Vergleich, Architektur, Roadmap

Stand 21.10.2026. Grundlage: Fork `personal` (Basis v1.8.0 + 26 eigene Commits),
Upstream `CodeWithCJ/SparkyFitness` `main`, Homeserver-Repo (`apps/sparkyfitness`,
`apps/automation/homelab-agent`, `apps/openclaw`, `apps/hani-advisor`,
`apps/automation/sparky-garmin-sync`). Alles unter „verifiziert“ ist im Code
nachgesehen; Garmin-Connect+-Angaben stammen aus Testberichten (Quellen am Ende),
nicht von einer offiziellen Garmin-Seite.

---

## A. Technischer Ist-Zustand

### A.1 Das Wichtigste vorab

1. **Es gibt nicht zu wenig, sondern zu viele Coach- und Analyse-Orte.** Fünf
   Systeme werten Trainingsdaten aus, drei davon sprechen mit dir:

   | System | Wo | Was es tut | Spricht mit dir |
   |---|---|---|---|
   | SparkyAI | Fork, `SparkyFitnessServer/ai/`, App `ChatScreen` | Chat mit ~60 Tools (lesen + schreiben), u. a. `sparky_generate_coaching_plan` (7-Tage-Makroplan), `sparky_analyze_trends`, `sparky_detect_patterns`; Provider-Abstraktion für OpenAI, Anthropic, Google, OpenRouter, Ollama u. a. (`ai/config.ts`, `ai/providerDispatch.ts`) | ja, in Sparky |
   | Sparky MCP-Server | Fork, `routes/mcpRoutes.ts`, `ai/mcp/` | dieselben Tools als MCP; Nur-Lese-Keys bekommen nur lesende Tools (`toolAccess.ts`) | – |
   | Performance-Analytics | Fork, `routes/v2/performanceRoutes.ts`, `shared/src/analytics/performance.ts`, Web `/performance`, App „Performance“ | deterministisch: ACWR, HRV-/Ruhepuls-Baseline (z-Score), Schlafkonsistenz, Erholungsschätzung, Wochen-km/Pace, Riegel-Prognosen vs. Garmin, e1RM, Gewichtstrend, Ernährungsmittel | nein |
   | homelab-agent | Homeserver, `app/fitness_*.py`, Cockpit `morning.<domain>/fitness/` | sehr gute deterministische Analyse: Einzeleinheit (`fitness_session.py`, 1 492 Zeilen), Trainingsblock/Stagnation (`fitness_block.py`), Plan-/Datenhygiene (`fitness_reflection.py`), Rückblicke (`fitness_insights.py`), Wochenreview, Morgenbericht, Ernährungs-Plausibilitätsprüfung; eigener Read-Model-Speicher (SQLite) | ja, Telegram |
   | OpenClaw | Homeserver, `apps/openclaw` | laut Doku „owns coaching decisions“: Coach-Einordnung nach jeder neuen Einheit per Telegram, Coaching-Datensätze, Baseline, Zustell-Audit; Zugriff auf Sparky nur über den schema-prüfenden MCP-Guard | ja, Telegram/Web |

   Dein Ziel „eine Coaching-Erfahrung in SparkyFitness“ ist deshalb vor allem
   eine **Konsolidierungsaufgabe**, kein Neubau.

2. **Der Fork hängt 866 Upstream-Commits hinterher** (Basis v1.8.0). Upstream baut
   gerade genau in deinem Zielbereich: RPE-Insights (#3008), Lauftrends (#2931),
   Pace-Zonen aus Wettkampfzeiten, Belastungs-/Effort-Trends, nächtliche HRV an
   Schlafeinträgen (#3003), Garmin-MFA-Fix (#2995). Wer jetzt Analytics im Fork
   baut, baut vieles doppelt.

3. **Produktion läuft nicht auf dem Fork** – und soll es laut Entscheidung vom
   21.10.2026 auch nicht: fitness-next läuft dauerhaft daneben (nächtliche Kopie).
   Ursprünglicher Befund: `sparkyfitness-server` ist Upstream
   v1.8.0 plus Patch-Overlays aus `apps/sparkyfitness/patches/` (Garmin-Session-
   Merge, Sync-Scheduler, Tageszusammenfassung …). Der Fork läuft nur auf Staging
   (`fitness-next`). Fork-Features (Uhr, Performance) erreichen dich im Alltag erst
   nach der Umstellung.

### A.2 Komponenten im Einzelnen

**Daten (verifiziert)**
- Garmin über den Sparky-Garmin-Microservice (`SparkyFitnessGarmin/service.py`,
  inoffizielle Bibliothek `garminconnect` 0.3.5): Aktivitäten, Schritte, Puls,
  HRV, Schlaf, Stress, Body Battery, Atmung, VO₂max (`get_max_metrics`), Training
  Readiness, Training Status, Endurance/Hill Score, Laktatschwelle,
  Wettkampfprognosen, Fitness-Alter, Körperzusammensetzung, Blutdruck,
  Hydration, Garmin-Ernährungstagebuch. Fork-Ergänzung: Training Load und
  Training Effect pro Aktivität. **Risiko:** inoffizielle API, kann jederzeit
  brechen; Garmin bietet Endkunden keine offizielle API.
- Krafttraining: Sets/Wdh./Gewicht/RPE/RIR, Vorlagen, Pläne, Statistiken, PRs
  (Upstream). Sparky → Garmin-Rückschreiben der Übungsliste über
  `sparky-garmin-sync` (gccli, Homeserver).
- Ernährung, Gewicht, Körpermaße, Check-ins, Stimmung, Symptome (Upstream).

**Algorithmen (verifiziert)**
- Upstream: adaptives TDEE (`AdaptiveTdeeService.ts`), adaptive Satzvorgaben mit
  Erklärung und Rückgängig (`adaptiveWorkoutService.ts`, App
  `AdaptiveSuggestionBanner`), Plan-Progression (`workoutPlanProgression.ts`),
  Schlafwissenschaft (`sleepScienceTools.ts`), Session-Feedback.
- Fork: `shared/src/analytics/performance.ts` (siehe Tabelle). Die
  Erholungsschätzung `recoveryEstimate` ist eine **eigene, nicht validierte
  Formel** (gleich gewichtete Komponenten, Schlaf linear bis 8 h). Sie zeigt ihre
  Komponenten, sollte aber deutlicher als Schätzung markiert werden.
- homelab-agent: die reifste Trainingslogik im ganzen Bestand (Wiederholungs-
  bereich-Prüfung je Übung, Stagnation über Einheiten, Plan-vs-Ist-Abweichung,
  Datenqualität), auf Deutsch, mit vielen Live-Korrekturen aus der Praxis.

**Oberflächen**
- Sparky Web: Dashboard, Berichte, Performance (Fork), Einstellungen.
- Sparky App (iOS, SideStore): Dashboard mit Readiness (Fork), Performance
  (Fork), Chat (SparkyAI), Live-Workout, Apple-Watch-App (Upstream), Garmin-Uhr
  inkl. Live-Sync (Fork, 1.8.3).
- Außerhalb: Fitness-Cockpit (homelab-agent), Telegram (homelab-agent + OpenClaw).

**Benachrichtigungen:** Die App plant nur lokale Benachrichtigungen
(`services/notifications.ts`; Rest-Timer, Medikamente, Symptome). Push fehlt im
Sideload-Build (kostenlose Apple-ID). Server-ausgelöste Hinweise laufen heute
über Telegram (homelab-agent/OpenClaw) bzw. ntfy.

**Sicherheit (verifiziert)**
- SparkyAI-SQL-Tools (`sparky_execute_read_only_sql`, `sparky_query_table`) nur
  für Admins und nur mit `DEV_TOOLS_ENABLED=true`.
- Nur-Lese-API-Keys: Middleware blockiert schreibende Methoden, MCP blendet
  schreibende Tools aus.
- OpenClaw: kein direkter Backend-Zugriff, alles über den MCP-Guard mit
  Schema-Prüfung, Sparky-Schreibzugriffe eng begrenzt.
- RLS auf allen neuen Tabellen; Uhr-Keys eigens verwaltet (`watch_devices`).

### A.3 Technische Schulden mit Gewicht

1. Upstream-Rückstand (866 Commits) und Produktions-Overlays statt Fork.
2. Garmin über inoffizielle API.
3. Drei Coach-Oberflächen mit drei Kontextmodellen und zwei Speichern für
   Coaching-Historie (homelab-agent-SQLite, OpenClaw-Datensätze).
4. Trainingslogik in Python (homelab-agent) und TypeScript (Sparky) getrennt.
5. Native Garmin-Brücke bisher nur im CI gebaut, nicht auf Geräten getestet.

---

## B. Garmin Connect+ im Vergleich

Legende Sparky aktuell: ✅ vorhanden · 🟡 teilweise · 🔧 vorhanden, verbesserungswürdig · ❌ fehlt · ⛔ nicht sinnvoll.
Connect+-Spalte: was laut Testberichten hinter dem Abo liegt (S1 = the5krunner
04/2026, aktualisiert 10/2026; S3 = DC Rainmaker 03/2025).

| Funktion | Garmin Connect+ | Sparky aktuell | Geplante Verbesserung | Priorität |
|---|---|---|---|---|
| KI-Tageseinordnung („Active Intelligence“) | KI-Texte morgens, nach dem Training, abends; laut S1 „thin insights“ | 🟡 Morgenbericht + Coach nach der Einheit, aber in Telegram, nicht in Sparky | Tageskarte „Wichtigste Erkenntnis“ in Sparky aus deterministischen Befunden, LLM nur für die Formulierung | hoch |
| Performance Dashboard (frei kombinierbare Diagramme) | ja, nur Web, ~123 Elemente (S3) | 🟡 feste Performance-Seite (Web + App) | Vergleichsdiagramm mit 2 frei wählbaren Kennzahlen, mobil; Korrelation nur als Beobachtung | hoch |
| Live Activity (Indoor-Workout live am Handy) | ja, nur Indoor, Start an der Uhr | ✅ Apple Watch; Garmin-Live-Sync per Bluetooth neu (1.8.3, ungetestet) | auf Gerät testen, Puls live ans Handy | hoch (läuft) |
| Erweiterte Coach-Inhalte | Videos/Artikel zu Garmin Coach | – | nicht nachbauen | ⛔ |
| LiveTrack per SMS, Profilseite | ja | – | nicht relevant | ⛔ |
| Badges, Challenges | ja | – | nicht relevant | ⛔ |
| Trails+, 3D-Karten | ja | – | nicht relevant | ⛔ |
| Jahresrückblick (Rundown) | ja | ❌ | Monats-/Jahresbericht aus vorhandenen Analysen (billig) | mittel |
| Ernährungstracking | ja, seit 01/2026 | ✅ Sparky ist hier deutlich weiter (Mikros, Fotoerkennung, Rezepte, adaptives TDEE) | Ernährung mit Training verknüpfen (s. u.) | – |
| Training Readiness / Body Battery | frei (Uhr) | ✅ Garmin-Werte importiert + 🔧 eigene Schätzung | eigene Schätzung als „Erklärung der Faktoren“ statt Zahl umbauen | mittel |
| Wettkampfprognosen | frei (Uhr) | ✅ Garmin + Riegel | Unsicherheitsband statt Punktwert | mittel |
| Kraft-Progression je Übung, Stagnation | Garmin kaum (Satz-Erkennung ungenau) | 🟡 Stats/PRs in Sparky, Stagnation nur im homelab-agent | Stagnations-/Plateau-Befund in Sparky sichtbar machen | hoch |
| Volumen je Muskelgruppe | nein | 🟡 homelab-agent `fitness_weekly_volume`, Sparky Muskelkarte | eine Quelle, in Sparky anzeigen | mittel |
| Hybrid-Planung Kraft + Laufen mit Interferenz | nein | ❌ | Konfliktregel „schwere Beine → kein harter Lauf am Folgetag“ als Hinweis | mittel |
| Coach-Vorschläge mit Bestätigung | nein | 🟡 adaptive Vorgaben mit Undo (Upstream); SparkyAI-Tools schreiben teils direkt | Änderungsvorschläge als Diff, erst nach Bestätigung anwenden | hoch |
| Transparenz (Daten, Zeitraum, Sicherheit) | nein | 🟡 OpenClaw-Records, homelab-agent „source-linked“ | Quellen-/Zeitraum-Fußzeile an jeder Coach-Antwort in Sparky | hoch |

**Was Garmin gar nicht bietet und Sparky kann:** Krafttraining mit echter Satz-
historie und Progression, Ernährung mit Mikros und Fotoerkennung, adaptives TDEE,
Verknüpfung Ernährung ↔ Training ↔ Gewicht, eigene Daten ohne Abo.

---

## C. Architekturvorschlag

### C.1 Leitentscheidung: Sparky wird der Ort, OpenClaw/homelab-agent werden Zulieferer

| Ansatz | Vorteil | Nachteil |
|---|---|---|
| **1. Sparky = einzige Oberfläche, Analysen bleiben wo sie sind und liefern Befunde an Sparky** *(Empfehlung)* | keine Doppelarbeit, die reife Python-Logik bleibt, Sparky zeigt alles an einer Stelle, Telegram kann bleiben als Kanal | eine schmale Schnittstelle „Befunde“ nötig |
| 2. Alles nach Sparky portieren (TS) | ein Codebasis | Monate Arbeit, die Python-Logik ist sehr detailliert, hohes Risiko |
| 3. Cockpit/OpenClaw als Haupt-UI | schon da | widerspricht „Sparky ist die zentrale App“, keine mobile Integration |

**Vorschlag im Detail**

1. **Befunde als gemeinsames Format.** Ein kleines, versioniertes Schema
   `FitnessFinding` in `shared/` (`id`, `kind` [observation | hypothesis | finding],
   `title`, `detail`, `evidence[]` [Kennzahl, Zeitraum, Quelle], `confidence`,
   `missing[]`, `suggestedAction?`). Deterministische Erzeuger: Sparky selbst
   (Performance, adaptive Vorgaben) und der homelab-agent (Session/Block/Reflexion).
2. **Speicher in Sparky.** Eine Tabelle `fitness_findings` (owner-only RLS); der
   homelab-agent schreibt per API-Key mit eng begrenztem Scope
   (`POST /api/v2/findings`), statt in sein eigenes SQLite.
3. **Coach in Sparky = SparkyAI**, nicht ein vierter Coach. Er bekommt ein Tool
   `sparky_get_findings` und antwortet mit Quellen-Fußzeile. OpenClaw kann weiter
   über MCP lesen und Telegram bedienen, hält aber keine eigene Wahrheit mehr.
4. **Änderungen nur als Vorschlag.** Neues Konzept „Plan-Vorschlag“: der Coach
   (oder eine Regel) erzeugt einen Diff auf Plan/Vorlage, die App zeigt ihn, erst
   „Übernehmen“ schreibt. Schreibende SparkyAI-Tools für Pläne laufen über diesen
   Weg.
5. **Mobile:** keine neue Navigation. Dashboard bekommt die Karte „Heute
   wichtig“ (Top-Befund + Erholungsfaktoren), Performance bekommt den
   Vergleichsmodus, der Chat zeigt Befunde und Vorschläge als Karten.
6. **Upstream-Kompatibilität:** neue Teile als eigene Module/Routen/Tabellen
   (wie bisher `watch*`), keine Änderungen an Upstream-Kernservices; vor jedem
   größeren Feature erst Upstream einarbeiten.

**MCP ja oder nein:** Für Sparky ↔ homelab-agent reicht eine REST-Route
(einfacher, testbarer). MCP bleibt für OpenClaw/externe Agents, wo es schon
sauber mit Guard läuft.

**Modellwahl:** Provider-Abstraktion ist in Sparky vorhanden (inkl. OpenRouter
und Ollama). Befunde sind deterministisch und kosten kein Modell; das LLM
formuliert nur. Ein günstiges Modell reicht für Tageskarten, ein starkes nur für
Chat-Fragen.

---

## D. Priorisierte Roadmap

| # | Schritt | Nutzen | Aufwand | Risiko | Warum jetzt |
|---|---|---|---|---|---|
| 0 | Garmin-Live-Sync auf Uhr + iPhone testen und nachbessern | sehr hoch | klein–mittel | mittel | läuft gerade, dein akutes Problem |
| 1 | ✅ **Upstream eingearbeitet** (v1.8.0 → 1.9.0), Produktions-Overlays im Fork. Entscheidung 21.10.: Produktion bleibt das normale Sparky; fitness-next läuft dauerhaft parallel und wird jede Nacht aus der Produktion kopiert | sehr hoch | erledigt | – | ohne das hätten wir Upstream-Features doppelt gebaut |
| 2 | 🟡 `FitnessFinding`-Schema + Route erledigt (`shared/src/analytics/insights.ts`, `GET /api/v2/insights/today` und `/report`). Befunde werden bei jeder Abfrage deterministisch berechnet, ohne Tabelle und ohne Migration. Offen: homelab-agent liefert Session-/Block-/Reflexionsbefunde an Sparky | hoch | mittel | klein | vereint die beste vorhandene Logik mit der zentralen App |
| 3 | ✅ „Heute wichtig“: App-Dashboard-Karte und Insights-Seite, Web-Abschnitt „Insights“ auf `/performance`. Jeder Befund zeigt Art (Beobachtung/möglich/gemessen), Sicherheit, Belege und fehlende Signale. Die optionale KI-Zusammenfassung über den eigenen KI-Dienst ist gekennzeichnet | hoch | erledigt | – | direkter, täglicher Nutzen |
| 4 | SparkyAI: `sparky_get_findings`, Quellen-Fußzeile, Plan-Vorschläge mit Bestätigung | hoch | mittel | mittel | ein Coach statt drei |
| 5 | ✅ Vergleichsmodus: zwei Kennzahlen inklusive e1RM je Übung, auf den eigenen Bereich normiert. Bei Wochenwerten wird wochenweise gebündelt. Pearson-r erscheint erst ab 8 Paaren, immer mit dem Hinweis „Beobachtung, keine Ursache“. Web und App | mittel–hoch | erledigt | – | ersetzt Garmins Performance Dashboard |
| 6 | 🟡 Wochen-/Monatsbericht in Sparky erledigt: letzte volle Woche bzw. letzter Monat, Deltas zum Zeitraum davor, Bestwerte, Befunde. Offen: Zustellung über Telegram/ntfy | mittel | klein | klein | Daten sind dann schon da |
| 7 | Hybrid-Hinweise (Beintag ↔ harter Lauf), Prognosen mit Unsicherheitsband | mittel | mittel | klein | sobald 2 steht |
| ⛔ | Trails, 3D-Karten, Badges, LiveTrack-SMS, Coach-Videos | – | – | – | kein Nutzen für dich |

Kleine, risikoarme Sofortpunkte (ohne Architekturentscheidung):
- Erholungsschätzung in Web/App klar als „Schätzung, nicht validiert“ kennzeichnen
  und ihre Faktoren zeigen.
- Prognosen mit Spannweite (Garmin vs. Riegel) statt Einzelwert.

## Offene Entscheidungen für dich

1. Konsolidierung nach C.1 (Sparky zentral, homelab-agent liefert Befunde,
   SparkyAI ist der Coach, OpenClaw nur noch Kanal)?
2. Upstream-Rebase vor neuen Features (Schritt 1)?

## Quellen (Garmin Connect+)

- S1: the5krunner, „Garmin Connect+ Reviewed: Still Not Worth It After a Year“, 20.04.2026, aktualisiert 08.10.2026 – https://the5krunner.com/2026/04/20/garmin-connect-plus-review/
- S3: DC Rainmaker, „Garmin Connect+ Paid Subscription: Hands-on“, 27.03.2025 – https://www.dcrainmaker.com/2025/03/garmin-connect-plus-subscription-walkthrough.html
- Die offizielle Garmin-Seite war nicht abrufbar (404); Funktionsumfang daher aus Testberichten.
