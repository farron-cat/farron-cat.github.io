<script setup lang="ts">
/**
 * 极光光斑背景
 * - 纯 CSS 动画，GPU 合成，无 JS 逐帧计算
 * - pointer-events: none，不干扰任何交互
 * - 通过 prefers-reduced-motion 自动降级为静态渐变
 */
</script>

<template>
  <div class="animated-bg" aria-hidden="true">
    <span class="blob blob-1"></span>
    <span class="blob blob-2"></span>
    <span class="blob blob-3"></span>
    <span class="blob blob-4"></span>
    <span class="bg-grain"></span>
  </div>
</template>