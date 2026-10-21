import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'zh-CN',

  title: "farron cat's Blog",

  description: "一个记录编程、数据结构、游戏开发与嵌入式笔记的个人博客",

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
        text: '嵌入式',
        items: [
          { text: 'GD32F407 学习笔记', link: '/embedded/GD32F407_myLibrary_note/README' },
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

      '/embedded/': [
        {
          text: '嵌入式开发',
          items: [
            { text: '概览', link: '/embedded/' },
            { text: 'GD32F407 笔记总览', link: '/embedded/GD32F407_myLibrary_note/README' },
          ]
        },
        {
          text: '基础模块',
          collapsed: false,
          items: [
            { text: '01 工程搭建', link: '/embedded/GD32F407_myLibrary_note/01-工程搭建' },
            { text: '02 GPIO-LED灯组', link: '/embedded/GD32F407_myLibrary_note/02-GPIO-LED灯组' },
            { text: '03 独立按键', link: '/embedded/GD32F407_myLibrary_note/03-独立按键' },
            { text: '04 串口USART', link: '/embedded/GD32F407_myLibrary_note/04-串口USART' },
            { text: '05 充电流水灯状态机', link: '/embedded/GD32F407_myLibrary_note/05-充电流水灯状态机' },
          ]
        },
        {
          text: '中断与定时',
          collapsed: false,
          items: [
            { text: '06 外部中断EXTI', link: '/embedded/GD32F407_myLibrary_note/06-外部中断EXTI' },
            { text: '07 定时器与PWM', link: '/embedded/GD32F407_myLibrary_note/07-定时器与PWM' },
            { text: '08 DMA', link: '/embedded/GD32F407_myLibrary_note/08-DMA' },
          ]
        },
        {
          text: '显示与输入',
          collapsed: true,
          items: [
            { text: '09 数码管', link: '/embedded/GD32F407_myLibrary_note/09-数码管' },
            { text: '10 矩阵键盘', link: '/embedded/GD32F407_myLibrary_note/10-矩阵键盘' },
            { text: '18 OLED显示屏', link: '/embedded/GD32F407_myLibrary_note/18-OLED显示屏' },
            { text: '26 188数码管', link: '/embedded/GD32F407_myLibrary_note/26-188数码管' },
            { text: '28 AD按键ADKEY', link: '/embedded/GD32F407_myLibrary_note/28-AD按键ADKEY' },
            { text: '29 旋转编码器EC12', link: '/embedded/GD32F407_myLibrary_note/29-旋转编码器EC12' },
            { text: '30 WS2812彩灯', link: '/embedded/GD32F407_myLibrary_note/30-WS2812彩灯' },
            { text: '31 触摸按键SC12B', link: '/embedded/GD32F407_myLibrary_note/31-触摸按键SC12B' },
            { text: '32 点阵屏MAX7219', link: '/embedded/GD32F407_myLibrary_note/32-点阵屏MAX7219' },
          ]
        },
        {
          text: '时钟与系统',
          collapsed: true,
          items: [
            { text: '11 RTC实时时钟', link: '/embedded/GD32F407_myLibrary_note/11-RTC实时时钟' },
            { text: '12 看门狗', link: '/embedded/GD32F407_myLibrary_note/12-看门狗' },
            { text: '17 PCF8563外部RTC', link: '/embedded/GD32F407_myLibrary_note/17-PCF8563外部RTC' },
            { text: '25 PMU电源管理', link: '/embedded/GD32F407_myLibrary_note/25-PMU电源管理' },
          ]
        },
        {
          text: '通信协议',
          collapsed: true,
          items: [
            { text: '15 IIC总线', link: '/embedded/GD32F407_myLibrary_note/15-IIC总线' },
            { text: '16 SPI总线', link: '/embedded/GD32F407_myLibrary_note/16-SPI总线' },
            { text: '24 SPI-Flash存储', link: '/embedded/GD32F407_myLibrary_note/24-SPI-Flash存储' },
          ]
        },
        {
          text: '传感器与模拟',
          collapsed: true,
          items: [
            { text: '19 ADC', link: '/embedded/GD32F407_myLibrary_note/19-ADC' },
            { text: '27 NTC热敏电阻测温', link: '/embedded/GD32F407_myLibrary_note/27-NTC热敏电阻测温' },
          ]
        },
        {
          text: '操作系统',
          collapsed: false,
          items: [
            { text: '33 裸机多任务taskmanager', link: '/embedded/GD32F407_myLibrary_note/33-裸机多任务taskmanager' },
            { text: '34 FreeRTOS移植', link: '/embedded/GD32F407_myLibrary_note/34-FreeRTOS移植' },
            { text: '35 FreeRTOS同步与中断机制', link: '/embedded/GD32F407_myLibrary_note/35-FreeRTOS同步与中断机制' },
          ]
        },
        {
          text: '专题总结',
          collapsed: true,
          items: [
            { text: '13 计时外设与频率计算', link: '/embedded/GD32F407_myLibrary_note/13-专题-计时外设与频率计算' },
            { text: '14 时钟树与总线', link: '/embedded/GD32F407_myLibrary_note/14-专题-时钟树与总线' },
            { text: '20 工程文档与硬件信息', link: '/embedded/GD32F407_myLibrary_note/20-工程文档与硬件信息' },
            { text: '21 定时器扩展功能汇总与比较', link: '/embedded/GD32F407_myLibrary_note/21-专题-定时器扩展功能汇总与比较' },
            { text: '22 通信协议汇总与比较', link: '/embedded/GD32F407_myLibrary_note/22-专题-通信协议汇总与比较' },
            { text: '23 如何查手册与数据手册', link: '/embedded/GD32F407_myLibrary_note/23-专题-如何查手册与数据手册' },
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