import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "farron cat's blog",
  description: "a personal blog",
  themeConfig: {
    siteTitle: "farron cat's blog",
    logo: "farroncat.jpg",
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      {
        text: 'Programming', items: [
          { text: 'C++', link: '/programming/cpp/' },
        ]
      },
      {
        text: 'Game Development', items: [
          { text: 'lua', link: '/game development/lua/' },
          { text: 'love2d', link: '/game development/love2d/' },
          { text: 'godot', link: '/game development/godot/' },
          { text: 'DX', link: '/game development/dx/' },
        ]
      },
      { text: 'About Me', link: '/about' }
    ],

    sidebar: {
      '/programming/':{
        text: 'Programming',
        items: [
          { text: 'C++', link: '/programming/cpp/' },
        ]
      },
      '/game development/':{
        text: 'Game Development',
        items: [
          { text: 'lua', link: '/game development/lua/' },
          { text: 'love2d', link: '/game development/love2d/' },
          { text: 'godot', link: '/game development/godot/' },
          { text: 'DX', link: '/game development/dx/' },
        ]
      },
    },
    
    socialLinks: [
      { icon: 'github', link: 'https://github.com/farron-cat' }
    ],

    footer: {
      message: 'collect all interests',
      copyright: 'Copyright © 2023-present @farron cat'
    }
  }
})
