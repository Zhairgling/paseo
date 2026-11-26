# Kit Graphique Atelier — Paseo

Identité visuelle unifiée dérivée directement du site de conception vélo cargo & minimoto (`bikeplan/dossier` et `minimoto/dossier` : _structure chocolat, peaux olive, touches cognac, liseré ambre_).

## 1. Palette de couleurs

### Mode Sombre (par défaut — `atelier`)

| Rôle                      | Variable dossier | Token Paseo            | Valeur    | Usage                                       |
| ------------------------- | ---------------- | ---------------------- | --------- | ------------------------------------------- |
| Fond principal            | `--fond`         | `surface0`             | `#15100B` | Toile de fond globale                       |
| Surface carte / panneau   | `--surface`      | `surface1`             | `#1D1610` | Cartes, barres, panneaux                    |
| Surface contrôles / puces | `--e-idee-f`     | `surface2`             | `#2B241D` | Badges, survols, chips                      |
| Encre principale          | `--encre`        | `foreground`           | `#EFE8DC` | Titres et corps de texte                    |
| Encre secondaire          | `--encre-2`      | `foregroundMuted`      | `#CDBFAD` | Sous-titres, descriptions                   |
| Texte discret             | `--discret`      | `foregroundExtraMuted` | `#9B8D7B` | Métadonnées, horodatages                    |
| Filet discret             | `--trait`        | `border`               | `#33291F` | Séparateurs fins                            |
| Filet soutenu             | `--trait-fort`   | `borderAccent`         | `#4A3D30` | Bordures de cartes / puces                  |
| Liseré / Accent actif     | `--ambre`        | `accent`               | `#F0A050` | Boutons primaires, pilules actives, liserés |
| Texte sur accent          | `on_accent`      | `accentForeground`     | `#15100B` | Contraste strict sur `#F0A050`              |
| Succès / En cours         | `ok`             | `statusSuccess`        | `#5BE0A4` | Agents `running`, GPU `PRÊT`                |
| Attention / En conception | `--e-conc-t`     | `statusWarning`        | `#F3C983` | Agents `idle`, avertissements               |
| Alerte / Permission       | `danger`         | `statusDanger`         | `#E0654A` | Permissions en attente, erreurs             |

### Mode AMOLED (`atelierAmoled`)

- `surface0: #000000`, `surfaceSidebar: #000000`, `surface1: #15100B`, mêmes accents et contrastes que `atelier`.

### Mode Clair (`atelierLight`)

- `--fond: #F4F1EA` (`surface0`), `--surface: #FBF9F4` (`surface1`), `--encre: #231A12` (`foreground`), `--encre-2: #54483C` (`foregroundMuted`), `--discret: #85786A`, `--trait: #DCD4C6`, `--trait-fort: #C4B9A7`, `--cognac: #8A4A26` (`accent`), `--ambre: #D27A24` (`accentBright`), `accentForeground: #FBF9F4`.

### Badges d'état (style pilule dossier)

Inspirés de `.etat` (`border-radius: 999px`, pastille ronde 6–8 px + `JetBrains Mono` 600) :

- **En cours / Prêt** : fond `#5BE0A429`, bordure & texte `#5BE0A4`.
- **Permission / Action requise** : fond `#E0654A29`, bordure & texte `#E0654A`.
- **Idle / En conception** : fond `#3A2B12`, texte `#F3C983`.
- **Fait / Olive** : fond `#8B8160`, texte `#15100B` (clair : `#6E6446` / `#FBF7EE`).
- **Neutre / Repo** : fond `#2B241D`, bordure `#4A3D30`, texte `#F7C48A`.

## 2. Typographie auto-hébergée (100 % hors-ligne)

Polices copiées depuis `bikeplan/dossier/static/fonts/` vers `packages/app/public/fonts/` :

- **Interface (`Archivo`)** : fonte variable `100–900`, `font-stretch: 62% 125%`, titres affirmés (`600–800`), surtitres `uppercase` avec `letter-spacing: 0.08em`.
- **Technique (`JetBrains Mono`)** : `400–700`, `tabular-nums` sur tous les badges de repo, horodatages relatifs, IDs courts, compteurs et endpoints GPU.

## 3. Géométrie & Rythme

- **Rayons** : `6px` (`borderRadius.md`) sur les plaques/cartes/blocs de code, `8px` (`borderRadius.lg`) sur les cartes de session, `9999px` (`borderRadius.full`) sur les puces filtres et boutons pilules.
- **Liseré ambre** : bordure gauche `3px` ou filet bas `2px` en `#F0A050` pour ancrer la hiérarchie visuelle sans surcharge.
- **Sidebar Claude Code Desktop** :
  1. Accès rapides (`Nouvel espace de travail`, `Toutes les sessions`, `Équipe & GPU`…)
  2. `Épinglés` (pliable)
  3. `Dernières sessions` (liste plate chronologique pliable, lien `Voir tout` vers `/inbox`)
  4. `Workspaces` (entièrement pliable pour masquer l'arborescence projets/worktrees)

## 4. Appareils cibles & Golden Tests (`npm run test:golden`)

| Profil                    | Appareil                          | Écran physique | DPR | Viewport CSS testé | Mode Paseo                                |
| ------------------------- | --------------------------------- | -------------- | --- | ------------------ | ----------------------------------------- |
| `desktop-1440x900`        | Bureau / Laptop                   | `1440 × 900`   | `1` | `1440 × 900`       | Desktop (sidebar fixe)                    |
| `honor-pad-10-landscape`  | Honor Pad 10 (12.1")              | `2560 × 1600`  | `2` | `1280 × 800`       | Tablette paysage (sidebar fixe)           |
| `honor-pad-10-portrait`   | Honor Pad 10 (12.1")              | `1600 × 2560`  | `2` | `800 × 1280`       | Tablette portrait                         |
| `honor-magic-v6-unfolded` | Honor Magic V6 **déplié** (7.95") | `2352 × 2172`  | `3` | `784 × 724`        | Pliable ouvert (usage principal)          |
| `honor-magic-v6-folded`   | Honor Magic V6 **plié** (6.52")   | `1080 × 2420`  | `3` | `360 × 807`        | Smartphone étroit (tiroir + bouton 1 tap) |

### Commandes Golden Tests

```bash
# Vérifier les non-régressions visuelles par rapport aux références
npm run test:golden

# Mettre à jour les captures de référence (baselines) après une évolution UI volontaire
npm run test:golden:update
```

Les captures de référence sont stockées dans `packages/app/e2e/golden/baselines/` et les diffs en cas d'écart dans `packages/app/e2e/golden/diffs/`.
