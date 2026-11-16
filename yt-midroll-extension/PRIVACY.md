# Privacy Policy — ТСН Менеджер (beta) / TSN Ad Manager

*Last updated: November 16, 2026*

This Privacy Policy explains how **ТСН Менеджер (beta)** ("the Extension", Chrome Web Store extension) collects, processes, stores, retains, and transmits user data. It applies to all features of the Extension, including automated mid-roll ad break analysis/placement on YouTube Studio and live stream schedule automation.

---

## 1. Data Collection

Depending on the features you use, the Extension accesses or collects the following categories of data:

1. **Google Account Email (`identity` / `identity.email`)**
   - When sending an operational diagnostic or placement report, the Extension calls `chrome.identity.getProfileUserInfo` to retrieve the signed-in Chrome profile email address so the report shows which team operator triggered the action.
2. **YouTube Studio Page & Media Metadata (`https://studio.youtube.com/*`)**
   - Reads metadata from the currently open YouTube Studio page: video title, video ID, YouTube Studio edit URL, video duration, existing/automatic ad-break timestamps, and live broadcast schedule status/controls.
   - Fetches the authenticated audio waveform file from the YouTube Studio URL intercepted in the active browser tab (`state.waveformUrl`) for silence detection.
3. **User Preferences & Operational State**
   - Extension settings (pause thresholds, rhythm parameters, notification toggles), stream start/end schedule configuration, quality calibration metrics (`mraQualityCalib`), deduplication keys (`tgAnalysisReported`), and local report logs (`tgHistory`).

The Extension does **not** collect browsing history outside `studio.youtube.com`, passwords, payment details, keystrokes outside Studio timestamp controls, or unrelated personal files.

---

## 2. Data Processing & Usage

All collected data is used exclusively to perform the Extension's single core purpose (automating mid-roll ad break placement and scheduled broadcast controls in YouTube Studio):

- **Local Audio Analysis:** Waveform decoding, amplitude envelope calculation, pause/silence detection, 3-zone AVD scheduling, and UI automation run **100% locally inside your browser**. Raw audio waveform bytes are never uploaded to external servers.
- **UI & Schedule Automation:** Uses `tabs`, `windows`, `alarms`, `notifications`, and `scripting` permissions only to open/focus the scheduled YouTube Studio livestream tab, trigger start/stop actions at the configured time, and display local desktop notifications.
- **Operational Error & Quality Reports:** When analysis encounters insufficient pauses or placement issues, the background service worker formats an operational report containing the video title, video ID/URL, duration, quality/timecode summary, and the operator's Chrome profile email address.

We do **not** use user data for advertising, behavioral tracking, profiling, creditworthiness checks, or personalized marketing.

---

## 3. Data Storage, Retention & Deletion

- **Local Extension Storage (`chrome.storage.local`):** Stores notification settings (`notifSettings`), stream scheduler state (`scheduledTime`, `scheduleEnabled`, `actionType`, `endBeforeLaunch`, `pendingLaunch`, `pendingLaunchTs`), mid-roll quality calibration samples (`mraQualityCalib`), 12-hour report deduplication markers (`tgAnalysisReported`), and a local history log of transmitted operational reports (`tgHistory`).
- **Browser `localStorage`:** Stores panel settings (`mraSettings` on `studio.youtube.com`) and popup size preference (`mraPopupSize`).
- **Retention & User Control:** Locally stored data remains in your browser only as long as needed for operation. You can delete all local data at any time by using the Extension's reset button (`↻`), clearing site/extension storage in Chrome, or uninstalling the Extension.
- **Transmitted Report Retention:** Operational reports delivered to the internal Telegram reporting channel are retained according to Telegram's platform terms and the internal channel administrators' retention practices.

---

## 4. Data Transmission & Third-Party Access

- **Google Apps Script Proxy (`https://script.google.com/*`, `https://script.googleusercontent.com/*`):** Operational reports (containing the operator's Google email, video title, video ID/Studio URL, duration, and ad-placement diagnostics) are sent over HTTPS POST to a private Google Apps Script endpoint controlled by the developer (`TG_PROXY_URL`) so bot credentials remain server-side.
- **Telegram Bot API:** The Google Apps Script proxy forwards the formatted operational report to the authorized internal editorial **Telegram** chat/channel.
- **No Sale or Commercial Sharing:** User data is **never sold, rented, or disclosed** to third-party data brokers, advertisers, analytics providers, or any unrelated parties. Access is strictly limited to authorized editorial personnel and the technical transport services listed above (Google Apps Script and Telegram).

---

## 5. Chrome Web Store User Data Policy Compliance

The use of information received from Google APIs and Chrome extension APIs adheres to the **Chrome Web Store User Data Policy**, including the **Limited Use** requirements. User data is never transferred except as necessary to provide the core reporting functionality described above, comply with applicable law, or as explicitly initiated by the user.

---

## 6. Permissions Overview

| Permission / Host | Purpose |
| :--- | :--- |
| `identity`, `identity.email` | Reads the signed-in Google email to sign operator error/status reports in Telegram. |
| `storage` | Persists user settings, livestream schedule, quality calibration, deduplication cache, and report log locally. |
| `alarms`, `tabs`, `windows`, `scripting`, `notifications` | Automates scheduled livestream start/end tabs in YouTube Studio and sends local alerts. |
| `https://studio.youtube.com/*` | Accesses the YouTube Studio ad-breaks editor, waveform URLs, and livestream controls. |
| `https://script.google.com/*`, `https://script.googleusercontent.com/*` | Transmits formatted operational reports via the private Apps Script proxy to Telegram. |

---

## 7. Contact

If you have questions about this Privacy Policy or wish to request deletion of transmitted report data, please contact the developer via the project repository:
- GitHub Repository: [https://github.com/ONiK777/tsn_ad](https://github.com/ONiK777/tsn_ad)

---

### Короткий опис українською

- **Збір даних:** розширення зчитує email авторизованого профілю Google (`identity.email`) для підпису оператора у звітах, метадані відео та аудіо-вейвформу зі сторінки `studio.youtube.com`, а також налаштування користувача.
- **Обробка:** аналіз аудіохвилі та розстановка рекламних міток виконуються локально у браузері; аудіофайли нікуди не завантажуються. Службові звіти про помилки/якість формуються у фоновому скрипті.
- **Збереження:** налаштування, розклад ефірів, калібрування (`mraQualityCalib`), кеш дедуплікації та локальна історія звітів зберігаються в `chrome.storage.local` та `localStorage` до видалення користувачем або видалення розширення.
- **Передача третім сторонам:** службові звіти (email оператора, назва та ID/URL відео, тривалість і діагностика міток) передаються через HTTPS на приватний проксі Google Apps Script (`script.google.com`) у службовий Telegram-чат. Дані не продаються і не передаються рекламним мережам чи стороннім брокерам.
