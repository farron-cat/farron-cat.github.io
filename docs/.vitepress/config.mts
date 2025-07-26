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
        text: 'Programming languages', items: [
          { text: 'C++', link: '/programming/cpp/' },
          { text: 'lua', link: '/programming/lua/' },
          { text: 'data structure', link: '/programming/data_structure/' },
        ]
      },

      {
        text: 'Game Development', items: [

          {
            text: 'Game Engine', items: [
              { text: 'unity', link: '/game_development/unity/' },
              { text: 'love2d', link: '/game_development/love2d/' },
              { text: 'godot', link: '/game_development/godot/' },
            ]
          },

          {
            text: 'Graphic Library', items: [
              { text: 'SDL', link: '/game_development/sdl/' },
            ]
          },

          {
            text: 'Graphic API', items: [
              { text: 'OpenGL', link: '/game_development/opengl/' },
              { text: 'DirectX', link: '/game_development/dx/' },
            ]
          },

        ]
      },

      {
        text: 'Interests', items: [
          { text: 'incomming...', link: ' '},
        ]
      },

      { text: 'About Me', link: '/about' }
    ],

    sidebar: {

      '/programming/': [
        {
          text: 'Programming',
          items: [
            { text: 'C++', link: '/programming/cpp/' },
            { text: 'lua', link: '/programming/lua/' },
            { text: 'data structure', link: '/programming/data_structure/' },
          ]
        }
      ],

      '/programming/data_structure/': [
        {
          text: 'data structure',
          items: [
            { text: '数据结构', link: '/programming/data_structure/' },
            { text: '第一章 绪论', link: '/programming/data_structure/chap1' },
            { text: '第二章 线性表', link: '/programming/data_structure/chap2' },
            { text: '第三章 栈和队列', link: '/programming/data_structure/chap3' },
            { text: '第四章 串', link: '/programming/data_structure/chap4' },
            { text: '第五章 树与二叉树', link: '/programming/data_structure/chap5' },
            { text: '第六章 图', link: '/programming/data_structure/chap6' },
            { text: '第七章 查找', link: '/programming/data_structure/chap7' },
            { text: '第八章 排序', link: '/programming/data_structure/chap8' },
            { text: '扩展一 广义表', link: '/programming/data_structure/add1' },
            { text: '扩展二 并查集', link: '/programming/data_structure/add2' },
          ]
        }
      ],

      '/game_development/': [
        {
          text: 'Game Engine',
          items: [
            { text: 'unity', link: '/game_development/unity/' },
            { text: 'love2d', link: '/game_development/love2d/' },
            { text: 'godot', link: '/game_development/godot/' },
          ]
        },

        {
          text: 'Graphics Library',
          items: [
            { text: 'SDL', link: '/game_development/sdl/' },
          ]
        },

        {
          text: 'Graphics API',

          items: [
            { text: 'OpenGL', link: '/game_development/opengl/' },
            { text: 'DirectX', link: '/game_development/dx/' },
          ]
        },

        {
          text: 'Other Library',
          items: [
            { text: 'other library', link: '/game_development/other library/' },
          ]
        }

      ],

    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/farron-cat' }
    ],

    footer: {
      message: 'collect all interests',
      copyright: 'Copyright © 2023-2025 @farron cat'
    }
  }
})
