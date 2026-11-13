# Démo compilée Super FUMBBL

Cette procédure remplace le serveur de développement Vite par la build du client, sur le même serveur et derrière le même HAProxy. L’adresse publique ne change pas. Le navigateur charge quelques fichiers au lieu de tout l’arbre des modules.

La mise en place du serveur, du compte `www-data` et d’HAProxy est dans `SuperFumbblDevDemo.md`. Ce fichier ne reprend que ce qui change pour servir la build.

## Pourquoi

`dev:vite` envoie le source tel quel. Chaque fichier `.ts`, `.vue`, `.json` et chaque image importée est une requête HTTP. Le navigateur doit avoir reçu le graphe avant que Vue s’affiche. Sur `http://sf.bugeat.com/`, ce graphe représente plus de deux mille requêtes et environ 40 Mo. En HTTP/1.1 le navigateur n’en ouvre qu’une poignée à la fois : le texte « Chargement… » apparaît tout de suite, l’application attend la fin de la file.

`vite build` rassemble le code et les fichiers de langue dans quelques fichiers. Les images restent des fichiers à part (`assetsInlineLimit` vaut `0` dans `apps/tauri/vite.config.ts`) et ne partent que lorsque l’écran qui les utilise les demande. Le premier écran n’attend plus le graphe des modules.

## Ce qui ne change pas

| | |
| --- | --- |
| Adresses | `http://sf.bugeat.com/` et `http://sf.bugeat.com/spectate3d.html` |
| HAProxy | le backend `sf_vite` pointe toujours vers `127.0.0.1:1420` |
| Page | HTTP, pour que le navigateur ouvre `ws://fumbbl.com:22223/command` |
| Édition | `apps/tauri/edition.json` reste `"public"` |

La WebSocket de la partie ne passe toujours pas par HAProxy. `vite preview` n’a pas de rechargement automatique : le `timeout tunnel` du backend ne sert plus pour ce site. Le laisser en place ne gêne pas.

Le client compilé appelle `https://fumbbl.com` directement. Le proxy `/fumbbl-site` de `vite.config.ts` n’existe que pendant `dev:vite`. fumbbl.com répond avec `Access-Control-Allow-Origin: *`, donc ces appels aboutissent depuis `sf.bugeat.com`.

## 1. Autoriser le nom public pour la build

Vite 6.4 refuse le nom public tant que la config ne le cite pas, pour `vite preview` comme pour le serveur de développement. Dans `apps/tauri/vite.config.ts`, à côté de l’objet `server`, ajoute :

```ts
preview: {
  host: '127.0.0.1',
  port: 1420,
  strictPort: true,
  ...(demoHost ? { allowedHosts: [demoHost] } : {}),
},
```

`demoHost` est déjà lu depuis `SUPERFUMBBL_DEMO_HOST`, plus haut dans le même fichier. Sans cette variable, l’aperçu n’écoute que `localhost`, comme en local sur le Mac.

Committe, pousse, puis sur le serveur :

```bash
sudo -u www-data git -C /var/w3/html/sf.bugeat.com pull
```

HAProxy ne change pas.

## 2. Compiler

En `www-data`, depuis le dépôt. Le service peut encore tourner : la compilation écrit dans `apps/tauri/dist`, que le serveur de développement ne sert pas.

```bash
cd /var/w3/html/sf.bugeat.com
corepack pnpm --filter @fumbbl40k/app build:vite
```

`build:vite` lance d’abord `vue-tsc --noEmit`, puis `vite build`. Une erreur de type arrête la commande avant de produire `dist`. Les deux pages déclarées dans `build.rollupOptions.input` sont écrites : `apps/tauri/dist/index.html` et `apps/tauri/dist/spectate3d.html`.

La compilation dure plusieurs minutes. Elle a réussi quand la commande se termine sans erreur et que le journal Vite affiche le résumé des fichiers.

## 3. Servir `dist` à la place du serveur de développement

Remplace la ligne `ExecStart` de `/etc/systemd/system/superfumbbl-demo.service` :

```ini
ExecStart=/usr/bin/corepack pnpm --filter @fumbbl40k/app exec vite preview --host 127.0.0.1 --port 1420 --strictPort
```

Garde `User=www-data`, `WorkingDirectory=/var/w3/html/sf.bugeat.com` et `Environment=SUPERFUMBBL_DEMO_HOST=sf.bugeat.com`. `SUPERFUMBBL_DEMO_PORT` ne sert qu’au rechargement du serveur de développement. Tu peux l’enlever.

`vite preview` lit `apps/tauri/dist`. Il n’écoute que sur `127.0.0.1:1420`. HAProxy reste la seule porte d’entrée.

```bash
sudo systemctl daemon-reload
sudo systemctl restart superfumbbl-demo
journalctl -u superfumbbl-demo -f
```

Le service est prêt quand le journal affiche l’adresse locale sur le port 1420. Vérifications, depuis le serveur :

```bash
curl -I http://127.0.0.1:1420/
curl -I http://127.0.0.1:1420/spectate3d.html
curl -I http://sf.bugeat.com/
```

Les trois répondent 200. Dans le navigateur, un rechargement forcé de `http://sf.bugeat.com/` ne doit plus enchaîner des centaines de requêtes avant le premier écran. L’onglet Réseau montre une poignée de fichiers `.js` et `.css`, puis les images de l’écran affiché.

## Mettre à jour

Sur le Mac, commit puis push. Sur le serveur, compile avant de redémarrer. Un redémarrage sans compilation réussie ressert l’ancien `dist`, ou ne démarre pas s’il n’existe pas.

```bash
sudo -u www-data git -C /var/w3/html/sf.bugeat.com pull
sudo -u www-data bash -lc 'cd /var/w3/html/sf.bugeat.com && corepack pnpm --filter @fumbbl40k/app build:vite'
sudo systemctl restart superfumbbl-demo
```

`bash -lc` donne à `www-data` le même `PATH` que l’installation, pour que `corepack` trouve pnpm.

| Changement | Geste |
| --- | --- |
| Code, pages, langues, images | `git pull`, `build:vite`, redémarrage du service |
| `pnpm-lock.yaml` ou un `package.json` | `corepack pnpm install` à la racine, puis la ligne du dessus |
| `vite.config.ts` | la même ligne. Le redémarrage seul ne relit pas une config déjà compilée dans `dist` |
| HAProxy | `sudo haproxy -c -f /etc/haproxy/haproxy.cfg && sudo systemctl reload haproxy` |

Il n’y a plus de rechargement automatique. L’autre développeur ne voit le commit qu’après la compilation et un rafraîchissement de la page.

## Revenir au serveur de développement

Remets l’ancienne ligne `ExecStart` :

```ini
ExecStart=/usr/bin/corepack pnpm --filter @fumbbl40k/app dev:vite
```

Remets `Environment=SUPERFUMBBL_DEMO_PORT=80` si tu l’as enlevée, puis `sudo systemctl daemon-reload` et `sudo systemctl restart superfumbbl-demo`. Le détail est dans `SuperFumbblDevDemo.md`.

## En cas de blocage

- **403 « This host is not allowed ».** Le bloc `preview` est absent, `SUPERFUMBBL_DEMO_HOST` ne vaut pas `sf.bugeat.com`, ou le service n’a pas été redémarré après le `git pull` qui apporte ce bloc.
- **Le service quitte tout de suite.** `dist` n’existe pas : la compilation n’a pas abouti. Ou le port 1420 est déjà pris (`ss -ltnp | grep 1420`).
- **`build:vite` s’arrête sur une erreur TypeScript.** Rien n’est écrit dans `dist`. Corrige l’erreur sur le Mac, pousse, et relance la compilation. Ne redémarre pas le service tant que la commande n’est pas sortie sans erreur.
- **La page 3D est introuvable.** L’adresse reste `http://sf.bugeat.com/spectate3d.html`. Elle est dans `dist` seulement si `build.rollupOptions.input` cite encore `spectate3d.html`.
- **Les appels à fumbbl.com échouent.** Ce n’est plus le proxy `/fumbbl-site`. Le navigateur parle à `https://fumbbl.com`. Un blocage vient du navigateur ou de fumbbl.com, pas d’HAProxy.
- **La partie en direct ne se connecte pas.** La page doit rester en HTTP. Une page HTTPS refuse `ws://fumbbl.com:22223/command`.
