<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { SPECTATE3D_RETURN_MESSAGE } from '../game/spectate3dSession';

defineProps<{ src: string }>();
const emit = defineEmits<{ leave: [] }>();
const frame = ref<HTMLIFrameElement | null>(null);

function onMessage(event: MessageEvent): void {
  if (event.origin !== window.location.origin) return;
  if (event.source !== frame.value?.contentWindow) return;
  if (event.data !== SPECTATE3D_RETURN_MESSAGE) return;
  emit('leave');
}

onMounted(() => window.addEventListener('message', onMessage));
onBeforeUnmount(() => window.removeEventListener('message', onMessage));
</script>

<template>
  <iframe ref="frame" class="spectate3d-frame" :src="src" title="Spectateur 3D" allow="fullscreen"></iframe>
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
