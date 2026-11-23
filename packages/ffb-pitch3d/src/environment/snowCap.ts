/**
 * Neige posée sur les volumes : le dessus blanchit, les flancs restent plus sombres.
 * Sur les cartes de feuilles, le givre suit la lumière déjà calculée :
 * les creux restent plus sombres, le dessin de la texture reste lisible.
 */
import type { Material, WebGLRenderer } from 'three';

const SNOW_COLOR = 'vec3(0.93, 0.97, 1.0)';

/** Partagée par tous les matériaux : 0 nu, 1 couvert. */
export const snowCapAmount = { value: 0 };

type SnowStyle = 'foliage' | 'pine' | 'cap';

type SnowShader = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};

/** Rochers, troncs : la neige tient sur les faces tournées vers le ciel. */
export function enableSnowCap(material: Material): void {
  enable(material, 'cap');
}

/**
 * Feuilles et buissons : givre sur les faces tournées vers le ciel.
 * Les pins ont de grandes cartes horizontales : la neige reste sur les pointes, le coeur de la branche garde sa couleur.
 */
export function enableSnowFoliage(material: Material): void {
  const pine = material.name.startsWith('Leaves_Pine');
  enable(material, pine ? 'pine' : 'foliage');
}

export function setSnowCap(amount: number): void {
  snowCapAmount.value = Math.min(1, Math.max(0, amount));
}

/**
 * Houppier fluffy : sa normale est forcée vers le haut, donc on suit la hauteur dans l'arbre.
 * À appeler à la fin de son `onBeforeCompile`, une fois `vWorldPosition` et `uTreeCenter` en place.
 */
export function attachCanopySnow(shader: SnowShader): void {
  shader.uniforms.uSnow = snowCapAmount;
  if (!shader.fragmentShader.includes('uniform float uSnow')) {
    shader.fragmentShader = `uniform float uSnow;\n${shader.fragmentShader}`;
  }
  shader.fragmentShader = shader.fragmentShader.replace(
    'vec3 outgoingLight = diffuseColor.rgb;',
    `
    vec3 outgoingLight = diffuseColor.rgb;
    float snowCrest = smoothstep(uTreeCenter.y - 0.6, uTreeCenter.y + 2.4, vWorldPosition.y);
    float snowMask = uSnow * mix(0.12, 0.7, snowCrest);
    outgoingLight = mix(outgoingLight, ${SNOW_COLOR}, clamp(snowMask, 0.0, 1.0));
    `,
  );
}

function enable(material: Material, style: SnowStyle): void {
  if (material.userData.snow === style) return;
  material.userData.snow = style;
  const previous = material.onBeforeCompile?.bind(material);
  const previousKey = material.customProgramCacheKey?.bind(material);
  const version = style === 'pine' ? 'v9' : 'v6';
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|snow-${style}-${version}`;
  material.onBeforeCompile = (shader, renderer: WebGLRenderer) => {
    previous?.(shader, renderer);
    attachSurfaceSnow(shader as unknown as SnowShader, style);
  };
  material.needsUpdate = true;
}

function attachSurfaceSnow(shader: SnowShader, style: SnowStyle): void {
  if (shader.fragmentShader.includes('uSnow')) return;
  const lights = '#include <lights_physical_fragment>';
  const opaque = '#include <opaque_fragment>';
  if (style === 'foliage' || style === 'pine') {
    if (!shader.fragmentShader.includes(lights) || !shader.fragmentShader.includes(opaque)) return;
    shader.uniforms.uSnow = snowCapAmount;
    const snowUp = style === 'pine'
      ? 'smoothstep(0.55, 0.9, inverseTransformDirection(normal, viewMatrix).y)'
      : 'smoothstep(0.02, 0.78, inverseTransformDirection(normal, viewMatrix).y)';
    const pineTip = style === 'pine'
      ? `
        float snowTip = 1.0;
        #ifdef USE_MAP
          snowTip = smoothstep(0.62, 0.96, 1.0 - clamp(vMapUv.y, 0.0, 1.0));
        #endif`
      : '';
    const snowMask = style === 'pine' ? 'uSnow * snowUp * snowTip' : 'uSnow * snowUp';
    const snowLit = style === 'pine'
      ? `mix(outgoingLight, ${SNOW_COLOR} * (0.5 + 0.75 * clamp(snowLuma, 0.0, 1.0)), 0.72)`
      : `mix(outgoingLight, ${SNOW_COLOR}, 0.62) * mix(0.4, 1.15, smoothstep(0.0, 0.42, snowLuma)) * mix(0.78, 1.18, snowDetail)`;
    shader.fragmentShader = `uniform float uSnow;\n${shader.fragmentShader}`
      .replace(lights, `
        float snowUp = ${snowUp};
        float snowDetail = clamp(dot(diffuseColor.rgb, vec3(0.2, 0.7, 0.1)), 0.0, 1.0);
        ${pineTip}
        float snowMask = ${snowMask};
        ${lights}
      `)
      .replace(opaque, `
        {
          float snowLuma = dot(outgoingLight, vec3(0.3, 0.59, 0.11));
          vec3 snowLit = ${snowLit};
          outgoingLight = mix(outgoingLight, snowLit, clamp(snowMask, 0.0, 1.0));
        }
        ${opaque}
      `);
    return;
  }
  if (!shader.fragmentShader.includes(opaque)) return;
  shader.uniforms.uSnow = snowCapAmount;
  shader.fragmentShader = `uniform float uSnow;\n${shader.fragmentShader.replace(opaque, `
    {
      float snowMask = uSnow * smoothstep(0.38, 0.9, inverseTransformDirection(normal, viewMatrix).y);
      outgoingLight = mix(outgoingLight, ${SNOW_COLOR}, clamp(snowMask, 0.0, 1.0));
    }
    ${opaque}
  `)}`;
}
