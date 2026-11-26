<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  SPECTATE3D_FULLSCREEN_QUERY_MESSAGE,
  SPECTATE3D_FULLSCREEN_STATE_MESSAGE,
  SPECTATE3D_RETURN_MESSAGE,
  SPECTATE3D_TOGGLE_FULLSCREEN_MESSAGE,
} from '../game/spectate3dSession';

const props = defineProps<{ src: string; fullscreen: boolean }>();
const emit = defineEmits<{ leave: []; toggleFullscreen: [] }>();
const frame = ref<HTMLIFrameElement | null>(null);

function pushFullscreenState(active: boolean): void {
  frame.value?.contentWindow?.postMessage(
    { type: SPECTATE3D_FULLSCREEN_STATE_MESSAGE, active },
    window.location.origin,
  );
}

function onMessage(event: MessageEvent): void {
  if (event.origin !== window.location.origin) return;
  if (event.source !== frame.value?.contentWindow) return;
  if (event.data === SPECTATE3D_RETURN_MESSAGE) {
    emit('leave');
    return;
  }
  if (event.data === SPECTATE3D_TOGGLE_FULLSCREEN_MESSAGE) {
    emit('toggleFullscreen');
    return;
  }
  if (event.data === SPECTATE3D_FULLSCREEN_QUERY_MESSAGE) {
    pushFullscreenState(props.fullscreen);
  }
}

function onFrameLoad(): void {
  pushFullscreenState(props.fullscreen);
}

watch(() => props.fullscreen, (active) => pushFullscreenState(active));

onMounted(() => window.addEventListener('message', onMessage));
onBeforeUnmount(() => window.removeEventListener('message', onMessage));
</script>

<template>
  <iframe
    ref="frame"
    class="spectate3d-frame"
    :src="src"
    title="Spectateur 3D"
    @load="onFrameLoad"
  ></iframe>
</template>

<style scoped>
.spectate3d-frame {
  position: fixed;
  inset: 0;
  z-index: 80;
  width: 100%;
  height: 100%;
  border: 0;
  background: #10140f;
}
</style>
