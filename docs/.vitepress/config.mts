import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'zh-CN',

  title: "farron cat's Blog",

  description: "一个记录编程、数据结构与游戏开发笔记的个人博客",

  head: [
    ['link', { rel: 'icon', href: '/farroncat.jpg' }],
    ['meta', { name: 'theme-color', content: '#bd34fe' }]
  ],

  lastUpdated: true,

  markdown: {
    lineNumbers: true
  },

  themeConfig: {

    siteTitle: "farron cat's Blog",

    logo: "farroncat.jpg",
    // https://vitepress.dev/reference/default-theme-config

    nav: [
      { text: '首页', link: '/' },

      {
        text: '编程',
        items: [
          { text: 'C++', link: '/programming/cpp/' },
          { text: 'Lua', link: '/programming/lua/' },
          { text: '数据结构', link: '/programming/data_structure/' },
        ]
      },

      {
        text: '游戏开发',
        items: [
          {
            text: '引擎与架构',
            items: [
              { text: '游戏引擎概念', link: '/game_development/engine-concept/' },
              { text: 'Platformer 引擎', link: '/game_development/platformer/' },
            ]
          },
          {
            text: '引擎',
            items: [
              { text: 'Godot', link: '/game_development/godot/' },
              { text: 'Unity', link: '/game_development/unity/' },
              { text: 'Love2D', link: '/game_development/love2d/' },
            ]
          },
          {
            text: '图形 API 与库',
            items: [
              { text: 'OpenGL', link: '/game_development/opengl/' },
              { text: 'DirectX', link: '/game_development/dx/' },
              { text: 'SDL', link: '/game_development/sdl/' },
              { text: '其他库', link: '/game_development/other library/' },
            ]
          },
        ]
      },

      {
        text: '杂记',
        items: [
          { text: 'Steam 下载断断续续', link: '/other/steam_download' },
        ]
      },

      { text: '关于我', link: '/about' }
    ],

    sidebar: {

      '/programming/': [
        {
          text: '编程',
          items: [
            { text: '概览', link: '/programming/' },
            { text: 'C++', link: '/programming/cpp/' },
            { text: 'Lua', link: '/programming/lua/' },
            { text: '数据结构', link: '/programming/data_structure/' },
          ]
        }
      ],

      '/programming/cpp/': [
        {
          text: 'C++',
          items: [
            { text: '概览', link: '/programming/cpp/' },
            { text: '要点总结', link: '/programming/cpp/essence' },
            { text: 'STL', link: '/programming/cpp/stl' },
          ]
        }
      ],

      '/programming/data_structure/': [
        {
          text: '数据结构',
          items: [
            { text: '概览', link: '/programming/data_structure/' },
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
          text: '引擎与架构',
          items: [
            { text: '概览', link: '/game_development/' },
            { text: '游戏引擎概念', link: '/game_development/engine-concept/' },
            { text: 'Platformer 引擎', link: '/game_development/platformer/' },
          ]
        },

        {
          text: '游戏引擎',
          items: [
            { text: 'Godot', link: '/game_development/godot/' },
            { text: 'Unity', link: '/game_development/unity/' },
            { text: 'Love2D', link: '/game_development/love2d/' },
          ]
        },

        {
          text: '图形 API 与库',
          items: [
            { text: 'OpenGL', link: '/game_development/opengl/' },
            { text: 'DirectX', link: '/game_development/dx/' },
            { text: 'SDL', link: '/game_development/sdl/' },
            { text: '其他库', link: '/game_development/other library/' },
          ]
        }
      ],

      '/game_development/engine-concept/': [
        {
          text: '游戏引擎概念',
          items: [
            { text: '概览', link: '/game_development/engine-concept/' },
            { text: '引擎架构', link: '/game_development/engine-concept/architecture' },
            { text: '平台游戏设计', link: '/game_development/engine-concept/platformer-design' },
          ]
        }
      ],

      '/game_development/opengl/': [
        {
          text: 'OpenGL',
          items: [
            { text: '概览', link: '/game_development/opengl/' },
            { text: 'GLFW 与 GLEW', link: '/game_development/opengl/glfw&glew' },
            { text: 'VBO / VAO / EBO', link: '/game_development/opengl/vbo&vao&ebo' },
            { text: '绘制三角形', link: '/game_development/opengl/drawtriangle' },
            { text: 'GLSL 着色器语言', link: '/game_development/opengl/glsl' },
          ]
        }
      ],

      '/game_development/sdl/': [
        {
          text: 'SDL',
          items: [
            { text: '概览', link: '/game_development/sdl/' },
            { text: 'SDL2', link: '/game_development/sdl/sdl2' },
            { text: 'SDL3', link: '/game_development/sdl/sdl3' },
          ]
        }
      ],

      '/game_development/other library/': [
        {
          text: '其他库',
          items: [
            { text: '概览', link: '/game_development/other library/' },
            { text: 'GLM', link: '/game_development/other library/glm' },
            { text: 'nlohmann json', link: '/game_development/other library/nlmajson' },
            { text: 'spdlog', link: '/game_development/other library/spdlog' },
          ]
        }
      ],

      '/game_development/godot/': [
        {
          text: 'Godot',
          items: [
            { text: '概览', link: '/game_development/godot/' },
            { text: '基本概念', link: '/game_development/godot/fristgame' },
          ]
        }
      ],

      '/game_development/platformer/': [
        {
          text: 'Platformer 引擎',
          items: [
            { text: '概览', link: '/game_development/platformer/' },
            { text: '引擎核心层', link: '/game_development/platformer/core' },
          ]
        }
      ],
    },

    outline: {
      level: [2, 3],
      label: '本页目录'
    },

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/farron-cat/farron-cat.github.io/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页'
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short'
      }
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/farron-cat' }
    ],

    footer: {
      message: 'collect all Interests',
      copyright: 'Copyright © 2023-2026 @farron cat'
    },

    notFound: {
      title: '页面走丢了',
      quote: '这个页面还不存在，也许笔记还没写到这里。',
      linkText: '回到首页'
    }
  }
})