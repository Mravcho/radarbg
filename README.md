# RadarBG v2 🚔📷📏⚡

PWA приложение за камери, полиция и зарядни — за телефон и Tesla браузър.

## Нови функции (v2)
- 📏 **Камери за средна скорост** от OpenStreetMap
- 🎥 **Автоматичен ъпдейт** на камерите всяка нощ (GitHub Actions)
- ⚡ **Зарядни станции** от OpenChargeMap (live)
- 🗺️ **Навигация** с OSRM (безплатен routing)
- 💊 **Layer pills** — вкл./изкл. всеки слой с едно докосване

## Стъпка 1 — GitHub репо (ЗАДЪЛЖИТЕЛНО за дневен ъпдейт)

```bash
# Разархивирай zip-а
cd radarbg2

git init
git add .
git commit -m "RadarBG v2 initial"

# Създай репо в github.com (New repository → radarbg)
git remote add origin https://github.com/ТВОЯТ_USERNAME/radarbg.git
git push -u origin main
```

## Стъпка 2 — Ръчен ъпдейт на камерите (веднъж)

В GitHub репото:
1. **Actions** → **Update OSM Cameras Daily**
2. **Run workflow** → Run

Това ще вземе всички камери от OpenStreetMap за България и ще запише `cameras.json`.

След това всяка нощ в 05:00 (Sofia time) се изпълнява автоматично.

## Стъпка 3 — Deploy на Netlify

### Опция A: Netlify + GitHub (препоръчително — автоматичен redeploy)
1. netlify.com → **Add new site** → **Import from Git**
2. Избери твоето GitHub репо
3. Build command: *(оставете празно)*
4. Publish directory: `.`
5. **Deploy site**

При всеки `git push` (включително от GitHub Actions) Netlify автоматично прилага промените.

### Опция B: Netlify Drop (без GitHub)
1. Drag & drop папката на **app.netlify.com/drop**
2. Камерите трябва да се ъпдейтват ръчно

## Tesla употреба

Отвори URL-а в Tesla браузъра → bookmark → Add to home screen.

## Данни

| Слой | Източник | Обновяване |
|------|----------|-----------|
| 🚔 Полиция | Waze livemap (unofficial) | Real-time, на 60с |
| 📷 Фиксирани камери | OpenStreetMap | Всяка нощ |
| 📏 Средна скорост | OpenStreetMap | Всяка нощ |
| ⚡ Зарядни | OpenChargeMap | При всяко зареждане |

## Навигация

Въведи адрес в горното поле → избери от предложенията → **▶ Старт**

Използва Nominatim (OSM) за геокодиране и OSRM за routing — 100% безплатно.

## Файлова структура

```
radarbg2/
├── .github/
│   └── workflows/
│       └── update-cameras.yml   ← GitHub Action (дневен ъпдейт)
├── index.html                   ← главна страница
├── app.js                       ← логика
├── sw.js                        ← Service Worker
├── manifest.json                ← PWA манифест
├── cameras.json                 ← OSM камери (auto-generated)
├── netlify.toml
└── README.md
```

## Персонализация

### По-дълго предупреждение за средна скорост
Настройки → "Средна скорост (начало)" → до 5000м

### Само бързи зарядни (≥50kW)
Настройки → "Само бързи (≥50kW)"

### Промяна на API ключа за OpenChargeMap
В `app.js`, потърси `key=e65cde82` и замени с твой ключ от openchargemap.io (безплатна регистрация).
