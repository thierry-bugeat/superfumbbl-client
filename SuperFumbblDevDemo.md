# Démo navigateur Super FUMBBL

Cette procédure publie le client dans un navigateur, via Nginx, pour qu’un autre développeur voie les changements au fil des commits. Le serveur de développement Vite tourne sur la machine ; Nginx est la seule porte d’entrée.

Les installeurs Linux, Windows et macOS sont une étape à part. Ils se compilent chacun sur leur système avec Tauri.

## Ce que l’autre développeur ouvre

| Page | Adresse |
| --- | --- |
| Client | `http://sf.bugeat.com/` |
| Spectateur 3D | `http://sf.bugeat.com/spectate3d.html` |

`apps/tauri/edition.json` vaut `"public"`. La démo suit le parcours FUMBBL officiel. L’adresse `http://sf.bugeat.com/?forkServer` (sans `=`) affiche en plus les écrans du fork, vers l’hôte déjà compilé dans le client.

La page reste en HTTP. Le client ouvre la partie en `ws://` (`ws://fumbbl.com:22223/command`). Une page HTTPS refuserait cette adresse.

## Prérequis sur le serveur

- Linux avec Nginx
- Git
- Node.js 22, paquet Ubuntu `nodejs`
- pnpm 10.34.4, lancé par le paquet `node-corepack` à partir du champ `packageManager` du dépôt
- Le dépôt `superfumbbl-client` accessible en lecture depuis le serveur
- Le port 80 ouvert vers l’extérieur, le port 1420 limité à la machine
- Un enregistrement DNS `sf.bugeat.com` qui pointe vers l’adresse IP publique du serveur

Sur Ubuntu 26.04, le paquet `nodejs` des dépôts est Node.js 22. Il entraîne `node-corepack`. Corepack lit `package.json` et télécharge pnpm 10.34.4 au premier lancement dans le dépôt. Les commandes s’écrivent `corepack pnpm`.

```bash
sudo apt update
sudo apt install -y nodejs nginx
node -v
corepack --version
```

## 1. Installer le code

Le compte `www-data` possède le dépôt et lance Vite. Son dossier personnel est `/var/w3/html`. Corepack y range pnpm, dans `/var/w3/html/.cache`, à côté du site et en dehors du dépôt Git.

```bash
sudo mkdir -p /var/w3/html/sf.bugeat.com
sudo chown www-data:www-data /var/w3/html/sf.bugeat.com
sudo -u www-data git clone <url-du-depot> /var/w3/html/sf.bugeat.com
sudo -u www-data bash -c 'cd /var/w3/html/sf.bugeat.com && corepack pnpm install'
```

`corepack pnpm install` se lance à la racine du dépôt. Le client dépend des paquets `packages/ffb-pitch`, `packages/ffb-pitch3d` et `packages/ffb-protocol`. Le dépôt doit être lisible par `www-data` (adresse HTTPS publique, ou une clé de déploiement de ce compte).

Laisse vides `VITE_FUMBBL_APP_CLIENT_ID` et `VITE_FUMBBL_APP_CLIENT_SECRET`. Ces valeurs sont lues par Vite et se retrouvent dans le JavaScript envoyé au navigateur. Les fichiers `.env` et `.env.local` sont ignorés par Git.

## 2. Autoriser le nom public dans Vite

Vite 6.4 n’accepte par défaut que `localhost`. Derrière Nginx, il refuse le nom public tant que la config ne le cite pas. Le rechargement automatique doit aussi viser le port 80, celui de la page, et non le port interne 1420.

Dans `apps/tauri/vite.config.ts`, garde le proxy `/fumbbl-site` et complète l’objet `server` :

```ts
const demoHost = (process.env.SUPERFUMBBL_DEMO_HOST ?? '').trim();
const demoPort = Number(process.env.SUPERFUMBBL_DEMO_PORT || '80');

// dans defineConfig({ server: { ... } })
server: {
  port: 1420,
  strictPort: true,
  ...(demoHost
    ? {
        allowedHosts: [demoHost],
        hmr: { protocol: 'ws', host: demoHost, clientPort: demoPort },
      }
    : {}),
  proxy: {
    '/fumbbl-site': {
      target: 'https://fumbbl.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/fumbbl-site/, ''),
    },
  },
},
```

Sans `SUPERFUMBBL_DEMO_HOST`, Vite se comporte comme en local sur le Mac : port 1420, hôte `localhost`. Committe cette modification et pousse-la, puis `git pull` sur le serveur. Le nom du serveur reste dans le service systemd, pas dans le dépôt.

Vite continue d’écouter uniquement sur `127.0.0.1`. Nginx est le seul à lui parler.

## 3. Nginx

Crée `/etc/nginx/sites-available/sf.bugeat.com.conf` :

```nginx
server {
    listen 80;
    server_name sf.bugeat.com;

    location / {
        proxy_pass http://127.0.0.1:1420;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

`server_name` et `SUPERFUMBBL_DEMO_HOST` valent tous les deux `sf.bugeat.com`.

```bash
sudo ln -s /etc/nginx/sites-available/sf.bugeat.com.conf /etc/nginx/sites-enabled/sf.bugeat.com.conf
sudo nginx -t
sudo systemctl reload nginx
```

Le code est dans `/var/w3/html/sf.bugeat.com/`. Nginx transmet les requêtes à Vite et ne prend pas ce dossier comme racine de fichiers statiques.

Avec un pare-feu ufw :

```bash
sudo ufw allow 80/tcp
sudo ufw deny 1420/tcp
```

## 4. Laisser Vite tourner

Crée `/etc/systemd/system/superfumbbl-demo.service` :

```ini
[Unit]
Description=Super FUMBBL demo Vite
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/w3/html/sf.bugeat.com
Environment=SUPERFUMBBL_DEMO_HOST=sf.bugeat.com
Environment=SUPERFUMBBL_DEMO_PORT=80
ExecStart=/usr/bin/corepack pnpm --filter @fumbbl40k/app dev:vite
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`ExecStart` utilise le chemin réel de Corepack, celui qu’affiche `command -v corepack`. Systemd reprend le dossier personnel de `www-data`, `/var/w3/html`, donc le service n’a pas à redéfinir `HOME`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now superfumbbl-demo
journalctl -u superfumbbl-demo -f
```

La première compilation est longue. Le service est prêt quand le journal affiche l’adresse locale sur le port 1420.

Vérifications, depuis le serveur :

```bash
curl -I http://127.0.0.1:1420/
curl -I http://sf.bugeat.com/
```

Les deux répondent 200. Dans le navigateur : `http://sf.bugeat.com/` et `http://sf.bugeat.com/spectate3d.html`.

## Mettre à jour

Sur le Mac, commit puis push. Sur le serveur :

```bash
sudo -u www-data git -C /var/w3/html/sf.bugeat.com pull
```

Vite recharge les fichiers `.vue`, `.ts`, `.css` et `spectate3d.html` tout seul. L’autre développeur rafraîchit la page s’il l’avait déjà ouverte.

Trois cas demandent un geste de plus.

| Changement | Commande |
| --- | --- |
| `pnpm-lock.yaml` ou un `package.json` | la commande `corepack pnpm install` de l’installation, puis `sudo systemctl restart superfumbbl-demo` |
| `vite.config.ts`, `.env`, `.env.local` | `sudo systemctl restart superfumbbl-demo` |
| La config Nginx | `sudo nginx -t && sudo systemctl reload nginx` |

Le redémarrage coupe la démo le temps que Vite recompile. `journalctl -u superfumbbl-demo -f` montre quand le port 1420 répond de nouveau.

## En cas de blocage

- **403 « This host is not allowed ».** `SUPERFUMBBL_DEMO_HOST` ne correspond pas au nom tapé dans le navigateur, ou le service n’a pas été redémarré après le changement de `vite.config.ts`.
- **La page se charge, puis plus rien ne se met à jour.** Le navigateur tente le rechargement sur le port 1420. `SUPERFUMBBL_DEMO_PORT` doit être le port de Nginx, en général 80, et le bloc `location /` doit transmettre les en-têtes `Upgrade` et `Connection`.
- **Le service quitte tout de suite.** Le port 1420 est déjà pris (`strictPort`). `ss -ltnp | grep 1420` montre l’ancien processus.
- **Les appels à fumbbl.com échouent.** Le proxy `/fumbbl-site` de `vite.config.ts` doit toujours être là. Nginx le transmet comme le reste des URLs.
- **La page 3D est introuvable.** L’adresse est `http://sf.bugeat.com/spectate3d.html`. Le service `dev:vite` sert ce fichier directement. Un `vite build` l’écrit aussi dans `dist`, parce que `apps/tauri/vite.config.ts` le déclare dans `build.rollupOptions.input`.
