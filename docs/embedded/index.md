# 嵌入式开发

欢迎来到嵌入式开发笔记区。这里记录了从单片机入门到RTOS实战的完整学习路径。

## 📚 内容概览

### GD32F407 学习笔记

基于 GD32F407 微控制器的系统化学习笔记，涵盖从工程搭建到 FreeRTOS 移植的完整开发流程。

- **35 篇模块笔记**：按 git 提交记录逐步展开，讲清楚每一次代码变化的原因
- **5 篇专题总结**：横向串联相关知识点，建立完整知识体系
- **109 个提交**：真实的开发过程，包括排障思路和踩坑记录

#### 📖 快速导航

**基础模块**
- [工程搭建](./GD32F407_myLibrary_note/01-工程搭建.md) - 目录分层、启动流程、时间基准
- [GPIO-LED灯组](./GD32F407_myLibrary_note/02-GPIO-LED灯组.md) - 参数表化设计
- [独立按键](./GD32F407_myLibrary_note/03-独立按键.md) - 事件枚举与回调机制
- [串口USART](./GD32F407_myLibrary_note/04-串口USART.md) - 三级台阶封装

**中断与定时**
- [外部中断EXTI](./GD32F407_myLibrary_note/06-外部中断EXTI.md) - 中断线配置与消抖
- [定时器与PWM](./GD32F407_myLibrary_note/07-定时器与PWM.md) - 定时中断、软硬PWM
- [DMA](./GD32F407_myLibrary_note/08-DMA.md) - 直接内存访问

**通信协议**
- [IIC总线](./GD32F407_myLibrary_note/15-IIC总线.md) - 软件模拟与硬件IIC
- [SPI总线](./GD32F407_myLibrary_note/16-SPI总线.md) - 高速串行通信
- [SPI-Flash存储](./GD32F407_myLibrary_note/24-SPI-Flash存储.md) - W25Q64 驱动

**外设驱动**
- [OLED显示屏](./GD32F407_myLibrary_note/18-OLED显示屏.md) - SSD1306 驱动
- [数码管](./GD32F407_myLibrary_note/09-数码管.md) - 动态扫描
- [矩阵键盘](./GD32F407_myLibrary_note/10-矩阵键盘.md) - 行列扫描
- [旋转编码器EC12](./GD32F407_myLibrary_note/29-旋转编码器EC12.md) - 相位检测
- [WS2812彩灯](./GD32F407_myLibrary_note/30-WS2812彩灯.md) - 单总线时序控制
- [点阵屏MAX7219](./GD32F407_myLibrary_note/32-点阵屏MAX7219.md) - SPI 级联驱动

**传感器与模拟**
- [ADC](./GD32F407_myLibrary_note/19-ADC.md) - 模数转换
- [NTC热敏电阻测温](./GD32F407_myLibrary_note/27-NTC热敏电阻测温.md) - 温度采集
- [AD按键ADKEY](./GD32F407_myLibrary_note/28-AD按键ADKEY.md) - 模拟量按键识别

**系统与电源**
- [RTC实时时钟](./GD32F407_myLibrary_note/11-RTC实时时钟.md) - 内部RTC
- [PCF8563外部RTC](./GD32F407_myLibrary_note/17-PCF8563外部RTC.md) - IIC外部时钟
- [看门狗](./GD32F407_myLibrary_note/12-看门狗.md) - IWDG/FWDG
- [PMU电源管理](./GD32F407_myLibrary_note/25-PMU电源管理.md) - 低功耗模式

**操作系统**
- [裸机多任务taskmanager](./GD32F407_myLibrary_note/33-裸机多任务taskmanager.md) - 自制任务调度器
- [FreeRTOS移植](./GD32F407_myLibrary_note/34-FreeRTOS移植.md) - RTOS 集成与排障 ⭐
- [FreeRTOS同步与中断机制](./GD32F407_myLibrary_note/35-FreeRTOS同步与中断机制.md) - 临界区、信号量

**专题总结**
- [计时外设与频率计算](./GD32F407_myLibrary_note/13-专题-计时外设与频率计算.md) - SysTick/TIMER 频率公式
- [时钟树与总线](./GD32F407_myLibrary_note/14-专题-时钟树与总线.md) - 时钟配置全解析
- [定时器扩展功能汇总与比较](./GD32F407_myLibrary_note/21-专题-定时器扩展功能汇总与比较.md) - 定时器高级功能
- [通信协议汇总与比较](./GD32F407_myLibrary_note/22-专题-通信协议汇总与比较.md) - USART/IIC/SPI/单总线对比
- [如何查手册与数据手册](./GD32F407_myLibrary_note/23-专题-如何查手册与数据手册.md) - 芯片手册使用指南

#### 🌟 推荐阅读路线

**完全新手（零基础）**
1. [01 工程搭建](./GD32F407_myLibrary_note/01-工程搭建.md) → [02 GPIO-LED](./GD32F407_myLibrary_note/02-GPIO-LED灯组.md) → [03 独立按键](./GD32F407_myLibrary_note/03-独立按键.md)
2. [06 外部中断](./GD32F407_myLibrary_note/06-外部中断EXTI.md) → [07 定时器与PWM](./GD32F407_myLibrary_note/07-定时器与PWM.md)
3. [04 串口USART](./GD32F407_myLibrary_note/04-串口USART.md) - 重点看三级封装的思路

**想学外设驱动**
- 外接模块完整套路：[26 188数码管](./GD32F407_myLibrary_note/26-188数码管.md) → [28 AD按键](./GD32F407_myLibrary_note/28-AD按键ADKEY.md) → [29 旋转编码器](./GD32F407_myLibrary_note/29-旋转编码器EC12.md) → [30 WS2812](./GD32F407_myLibrary_note/30-WS2812彩灯.md) → [31 触摸按键](./GD32F407_myLibrary_note/31-触摸按键SC12B.md) → [32 点阵屏](./GD32F407_myLibrary_note/32-点阵屏MAX7219.md)

**想理解RTOS**
- ⭐ **必读顺序**：[33 裸机多任务](./GD32F407_myLibrary_note/33-裸机多任务taskmanager.md) → [34 FreeRTOS移植](./GD32F407_myLibrary_note/34-FreeRTOS移植.md) → [35 FreeRTOS同步与中断](./GD32F407_myLibrary_note/35-FreeRTOS同步与中断机制.md)
- 移植遇到问题？看 [34 篇第五章](./GD32F407_myLibrary_note/34-FreeRTOS移植.md) 的 DWT 排障全过程

**准备面试**
- 每篇末尾的「参数速查表 + 排查清单 + 自测题」
- 专题篇的总表适合快速回忆

#### 📖 完整目录

查看 [GD32F407 笔记总览](./GD32F407_myLibrary_note/README.md) 了解全部内容和更新日志。

---

## 🎯 学习建议

- **不要跳着看**：笔记按提交演进组织，后面的模块会复用前面的封装思路
- **重视"为什么"**：每个提交都会解释"为什么要这样改"，而不只是"改成什么"
- **动手验证**：遇到参数计算、时序配置，建议自己用公式算一遍
- **关注排障过程**：笔记保留了完整的翻车现场和修复思路

## 📚 相关资源

- 笔记基于真实项目提交记录整理
- 每篇都有参考笔记、教材快照、官方手册的引用
- 涉及参数计算的结论都经过公式验算
