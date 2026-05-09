# BooksClub Chrome Extensions

Dwa rozszerzenia Chrome do automatycznego pobierania audiobooków i ebooków z [booksclub.pl](https://booksclub.pl) przez MEGA.nz.

---

## 📦 BooksClub Smart Downloader v1.5.3

Główne rozszerzenie z trybem seryjnym (batch) i pojedynczym.

### Funkcjonalność

**Tryb pojedynczy** — na stronie wątku z audiobookiem pojawia się zielony przycisk `⬇️ Pobierz plik`. Po kliknięciu rozszerzenie otwiera kartę MEGA.nz, automatycznie klika przycisk pobierania i wraca na booksclub.pl.

**Tryb seryjny (batch)** — na stronie listy wątków pojawia się przycisk `📋 Pobierz listę`. Po kliknięciu otwiera się panel z listą wszystkich audiobooków na stronie. Możesz zaznaczyć wybrane pozycje i uruchomić pobieranie jednym kliknięciem.

### Instalacja

1. Pobierz folder `booksclub-smart-downloader/` z tego repozytorium
2. Otwórz Chrome → `chrome://extensions/`
3. Włącz **Tryb dewelopera** (górny prawy róg)
4. Kliknij **Załaduj rozpakowane** i wskaż folder rozszerzenia

### Jednorazowa konfiguracja Chrome

Aby pobieranie seryjne działało bez dialogów "Zapisz jako":

1. Otwórz `chrome://settings/downloads`
2. Wyłącz **"Pytaj gdzie zapisać każdy plik przed pobraniem"**
3. Ustaw domyślny folder pobierania według własnych preferencji

Przycisk **⚙️ Change folder** w panelu otwiera te ustawienia bezpośrednio.

### Jak działa panel seryjny

```
Otwierasz listę na booksclub.pl
        ↓
Klikasz "📋 Pobierz listę"
        ↓
Otwiera się panel z listą wątków
Wszystkie pozycje domyślnie zaznaczone ✅
        ↓
Klikasz "↓ Download (N)"
        ↓
Dla każdej pozycji:
  1. Otwiera wątek w tle → szuka linku MEGA
  2. Otwiera MEGA → klika przycisk Pobierz
  3. Czeka na zamknięcie karty MEGA
  4. Przechodzi do następnej pozycji
        ↓
Po zakończeniu:
  ✓ All done | Downloaded: N | Total time: Xm Ys
  Jeśli błędy → automatyczny retry po 3 sekundach
```

### Statusy na liście

| Status | Znaczenie |
|--------|----------|
| `waiting` | Oczekuje w kolejce |
| `in progress` | Aktualnie pobierany |
| `done` | Pobrano ✓ |
| `no file` | Brak linku MEGA w wątku |
| `error` | Błąd — zostanie ponowiony |
| `skipped` | Pominięty (Stop) |

---

## 🏗️ Architektura techniczna

### Pliki

| Plik | Rola |
|------|------|
| `background.js` | Service Worker — kolejka, zarządzanie kartami, stan |
| `content_booksclub.js` | Przyciski na stronach booksclub.pl |
| `content_mega.js` | Obserwacja postępu pobierania na mega.nz |
| `panel.html/js` | UI panelu seryjnego |
| `popup.html/js` | Popup ikony rozszerzenia |
| `manifest.json` | Konfiguracja MV3 |

### Kluczowe rozwiązania MV3

**Problem: Service Worker zasypia**
Chrome MV3 usypia service workera po ~30 sekundach bezczynności, co niszczyło stan kolejki.

Rozwiązanie:
- Stan kolejki persystowany w `chrome.storage.local` (klucze: `bsdQ`, `bsdActive`, `bsdPanel`, `bsdMega` itp.)
- Port `panel-keepalive` z panelu trzyma SW aktywnym podczas pobierania
- Alarm `swKeepAlive` co 24 sekundy sprawdza stan i wznawia jeśli zacięte
- Przy przebudzeniu SW: `inprogress` bez `megaTabId` → reset do `waiting`

**Problem: Kliknięcie przycisku MEGA blokowane**
Nowe MEGA (2025) sprawdza `event.isTrusted` — programatyczny click z content scriptu był odrzucany.

Rozwiązanie:
- `background.js` wykonuje `chrome.scripting.executeScript({ world: 'MAIN' })` na karcie MEGA
- Skrypt w MAIN world ma dostęp do kontekstu strony → `element.click()` jest traktowane jako zaufany gest

**Problem: Kolejka się blokuje**
Wykrywanie zakończenia pobierania przez wiadomości (`downloadDone`) było zawodne — MEGA używa Blob URL.

Rozwiązanie:
- Globalny `chrome.tabs.onRemoved` śledzi zamknięcie karty MEGA
- Zamknięcie karty = sygnał zakończenia → kolejka przechodzi do następnej pozycji
- Listener zarejestrowany globalnie (nie w closure) — przeżywa restart SW

**Problem: Wylogowanie z booksclub.pl**
Długie pobieranie powodowało wygaśnięcie sesji → błędy przy otwieraniu wątków.

Rozwiązanie:
- Alarm `antiLogout` co 3 minuty
- `executeScript` na karcie booksclub wykonuje `fetch()` z ciasteczkami sesji — odświeża token bez przeładowania strony

### Przepływ danych

```
content_booksclub.js
    │ chrome.runtime.sendMessage('openPanel')
    ▼
background.js (Service Worker)
    │ chrome.tabs.create → panel.html
    │ chrome.storage.local.set({ autoSaveActive: true })
    ▼
panel.js
    │ chrome.runtime.connect('panel-keepalive')  ← trzyma SW żywym
    │ sendMessage('startQueue', queue)
    ▼
background.js: processNext()
    │ chrome.tabs.create(threadUrl, active:false) → szuka MEGA URL
    │ chrome.tabs.create(megaUrl, active:true)
    │ executeScript(world:'MAIN') → btn.click()  ← trusted event
    │
    │ chrome.tabs.onRemoved ← karta MEGA zamknięta
    ▼
next item → processNext() → ...
```

---

## ⚙️ Wymagania

- Chrome 120+
- Aktywne konto na [booksclub.pl](https://booksclub.pl)
- Wyłączona opcja "Pytaj gdzie zapisać" w Chrome (dla trybu batch)

---

## 📝 Historia wersji

| Wersja | Zmiany |
|--------|--------|
| 1.5.3 | Kliknięcie MEGA w MAIN world (isTrusted fix) |
| 1.5.0 | Zamknięcie karty jeśli brak przycisku → odblokowanie kolejki |
| 1.4.9 | Fix: reset inprogress→waiting po restarcie SW |
| 1.4.8 | Globalny onTabRemoved + alarm keepalive |
| 1.4.5 | Timer całkowitego czasu, auto-retry nieudanych |
| 1.4.2 | Przepisanie na architekturę event-driven |
| 1.3.x | Folder picker, auto-save, naprawy UI |
| 1.2.x | Pierwsza wersja z panelem batch |

---

*Rozszerzenie stworzone z pomocą Claude (Anthropic) — iteracyjne debugowanie MV3 service worker lifecycle, MEGA UI changes i Chrome security model.*