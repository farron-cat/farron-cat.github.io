// https://vitepress.dev/guide/custom-theme
import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import AnimatedBackground from './components/AnimatedBackground.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      // https://vitepress.dev/guide/extending-default-theme#layout-slots
      // 极光光斑背景，铺在所有页面内容之下
      'layout-top': () => h(AnimatedBackground)
    })
  },
  enhanceApp({ app, router, siteData }) {
    // ...
  }
} satisfies Theme