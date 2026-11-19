# @fumbbl40k/ffb-pitch3d

Rendu Three.js du terrain pour la vue spectateur 3D. Pas de Vue, pas de Tauri, pas de Pixi :
l'appelant fournit un `GameJson` et un élément hôte.

```ts
const pitch = new Pitch3D();
await pitch.init(host);
pitch.present(game);
pitch.destroy();
```

Le code porté depuis l'interface SpikeBowl (GPL-2.0-or-later), réécrit ici en TypeScript, est publié sous MIT
avec l'accord de son auteur. Les décors (ciel, herbe, sol, maison) viennent de SpikeBowl et suivent la même décision.
L'arbre fluffy (`fluffy-tree.glb` + shader canopy) est adapté de [leoawen/fluffytree-threejs](https://github.com/leoawen/fluffytree-threejs) (MIT).
