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
          { text: 'data structure', link: '/programming/data structure/' },
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
          { text: 'data structure', link: '/programming/data structure/' },
        ]
      },
      '/programming/data structure/':{
        text: 'data structure',
        items: [
          { text: '数据结构', link: '/programming/data structure/' },
          { text: '第一章 绪论', link: '/programming/data structure/chap1' },
          { text: '第二章 线性表', link: '/programming/data structure/chap2' },
          { text: '第三章 栈和队列', link: '/programming/data structure/chap3' },
          { text: '第四章 串', link: '/programming/data structure/chap4' },
          { text: '第五章 树与二叉树', link: '/programming/data structure/chap5' },
          { text: '第六章 图', link: '/programming/data structure/chap6' },
          { text: '第七章 查找', link: '/programming/data structure/chap7' },
          { text: '第八章 排序', link: '/programming/data structure/chap8' },
          { text: '扩展一 广义表', link: '/programming/data structure/add1' },
          { text: '扩展二 并查集', link: '/programming/data structure/add2' },
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
