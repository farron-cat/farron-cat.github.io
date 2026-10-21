# 06 · 外部中断 EXTI · 学习笔记

> 这一篇讲 **3 次提交 + 1 次合并**：`7e3862f`（PA0 外部中断，跑通流程）→ `00d0615`（加第二路 Key4 + 消抖 + 时间戳）→ `dbb9026`（封装 `msp_exti`，改宏配置）。
> 整理日期：2026-09-23　｜　提交范围：`7e3862f`、`00d0615`、`dbb9026`、`d165f58`(合并)

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只要把按键中断跑起来 | 第四章「五步配置」+ 第八章排查清单 |
| 中断进去就死机 / 只进一次 | 看 4.4 节（清标志位）+ 排查清单前三条 |
| 想搞懂优先级 | 第二章 2.3 节 |
| 按键会重复触发 | 第六章「消抖」 |
| 想学封装套路 | 第七章，看「宏配置 + 条件编译」怎么用 |

## 知识点地图

```
外部中断 EXTI
├── 中断 vs 轮询        中断的四个特性、什么时候该用中断
├── 中断向量表          startup.s 里写死了函数名，名字错了就跳不到
├── NVIC 与优先级       抢占优先级 / 响应优先级，NVIC_PRIGROUP_PRE2_SUB2
├── EXTI 五步配置       时钟 → GPIO输入 → SYSCFG连线 → 触发极性 → NVIC+使能
├── SYSCFG 接线         EXTI 线路和引脚的「接线员」，最容易漏的一步
├── 中断服务函数套路     判标志 → 清标志 → 干活
├── 边沿判断            读引脚电平区分「上升沿/下降沿」，注意按键接法不同
├── 消抖（本工程重点）   30ms 时间窗 + 电平去重，用 get_us_cnt() 做时间戳
├── 封装               宏参数表 + 条件编译 USE_EXTI0 / USE_EXTI3
└── 中断里的禁忌        不做耗时操作、不用会阻塞的 printf、共享变量要 volatile
```

## 学习目标

- 说清楚中断解决了什么问题，以及为什么按键适合用中断
- 背下 EXTI 的五步配置，尤其是容易被漏掉的 `syscfg_exti_line_config()`
- 掌握中断服务函数的固定套路（判标志 → 清标志 → 处理）
- 会用「时间窗 + 电平去重」实现消抖，并理解为什么要用**无符号减法**
- 看懂本工程的宏配置式封装，知道条件编译在这里的作用
- 知道中断里什么事不能做，以及为什么

---

## 一、中断解决了什么问题

### 1.1 从轮询说起

没有中断时，程序只能**轮询**（polling）——不停地问「变了没？变了没？」：

```c
while (1)
{
    if (gpio_input_bit_get(GPIOA, GPIO_PIN_0) == SET)   // 问一次
    {
        // 处理
    }
    // ... 顺便干点别的
}
```

轮询有两个绕不过去的问题：

| 问题 | 说明 |
| --- | --- |
| **响应不及时** | 你问的间隔是 20 ms，那按一下至少延迟 0~20 ms 才被发现 |
| **浪费时间** | 99.99% 的时间答案都是「没变」，CPU 在做无用功 |

### 1.2 中断的四个特性

| 特性 | 白话解释 |
| --- | --- |
| **异步** | 什么时候来不知道，来了立刻跳过去 |
| **即时** | 硬件直接通知 CPU，响应是纳秒~微秒级 |
| **可嵌套** | 高优先级的中断可以打断低优先级的中断 |
| **有优先级** | 同时来多个请求时，按优先级决定谁先处理 |

### 1.3 中断 vs 轮询：本工程两种都用

| | 独立按键 KEY1~KEY4 | 核心板按键 PA0 / 扩展板 KE4 |
| --- | --- | --- |
| 实现方式 | **轮询**（`bsp_keys_scan()`，20 ms 一次） | **中断**（EXTI0 / EXTI3） |
| 代码位置 | 第 03 篇 | 本篇 |
| 为什么 | 4 个按键一一轮询，资源够用，逻辑简单 | 演示中断、学习消抖；按键事件要求即时 |
| 代价 | 20 ms 内的抖动/连击只能靠周期过滤 | 必须自己处理抖动，否则一次按下触发多次 |

> **结论**：不是「中断一定比轮询好」。**普通按键、数量少、对延迟不敏感 → 轮询更简单可靠**。中断适合「事件稀少但要即时」或「必须立刻响应」的场景（比如急停、编码器、串口接收）。

---

## 二、跑中断之前必须知道的三件事

### 2.1 中断向量表：名字是被写死的

`startup_gd32f407_427.s` 里有一张表，把「中断号」和「函数名」绑定死了：

```asm
__Vectors:
    DCD     Reset_Handler
    ...
    DCD     EXTI0_IRQHandler       ; 中断号 6
    DCD     EXTI1_IRQHandler
    DCD     EXTI2_IRQHandler
    DCD     EXTI3_IRQHandler       ; 中断号 9
    ...
```

所以**中断处理函数必须叫 `EXTI0_IRQHandler`**，改成 `Exti0_IRQHandler` 或者 `KEY_IRQHandler`，编译能过，但中断永远跳不进去——**这是排查时最隐蔽的一类问题**。

另一种做法（启动文件里已提供的弱符号）：函数名必须完全一致，否则就会走到启动文件里那个空的 `while(1)` 死循环上。

### 2.2 NVIC 与优先级

`NVIC`（Nested Vectored Interrupt Controller，嵌套向量中断控制器）负责管理所有中断。本工程在 `main()` 开头统一设置优先级分组：

```c
// 配置整个工程优先级分组 抢占:0~3  响应:0~3
nvic_priority_group_set(NVIC_PRIGROUP_PRE2_SUB2);
```

**4 个 bit 的优先级被分成两段**：

```
  bit3 bit2 │ bit1 bit0
  └─ 抢占 ──┘└─ 响应 ─┘
    0~3        0~3
```

| 类型 | 作用 | 规则 |
| --- | --- | --- |
| **抢占优先级** | 决定**能不能打断**正在执行的中断 | 数值小 = 优先级高。高抢占可以打断低抢占 |
| **响应优先级** | 决定**同时发生时谁先处理** | 数值小 = 先处理。**已开始执行后不能被打断** |

本工程所有外设中断都用 `nvic_irq_enable(xxx_IRQn, 2, 2)`，即抢占 2、响应 2——**统一水平，互不打断**。这样最简单，也最不容易出诡异问题。

**⚠️ 但这个分组在 2026-10-19 被改掉了**（移植 FreeRTOS 时）：

```c
// 裸机（09-16 ~ 10-18）
nvic_priority_group_set(NVIC_PRIGROUP_PRE2_SUB2);   // 2 位抢占 + 2 位响应

// 移植 FreeRTOS 之后（10-19 起）
nvic_priority_group_set(NVIC_PRIGROUP_PRE4_SUB0);   // 4 位全给抢占
```

**两个连带后果**（写中断代码时一定要知道）：

| 后果 | 说明 |
| --- | --- |
| **`nvic_irq_enable(irq, pre, sub)` 的 `sub` 失效** | 响应位是 0 位，**传什么都一样**。`msp_exti.c` 里那个 `2` 现在没有意义，实际优先级就是 `pre = 2` |
| ★ **所有 EXTI 中断（优先级 2）里都不能调 `xxxFromISR()`** | FreeRTOS 规定"优先级数值 ≥ 5"的中断才能调 ISR 版 API。**优先级 2 < 5 → 调了就破坏内核临界区**（详见 [第 35 篇 §4.2](35-FreeRTOS同步与中断机制.md)） |

> **本工程现在的 EXTI 里只置标志**（`g_rtc_int_flag` / `g_touch_key_int_flag`）——**恰好合规** ✅
> 但这是"被规则逼出来的正确"，**不是设计时就知道的**。
> **哪天想在 EXTI 里直接发队列/信号量，必须先把优先级改成 ≥ 5**（比如 6）。

> 只有在「串口接收不能被某段代码打断」这类需求下，才需要仔细排优先级。参考笔记 `EXTI.md` 第四章有 5 组优先级对照实验，值得一读。

### 2.3 EXTI 的 15 条线，一条线只认一个引脚号

EXTI 有 `EXTI_0` ~ `EXTI_15` 共 16 条线，**按引脚号（Pin Number）分组**：

```
EXTI_0  ← PA0 / PB0 / PC0 / PD0 ... 中只能选一个
EXTI_3  ← PA3 / PB3 / PC3 / PD3 ... 中只能选一个
```

本工程用到：

| 按键 | 引脚 | EXTI 线 | 中断号 |
| --- | --- | --- | --- |
| 核心板按键 | PA0 | `EXTI_0` | `EXTI0_IRQn` |
| 扩展板 KEY4 | PC3 | `EXTI_3` | `EXTI3_IRQn` |

**注意**：`PC0/PC1/PC2`（即 KEY1~KEY3）**不能用 EXTI0-2**，因为 `EXTI_0` 已经被 PA0 占了，`EXTI_1`/`EXTI_2` 也各只能接一个引脚号——但 PC0/PC1/PC2 的引脚号是 0/1/2，和 PA0 冲突。这正是 KEY1~3 只能轮询的原因之一。

---

## 三、提交 `7e3862f`：第一路外部中断（PA0）

**提交信息**：`[更新] PA0(核心板按键)外部中断`

这次提交在 `main.c` 里裸写了一个标准的 EXTI 配置，拆成两个函数：

```c
void GPIO_config(void)
{
    // 1.配置引脚GPIO模式
    rcu_periph_clock_enable(RCU_GPIOA);
    gpio_mode_set(GPIOA, GPIO_MODE_INPUT, GPIO_PUPD_NONE, GPIO_PIN_0);
}

void EXTI0_config(void)
{
    // 2.选择EXTI检测线路连接引脚(SYSCFG)
    rcu_periph_clock_enable(RCU_SYSCFG);
    syscfg_exti_line_config(EXTI_SOURCE_GPIOA, EXTI_SOURCE_PIN0);
    // 3. 配置EXTI检测极性(上升沿/下降沿/BOTH触发)
    exti_init(EXTI_0, EXTI_INTERRUPT, EXTI_TRIG_BOTH);
    // 4. 告诉NVIC要处理EXTI中断(NVIC中注册)
    nvic_irq_enable(EXTI0_IRQn, 2, 2);
    // 5. 清除中断标志位
    exti_interrupt_flag_clear(EXTI_0);
    // 打开EXTI中断
    exti_interrupt_enable(EXTI_0);
}

void EXTI_PA0_config(void)
{
    GPIO_config();
    EXTI0_config();
}
```

```c
// 6.实现中断处理函数
void EXTI0_IRQHandler(void)
{
    // 中断处理函数中的套路：先判断中断标志位，再清除中断标志位
    if (exti_interrupt_flag_get(EXTI_0) == SET)
    {
        exti_interrupt_flag_clear(EXTI_0);

        // 通过读取PA0引脚电平，判断是上升沿还是下降沿
        if (gpio_input_bit_get(GPIOA, GPIO_PIN_0) == SET)
        {
            // 上升沿
            printf("EXTI0_IRQHandler: rising edge\r\n");
        }
        else
        {
            // 下降沿
            printf("EXTI0_IRQHandler: falling edge\r\n");
        }
    }
}
```

### 3.1 EXTI 五步配置（背下来）

| 步 | 代码 | 干什么 | 漏了会怎样 |
| --- | --- | --- | --- |
| 1 | `rcu_periph_clock_enable(RCU_GPIOA)` + `gpio_mode_set(...)` | 把引脚配成**输入** | 引脚不受控，电平读不对 |
| 2 | `rcu_periph_clock_enable(RCU_SYSCFG)` + `syscfg_exti_line_config(...)` | **把 EXTI 线路接到具体引脚上** | **中断永远不来**（最常漏的一步） |
| 3 | `exti_init(EXTI_0, EXTI_INTERRUPT, EXTI_TRIG_BOTH)` | 配触发极性 | 用默认值，可能是「不触发」 |
| 4 | `nvic_irq_enable(EXTI0_IRQn, 2, 2)` | 在 NVIC 里打开该中断 | 外设触发了，但 CPU 不理 |
| 5 | `exti_interrupt_flag_clear()` + `exti_interrupt_enable()` | 清残留标志 + 打开 EXTI 中断使能 | 上电就进一次中断 / 完全不来 |

**第 2 步为什么这么容易漏？** 因为它和「配 GPIO」「配 EXTI」看起来不搭边——它是**接线**动作：

```
        PA0 引脚 ────[SYSCFG 接线员]──── EXTI_0 线路 ──── NVIC ──── CPU
                     ↑
        这一步就是 syscfg_exti_line_config(EXTI_SOURCE_GPIOA, EXTI_SOURCE_PIN0)
        「把 PA0 这根线，接到 EXTI_0 这条线上」
```

### 3.2 触发极性三种

```c
exti_init(EXTI_0, EXTI_INTERRUPT, EXTI_TRIG_BOTH);
```

| 参数 | 含义 | 适用 |
| --- | --- | --- |
| `EXTI_TRIG_RISING` | 只在**上升沿**触发 | 只关心按下（接下拉的按键） |
| `EXTI_TRIG_FALLING` | 只在**下降沿**触发 | 只关心按下（接上拉的按键） |
| **`EXTI_TRIG_BOTH`** | **上下沿都触发** | 本工程用它，按下和松开都能捕获 |

**选 `BOTH` 的代价**：消抖要处理**两次**（按下一次、松开一次），而且中断次数翻倍。换来的是「能区分按下/松开」。

### 3.3 怎么区分上升沿还是下降沿

EXTI 只告诉你「**有边沿发生了**」，不告诉你方向。所以要**读一下引脚当前电平**：

```c
if (gpio_input_bit_get(GPIOA, GPIO_PIN_0) == SET)
{
    // 当前是高电平 → 刚才应该是「从低变高」→ 上升沿
}
else
{
    // 当前是低电平 → 应该是「从高变低」→ 下降沿
}
```

**这个判断只在「边沿刚发生、信号还稳定」时成立**——这也是为什么要在中断服务函数最前面就做，不能先干别的事再读。

**注意 PA0 的电平含义**（回顾第 03 篇）：

| 按键 | 接法 | 松开 | 按下 |
| --- | --- | --- | --- |
| PA0（核心板） | 外部**下拉**，`GPIO_PUPD_NONE` | 低（`RESET`） | **高（`SET`）** |
| PC3（扩展板 KEY4） | 内部**上拉**，`GPIO_PUPD_PULLUP` | 高（`SET`） | **低（`RESET`）** |

所以「上升沿 = 按下」只对 PA0 成立，对 PC3 恰好相反。

---

## 四、提交 `00d0615`：第二路中断 + 消抖

**提交信息**：`[更新] 增加独立按键4外部中断，增加消抖`

这次提交做了两件事：**加 EXTI3（PC3）**、**给中断加消抖**。顺手还给 `systick.c` 加了时间戳（这是整个工程的关键基础设施）。

### 4.1 `systick.c`：新增微秒时间戳

```diff
 volatile static uint32_t delay;
+volatile static uint64_t us_cnt;

 void delay_decrement(void)
 {
+    us_cnt++;
+
     if (0U != delay)
     {
         delay--;
     }
 }
+
+uint64_t get_us_cnt(void)
+{
+    return us_cnt;
+}
```

`us_cnt` 每隔 1 μs 自增一次（SysTick 配成了 1 MHz），于是**全工程有了一个统一的「当前时刻」**。后面所有非阻塞定时、消抖、蜂鸣器节拍全靠它。

> **为什么用 `uint64_t` 而不是 `uint32_t`？** `uint32_t` 存微秒只能表示约 4295 秒（71 分钟），而且减去「上次时刻」时更容易溢出。`uint64_t` 可以用上几十万年——**用空间换掉一整类溢出 bug**。

### 4.2 消抖：两个手段配合

```c
uint64_t pre_cnt = 0U;          // 上次有效事件的时间戳
FlagStatus pre_status = SET;    // 上次记录的电平

void EXTI3_IRQHandler(void)
{
    uint64_t cur_cnt = get_us_cnt();

    // 中断处理函数中的套路：先判断中断标志位，再清除中断标志位
    if (exti_interrupt_flag_get(EXTI_3) == SET)
    {
        exti_interrupt_flag_clear(EXTI_3);

        // 消抖
        if (cur_cnt - pre_cnt < 30000)      // ① 时间窗：30 ms 内不再响应
            return;
        pre_cnt = cur_cnt;

        FlagStatus cur_status = gpio_input_bit_get(GPIOC, GPIO_PIN_3);
        if (cur_status == pre_status)       // ② 电平去重：电平没变就不处理
            return;
        pre_status = cur_status;

        if (cur_status == RESET)            // 下降沿 = 按下（PC3 上拉接法）
        {
            printf("EXTI3_IRQHandler: falling edge\r\n");
        }
        else
        {
            printf("EXTI3_IRQHandler: rising edge\r\n");
        }
    }
}
```

**两个手段各自解决什么问题**：

| 手段 | 解决的抖动类型 | 原理 |
| --- | --- | --- |
| **① 时间窗**（30 ms） | 按下/松开瞬间的**机械抖动**（一串几十~几百 μs 的毛刺） | 第一次触发后，30 ms 内所有后续触发直接忽略 |
| **② 电平去重** | **重复的边沿**（比如抖动结束又出现了同方向的边沿） | 只有「电平真的和上次不一样」才算有效事件 |

```
理想信号：       ────┐                    ┌────
                     └────────────────────┘
                     ↑按下                ↑松开

真实信号（有抖动）：──┐  ┌┐ ┌─              ┌──┐ ┌────
                     └──┘└─┘               ──┘  └┘
                     ↑↑↑↑ 4 次边沿触发！

加上消抖后：        ──┐                    ┌────
                     └────────────────────┘
                     只认这一次              只认这一次
```

**`if (cur_cnt - pre_cnt < 30000)` 这个减法的两个细节**：

| 细节 | 说明 |
| --- | --- |
| **为什么用减法而不是比大小** | `pre_cnt` 是「上次时刻」，`cur_cnt` 是「现在」。直接比大小在计数器回绕时会出错；**无符号减法会自动处理回绕**（`0x00 - 0xFFFFFFFF = 1`，结果仍然正确） |
| **为什么是 `<` 而不是 `<=`** | 语义上「严格小于 30000 μs 才算太近」，边界值放过去。差别不大，但要前后一致 |
| **30000 μs = 30 ms** | 机械按键抖动通常 5~20 ms，取 30 ms 留余量。太大（如 200 ms）会让快速连按失效 |

> **为什么不能用 `delay_1ms(20)` 来消抖？** 因为在**中断**里调 `delay_1ms()` 会让 CPU 空转 20 ms，期间所有同级中断都进不来——**中断里绝不做延时**。

### 4.3 一次「跑偏」：回调被整段注释掉

这次提交里，`main.c` 中的 `on_key_press()` **被整块注释掉了**（第 03 篇里刚写好的那段），`main()` 里 `bsp_keys_config()`、`bsp_battery_flow_init()` 等也都被注释，主循环只剩空转。

**这不是失误，是「测试模式」**——作者当时只想**单独验证 EXTI 能不能工作**，把其他干扰全部关掉。**调试单点问题时隔离变量，是很有效的手段**，但代价是：这些注释块需要在 `dbb9026` 之后清理，否则代码会越来越脏。

> **可以学的手法**：调试时用 `#if 0 ... #endif` 代替大段注释，语义更清楚；或者干脆建一个分支专门调。

---

## 五、提交 `dbb9026`：封装成 `msp_exti`

**提交信息**：`[更新] 封装外部中断msp_exti`（新建 `Hardware/msp_exti/`，`main.c` 掉 154 行）

这次提交把「宏配置」和「装饰函数」两种套路都用上了。

### 5.1 头文件：把引脚参数写成宏

```c
#define USE_EXTI0 1
#define USE_EXTI3 1

#if USE_EXTI0
#define EXTI0_PORT_RCU  RCU_GPIOA
#define EXTI0_PORT      GPIOA
#define EXTI0_PIN       GPIO_PIN_0
#define EXTI0_PUPD      GPIO_PUPD_NONE
#define EXTI0_EXTI_PORT EXTI_SOURCE_GPIOA
#define EXTI0_EXTI_PIN  EXTI_SOURCE_PIN0
#define EXTI0_NUM       EXTI_0
#define EXTI0_TRIG_TYPE EXTI_TRIG_BOTH
#define EXTI0_IRQ       EXTI0_IRQn
#endif

#if USE_EXTI3
#define EXTI3_PORT_RCU  RCU_GPIOC
#define EXTI3_PORT      GPIOC
#define EXTI3_PIN       GPIO_PIN_3
#define EXTI3_PUPD      GPIO_PUPD_PULLUP
#define EXTI3_EXTI_PORT EXTI_SOURCE_GPIOC
#define EXTI3_EXTI_PIN  EXTI_SOURCE_PIN3
#define EXTI3_NUM       EXTI_3
#define EXTI3_TRIG_TYPE EXTI_TRIG_BOTH
#define EXTI3_IRQ       EXTI3_IRQn
#endif

void msp_exti_init();
```

**这一段是全工程「改配置最方便」的地方**：把「用哪个引脚、什么极性、哪个中断号」全部集中成了 9 个宏。换个引脚时，改这几行就行，**逻辑代码一行不动**。

`USE_EXTI0` / `USE_EXTI3` 是**开关**：改成 0 就整个关掉这一路（连中断函数一起被 `#if` 掉）。适合做「这块板子只有一颗按键」的裁剪。

### 5.2 实现文件：一个通用配置函数 + 两次调用

```c
static void EXTI_config(rcu_periph_enum rcu, uint32_t port, uint32_t pin, uint32_t pupd,
                        uint8_t exti_port, uint8_t exti_pin, exti_line_enum linex,
                        exti_trig_type_enum trig_type, uint8_t nvic_irq)
{
    // 1. 配置引脚GPIO模式
    rcu_periph_clock_enable(rcu);
    gpio_mode_set(port, GPIO_MODE_INPUT, pupd, pin);

    // 2. 选择EXTI检测线路连接引脚(SYSCFG)
    rcu_periph_clock_enable(RCU_SYSCFG);
    syscfg_exti_line_config(exti_port, exti_pin);
    // 3. 配置EXTI检测极性(上升沿/下降沿/BOTH触发)
    exti_init(linex, EXTI_INTERRUPT, trig_type);
    // 4. 告诉NVIC要处理EXTI中断
    nvic_irq_enable(nvic_irq, 2, 2);

    // 清理中断标志位
    exti_interrupt_flag_clear(linex);
    // 5. 打开EXTI中断
    exti_interrupt_enable(linex);
}

void msp_exti_init()
{
#if USE_EXTI0
    EXTI_config(EXTI0_PORT_RCU, EXTI0_PORT, EXTI0_PIN, EXTI0_PUPD, EXTI0_EXTI_PORT,
                EXTI0_EXTI_PIN, EXTI0_NUM, EXTI0_TRIG_TYPE, EXTI0_IRQ);
#endif

#if USE_EXTI3
    // 初始化PC3
    EXTI_config(EXTI3_PORT_RCU, EXTI3_PORT, EXTI3_PIN, EXTI3_PUPD, EXTI3_EXTI_PORT,
                EXTI3_EXTI_PIN, EXTI3_NUM, EXTI3_TRIG_TYPE, EXTI3_IRQ);
#endif
}
```

**这个 `EXTI_config()` 有 9 个参数，看着吓人，但它把原来两段几乎一样的代码合并成了一份**。对比一下：

| | 封装前 | 封装后 |
| --- | --- | --- |
| 配置代码 | `EXTI0_config()` + `EXTI_PC3_config()` 两段重复 | 一个 `EXTI_config()` |
| 加第 3 路中断 | 复制 18 行 | 加 9 个宏 + 1 次调用 |
| 引脚参数位置 | 散在函数体里 | 集中在头文件宏区 |

> **9 个参数算不算「太多」？** 算。更彻底的方案是把参数打包成结构体（像第 04 篇串口的 `USART_HandleTypeDef` 那样）。这里没做，属于「够用就好」——**不是所有重构都必须做到极致**。

### 5.3 中断服务函数：把调试打印换成有意义的输出

```c
// EXTI0中断处理函数
#if USE_EXTI0
void EXTI0_IRQHandler()
{
    static FlagStatus pre_sta = RESET;
    static uint64_t pre_cnt = 0;

    if (exti_interrupt_flag_get(EXTI0_NUM) == SET)
    {
        exti_interrupt_flag_clear(EXTI0_NUM);

        // 消抖
        uint64_t cur_cnt = get_us_cnt();
        if (cur_cnt - pre_cnt <= 30000)
        {
            return;
        }
        pre_cnt = cur_cnt;
        FlagStatus cur_sta = gpio_input_bit_get(EXTI0_PORT, EXTI0_PIN);
        if (cur_sta == pre_sta)
        {
            return;
        }
        pre_sta = cur_sta;
        // 按下和松开判断
        if (cur_sta == SET)
        { // 上升沿  按下        ← PA0 是外部下拉，按下为高
            printf("KEYC_D\n");
        }
        else
        { // 下降沿  松开
            printf("KEYC_U\n");
        }
    }
}
#endif
```

**三个改进**：

| 改进 | 说明 |
| --- | --- |
| 消抖**两路都加了** | `7e3862f` 时 EXTI0 还没有消抖，这次补上 |
| 状态变量改成 **`static` 局部变量** | 原来 `pre_cnt`/`pre_status` 是全局变量（谁都能改）；现在藏在函数里，**只有这个中断能碰**，消除了跨文件改坏的可能 |
| 打印内容更有意义 | 从「rising/falling edge」换成 `KEYC_D`（Down，按下）/ `KEYC_U`（Up，松开） |

**两路的初始值不同，而且都对**：

| | `pre_sta` 初值 | 理由 |
| --- | --- | --- |
| EXTI0（PA0） | `RESET` | 外部下拉，**松开时是低电平** → 假设「初始是松开的」 |
| EXTI3（PC3） | `SET` | 内部上拉，**松开时是高电平** → 假设「初始是松开的」 |

**两条路都表达同一个意思：「上电时假设按键没被按着」**。如果初值写反，上电第一次中断会被误判成「松开了」。

### 5.4 中断放在哪个文件

和串口一样，中断服务函数就近放在驱动文件里（`msp_exti.c`），配合头文件里的 `EXTI0_IRQn` 宏使用：

```c
#if USE_EXTI0
void EXTI0_IRQHandler() { ... }
#endif
```

**注意**：`EXTI0_IRQHandler` 这个名字**不能改**（启动文件写死了），但整个函数体被 `#if USE_EXTI0` 包住——**关掉这一路时，函数也随之消失，不会有「定义了但没用」的浪费**。

---

## 六、合并回主线

```bash
d165f58 [合并]: 合并exti分支到main
```

`exti` 分支的三次提交（`7e3862f` → `00d0615` → `dbb9026`）都做完并验证后，一次性合回 `main`。合并时 `main` 上正好也在同时推进定时器/PWM（第 07 篇），**两条线各自独立、互不冲突**。

> 分支用的好：**同一个文件（`main.c`）被两条线反复改，如果不分分支，冲突会非常难解**。延迟到功能完成再合并，两次「大改」就变成两次干净的合并。

---

## 六之二、后续（2026-10-13 ~ 10-15）：EXTI 名单扩到 6 条线，以及两次"分层反转"

**到 2026-10-15，`msp_exti.h` 里的开关涨到 6 个、EXTI 线也是 6 条**（`c4a098e`/`1772f82`/`2bdc21f`）：

```c
#define USE_EXTI0  1 // 核心板按键 KEYC
#define USE_EXTI3  1 // 独立按键 KEY4
#define USE_EXTI5  1 // PCF8563（第 17 篇）
#define USE_EXTI8  1 // PB8 触摸按键                ← 2026-10-15 新增（第 31 篇）
#define USE_EXTI11 1 // 旋转编码器引脚A
#define USE_EXTI15 1 // 旋转编码器引脚B   （注释写错了，实际是"引脚D 按键"）
```

| 线 | 引脚 | 上下拉 | 触发 | IRQ 向量 | 谁在用 |
| --- | --- | --- | --- | --- | --- |
| EXTI0 | PA0 | ⚠️ **`PUPD_NONE`**（板上悬空，硬件文档 P3 问题） | 双边沿 | `EXTI0_IRQn` | 核心板按键 KEYC |
| EXTI3 | PC3 | 上拉 | 双边沿 | `EXTI3_IRQn` | 独立按键 KEY4 |
| EXTI5 | PB5 | 上拉 | 下降沿 | `EXTI5_9_IRQn` | PCF8563 的 INT（第 17 篇） |
| **EXTI8** | **PB8** | ⚠️ **`PUPD_NONE`** | **双边沿** | **`EXTI5_9_IRQn`** | **SC12B 触摸按键（第 31 篇）** |
| **EXTI11** | **PD11** | 上拉 | **双边沿** | **`EXTI10_15_IRQn`** | **旋转编码器 A 相（第 29 篇）** |
| **EXTI15** | **PD15** | 上拉 | **下降沿** | **`EXTI10_15_IRQn`** | **旋转编码器按键（第 29 篇）** |

> **横向看这张表能立刻发现两件事**（这就是"把参数摊成一张表"的价值）：
>
> | 观察 | 说明 |
> | --- | --- |
> | **只有 EXTI0 和 EXTI8 用 `PUPD_NONE`** | 而 **EXTI0 那一路是有名的隐患**（板上悬空 → 伪中断，P3 问题）。**EXTI8 大概率是照抄了 EXTI0 的参数** —— 同一类风险，见 [第 31 篇 §7.3](31-触摸按键SC12B.md) |
> | **EXTI5 和 EXTI8 共用 `EXTI5_9_IRQn`** | 芯片把 EXTI5~EXTI9 打包成**一个向量**，所以 Handler 里必须**逐个判标志**（见下面 ① 的代码） |

**★ 两个新知识点**：

**① EXTI10~EXTI15 共用一个 IRQ 向量** —— 所以一个 Handler 里要**逐个判标志**：

```c
void EXTI10_15_IRQHandler()
{
#if USE_EXTI15
    if (exti_interrupt_flag_get(EXTI_15) == SET) { exti_interrupt_flag_clear(EXTI_15); on_ec12d_key_press(); }
#endif
#if USE_EXTI11
    if (exti_interrupt_flag_get(EXTI_11) == SET) { exti_interrupt_flag_clear(EXTI_11); on_ec12d_exti(); }
#endif
}
```

**"进了 Handler 就当某一条线触发了"是常见错误**——芯片把 6 条线打包成一个向量，**必须自己分辨**。

**`EXTI5_9_IRQHandler()` 现在同时服务两条线**（10-15 之后）：

```c
void EXTI5_9_IRQHandler()
{
#if USE_EXTI5
    if (exti_interrupt_flag_get(EXTI_5) == SET)
    { exti_interrupt_flag_clear(EXTI_5); g_rtc_int_flag = 1; }          // 第 17 篇
#endif
#if USE_EXTI8
    if (exti_interrupt_flag_get(EXTI_8) == SET)
    { exti_interrupt_flag_clear(EXTI_8); g_touch_key_int_flag = 1; }    // 第 31 篇
#endif
}
```

**★ 而且两条线都遵守了同一条纪律：中断里只置 `volatile` 标志，重活交给主循环。**
这条路是分开走出来的——`EXTI5`（闹钟）在 `87da7e0` 修过一次，`EXTI8`（触摸）在 `dcdda0d` 又修过一次，
**两次踩的是同一个坑、用的是同一个修法**（详见 [第 31 篇 §4.3](31-触摸按键SC12B.md) 的「中断三不做」）。

> **顺带一个容易踩的细节**：`EXTI_config()` 里对**每条线**都调了一次
> `nvic_irq_enable(nvic_irq, 2, 2)`。**EXTI5 和 EXTI8 共用同一个 IRQ**，
> 所以这两次调用是**对同一个中断号重复设置**——**后一次会覆盖前一次**。
> 本工程两处参数相同（都是 2/2）所以看不出问题，**但如果哪天想让 PCF8563 更优先，改一处是没用的，得两处一起改。**

**② ⚠️ `msp_exti.c` 里出现了两次 `#include "bsp_*.h"`（分层反转，2026-10-15 变成第 2 例）**

```c
#include "msp_exti.h"
#include "bsp_ec12d.h"        // ← 2026-10-13 加入（第 29 篇）
#include "bsp_touch_key.h"    // ← 2026-10-15 加入（第 31 篇）
```


本工程自己的分层约定是（`模板结构.txt` / `README.md`）：

```
Hardware/  ← 片上外设驱动（msp_*）     硬件层
Driver/    ← 片外器件驱动（bsp_*）     驱动层
```

**片上外设不该知道"板外接了什么器件"**。`msp_exti` 为了一条中断线去 include 一个器件驱动，
会让"换个编码器型号就得改 `msp_exti`"。

**更干净的做法**（本工程里已有先例）：

```c
// msp_exti.c —— 只声明一个弱回调，不 include 任何 Driver
__weak void on_exti11(void) { }
// Handler 里：on_exti11();
// bsp_ec12d.c —— 由器件层去"认领"这条线
void on_exti11(void) { on_ec12d_exti(); }
```

**这和 `msp_uart` 的回调、`msp_rtc` 的 `Time` 结构体是同一个思路**（第 04/11 篇）：
**片上层定义"接口"，器件层提供"实现"**。

**③（顺带）中断里做重活的老问题又出现了**：`on_ec12d_exti()` 直接调 `on_ec12d_key_press()`
等 `__weak` 回调，而默认实现是 **`printf`**（阻塞 1.6 ms）——**违反第 17 篇 §5.5 立的规矩**。
详见 **[第 29 篇 §5.4](29-旋转编码器EC12.md)** 与 [第 31 篇 §7.6](31-触摸按键SC12B.md)。

**④（10-15 新增）其中一处的 include 现在可以顺手删掉**：

`dcdda0d` 把 `EXTI8` 的处理改成"只置 `g_touch_key_int_flag`"之后，
**`msp_exti.c` 已经不再调用 `bsp_touch_key` 里的任何函数了**——
那个 `g_touch_key_int_flag` **就定义在本文件里**，Handler 也是本文件里的。

```
`#include "bsp_touch_key.h"` 在 dcdda0d 之前： 必须的（要调 on_touch_key_interrupt）
在 dcdda0d 之后：                            无用的（一条遗留）
```

> **这是"重构会留下痕迹"的典型**：一次正确的修复（把重活搬走）会让另一个东西（那个 include）变成多余，
> **但没人会专门去删它**。所以**每次改完都值得回头看一眼"我还有哪些东西用不到了"**。

---

## 七、最终代码速查

```c
// --- Hardware/msp_exti.h ---
#define USE_EXTI0  1    // 开关：EXTI0 （PA0， 核心板按键 KEYC）
#define USE_EXTI3  1    // 开关：EXTI3 （PC3， 独立按键 KEY4）
#define USE_EXTI5  1    // 开关：EXTI5 （PB5， PCF8563 的中断，第 17 篇）
#define USE_EXTI8  1    // 开关：EXTI8 （PB8， SC12B 触摸按键，第 31 篇）
#define USE_EXTI11 1    // 开关：EXTI11（PD11，旋转编码器 A，第 29 篇）
#define USE_EXTI15 1    // 开关：EXTI15（PD15，旋转编码器按键，第 29 篇）
void msp_exti_init();

// 配置宏（每个引脚 9 个）
EXTIx_PORT_RCU / EXTIx_PORT / EXTIx_PIN / EXTIx_PUPD
EXTIx_EXTI_PORT / EXTIx_EXTI_PIN / EXTIx_NUM / EXTIx_TRIG_TYPE / EXTIx_IRQ
```

**参数速查表**：

| 项目 | EXTI0 | EXTI3 |
| --- | --- | --- |
| 引脚 | PA0（核心板按键） | PC3（扩展板 KEY4） |
| 上下拉 | `GPIO_PUPD_NONE`（外部下拉） | `GPIO_PUPD_PULLUP`（内部上拉） |
| 松开电平 | 低（`RESET`） | 高（`SET`） |
| 按下电平 | **高（`SET`）** | **低（`RESET`）** |
| EXTI 线 | `EXTI_0` | `EXTI_3` |
| SYSCFG 参数 | `EXTI_SOURCE_GPIOA` / `EXTI_SOURCE_PIN0` | `EXTI_SOURCE_GPIOC` / `EXTI_SOURCE_PIN3` |
| 触发极性 | `EXTI_TRIG_BOTH` | `EXTI_TRIG_BOTH` |
| NVIC | `EXTI0_IRQn`，优先级 2/2 | `EXTI3_IRQn`，优先级 2/2 |
| 中断函数名 | `EXTI0_IRQHandler` | `EXTI3_IRQHandler` |
| 消抖窗口 | 30000 μs（30 ms） | 30000 μs（30 ms） |
| 打印 | `KEYC_D` / `KEYC_U` | `KEY4_D` / `KEY4_U` |

**中断服务函数的标准骨架**（背下来）：

```c
void XXX_IRQHandler(void)
{
    if (xxx_interrupt_flag_get(...) == SET)     // ① 先判标志
    {
        xxx_interrupt_flag_clear(...);          // ② 再清标志（顺序不能反）

        // ③ 干活：做尽量少、尽量快的事
    }
}
```

---

## 八、排查清单

| 现象 | 优先检查 |
| --- | --- |
| 中断完全不触发 | **漏了 `syscfg_exti_line_config()`**；或中断函数名拼错（必须叫 `EXTI0_IRQHandler`） |
| 只进一次中断，之后再也进不来 | 中断里**没清标志位**；或清了但清错了对象 |
| 上电立刻进一次中断 | `exti_interrupt_flag_clear()` 没在 `exti_interrupt_enable()` **之前**调用 |
| 按键一次触发好几次 | 没消抖；或消抖窗口太短（抖动约 5~20 ms，建议 ≥ 20 ms） |
| 快速连按没反应 | 消抖窗口太长（30 ms 已偏保守，别再加到 100 ms 以上） |
| 中断里读到错误的电平 | 判断边的代码放在后面了，信号已经变化；应**进中断立刻读** |
| 按下/松开判断反了 | 忘了 PA0 是**外部下拉（按下=高）**、PC3 是**内部上拉（按下=低）** |
| 中断进不去，但 GPIO 单独读电平正常 | `nvic_irq_enable()` 没调；或优先级分组没设导致优先级越界 |
| 中断里打印卡死 / 丢字符 | 在中断里用了阻塞的 `printf`——**中断里尽量别打印**（本工程为了学习而打，生产代码应改成置标志） |
| 主循环里读中断改的变量读到旧值 | 变量缺 `volatile`（如 `us_cnt`、`pre_cnt`） |
| 加第三路中断时两路互相干扰 | 两条 EXTI 线用了同一个引脚号（`EXTI_0` 只能接 pin0） |
| 编译报重复定义 `EXTI0_IRQHandler` | 关掉的那一路仍被编译，和别处的实现撞名 |

## 九、自测题

1. 中断和轮询各自的优缺点是什么？本工程为什么让 KEY1~KEY3 轮询、PA0/PC3 用中断？
2. EXTI 配置的五步分别是什么？哪一步最容易漏、漏了会有什么现象？
3. `syscfg_exti_line_config()` 到底做了什么？为什么它和「配 GPIO」看起来没关系却必须调用？
4. 中断服务函数的名字为什么不能改？改了之后编译能过但会发生什么？
5. 为什么「先判标志、再清标志」这个顺序不能反？如果先清再判会怎样？
6. 消抖为什么要用**两个**手段（时间窗 + 电平去重）？只用时间窗行不行？
7. `cur_cnt - pre_cnt < 30000` 为什么不写成 `cur_cnt < pre_cnt + 30000`？
8. PA0 和 PC3 的「按下」分别是高电平还是低电平？为什么两路的 `pre_sta` 初值不同却表达同一个含义？
9. 中断里为什么不能调 `delay_1ms()`？那 `printf()` 呢？
10. 为什么把 `pre_cnt` 从全局变量改成函数内的 `static` 变量是一种改进？
11. `USE_EXTI0` 改成 0 之后，哪些代码会消失？这个宏适合用在什么场景？

## 十、练习题

1. 新增一路 EXTI（比如 PB5，用一个外部按键），走一遍完整的五步 + 头文件加 9 个宏 + 中断函数。
2. 把中断里的 `printf` 改成「置一个标志位」，在主循环里检查标志并打印——体会「中断只做最少的事」。
3. 用 `EXTI_TRIG_FALLING` 只捕获按下，观察消抖需要怎么调整（提示：不需要再判上升沿了）。
4. 给 `EXTI_config()` 的 9 个参数打包成一个 `EXTI_PARAM` 结构体，参考第 04 篇串口句柄化的做法。
5. 把 `on_key_press` 回调（第 03 篇）和 EXTI 结合起来：让 PA0 中断也触发 `on_key_press` 那套业务逻辑，而不是直接 `printf`。

---

## 附：提交清单

| 提交 | 日期 | 说明 | 关键改动 |
| --- | --- | --- | --- |
| `7e3862f` | 2026-09-20 15:05 | [更新] PA0（核心板按键）外部中断 | `main.c` 里新增 `GPIO_config()` / `EXTI0_config()` / `EXTI_PA0_config()` + `EXTI0_IRQHandler()`；用「读引脚电平」区分上/下降沿；`main()` 里把 LED、按键、流水灯全部注释，只留 EXTI（隔离调试） |
| `00d0615` | 2026-09-20 17:25 | [更新] 增加独立按键 4 外部中断，增加消抖 | 新增 `EXTI_PC3_config()` + `EXTI3_IRQHandler()`；引入 **30 ms 时间窗 + 电平去重**消抖；`systick.c/h` 新增 `us_cnt` / `get_us_cnt()`；`on_key_press` 整段注释 |
| `dbb9026` | 2026-09-20 18:05 | [更新] 封装外部中断 msp_exti | **新建 `Hardware/msp_exti/`**：宏参数表（9 个/路）+ 条件编译开关 + 通用 `EXTI_config()`；中断函数移入 `msp_exti.c`；状态变量改为局部 `static`；`main.c` 掉 154 行 |
| `d165f58` | 2026-09-21 11:34 | [合并] 合并 exti 分支到 main | 三次提交整体合入主线 |
| `1772f82` | 2026-10-13 11:48 | [更新] 旋转编码器 EXTI 中断配置（**跨模块改动**） | 新增 `USE_EXTI11`（PD11，双边沿）/ `USE_EXTI15`（PD15，下降沿），两者共用 `EXTI10_15_IRQn`；`msp_exti.c` 开始 `#include "bsp_ec12d.h"`；详见 [第 29 篇](29-旋转编码器EC12.md) |
| `2bdc21f` | 2026-10-15 20:00 | [更新] bsp_touch_key 触摸按键 封装（**跨模块改动**） | 新增 `USE_EXTI8`（**PB8**，双边沿，`PUPD_NONE`）+ `EXTI5_9_IRQHandler` 里加分支；`msp_exti.c` 再 `#include "bsp_touch_key.h"`；详见 [第 31 篇](31-触摸按键SC12B.md) |
| `dcdda0d` | 2026-10-15 20:25 | [修复] 触摸按键干扰 OLED（**跨模块改动**） | **`EXTI5_9_IRQHandler` 里 `on_touch_key_interrupt()` → `g_touch_key_int_flag = 1`**；新增 `volatile uint8_t g_touch_key_int_flag` |

**这个模块的三级台阶**

| 台阶 | 提交 | 解决了什么 |
| --- | --- | --- |
| 1. 跑通 | `7e3862f` | EXTI 五步流程、中断函数骨架、边沿方向判断 |
| 2. 可靠 | `00d0615` | 第二路中断 + 消抖 + 时间戳基础设施 |
| 3. 好维护 | `dbb9026` | 宏配置化、代码去重、状态变量收窄作用域 |
| 4. 多路可用 | `1772f82` `2bdc21f` | **一条一条往上加**（旋钮 2 路、触摸 1 路），验证了"宏配置化"的设计确实扛得住扩容 |
| 5. 不互相伤害 | `dcdda0d` | **中断里只剩置标志**——EXTI 从"触发者"退化成"通知者"，`printf`/I2C 全搬走 |

## 参考笔记

- `../../../NOTE/Note/EXTI.md` —— 外部中断（中断四特性、中断向量表、NVIC 三级优先级、5 组优先级对照实验、EXTI 触发源）
  - 第三章「NVIC 与中断优先级」是本章 2.2 节的详细版；第四章的 5 组实验非常适合动手验证
  - 第六章「实战一：硬件外部中断（按键触发）」与本篇第四、五章是同一件事

> 本笔记仅作学习整理，内容来自本仓库真实提交记录。
