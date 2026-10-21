# 07 · 定时器与 PWM · 学习笔记

> 这一篇覆盖 **9 次提交**（全项目最大的一个模块）：从「定时器中断 1 秒闪一次」一路做到「硬件 PWM 呼吸灯」「蜂鸣器播《小星星》」「P/N 互补双通道」。
> 整理日期：2026-09-23　｜　提交范围：`4cec095`、`a2eeece`、`1f76f67`、`f5cb7e3`、`698a2c6`、`ef6a015`、`b4f56b7`、`298f9db`、`1678ba3`

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 想赶紧出个 PWM | 第二章（参数怎么算）→ 第四章（硬 PWM）+ 第九章速查表 |
| 定时器时间总是不对 | **第二章 2.2 节**，把那条公式抄十遍 |
| 想看「同一个功能三种做法」 | 第三章（中断版 / 软 PWM / 硬 PWM），这是本篇最有价值的对照 |
| 蜂鸣器不响 | 第七章 7.3 节（本工程真踩过的坑）+ 第十章排查清单 |
| 想搞高级定时器互补输出 | 第八章 |

## 知识点地图

```
定时器与 PWM
├── 定时器基础           三个核心部件（时钟源 / 预分频 / 计数器）、溢出周期公式
├── 时钟倍频             rcu_timer_clock_prescaler_config(RCU_TIMER_PSC_MUL4) → 168 MHz
├── PSC 与 ARR           PSC 管「慢下来」，ARR 管「数到几」
├── 中断式定时           TIMER5：1s 定时中断（中断向量名叫 TIMER5_DAC_IRQHandler）
├── 软 PWM               用定时器中断 + GPIO 手动翻转 → 占 CPU，抖动大
├── 硬 PWM               定时器硬件自动比较输出（PWM0 模式）→ 不占 CPU，精确
├── 通道配置             timer_oc_parameter_struct：P 极 / N 极 / 极性 / 空闲电平
├── 呼吸灯               动态改 CCR 值 + 方向翻转
├── 蜂鸣器（定时器版）   中断里 gpio_bit_toggle 产生方波
├── 蜂鸣器（PWM 版）     频率 = 定时器时钟 / 分频 / 周期，占空比固定 50%
├── 音乐播放             音符表 + 拍长 + 非阻塞 wait_us + 中途停止标志
├── P/N 互补通道         高级定时器 TIMER0_CH0（PE8/PE9），必须开主输出
└── 三个必背公式         T = (PSC+1)(ARR+1)/Tclk、f = Tclk/((PSC+1)(ARR+1))、占空比 = CCR/(ARR+1)
```

## 学习目标

- 会算定时器时间：给定周期反推 PSC / ARR，或者给定 PSC / ARR 算出周期
- 说清楚「软 PWM」和「硬 PWM」的区别，以及为什么工程上必须选硬的
- 掌握 PWM 的通道配置全流程（时钟 → GPIO 复用 → 定时器时基 → 输出通道 → 模式 → 占空比 → 使能）
- 理解 `CCR`（比较值）与 `ARR`（周期值）分别控制什么
- 会做「呼吸灯」这种需要动态改 CCR 的效果
- 看懂音乐播放的「音符表 + 拍长 + 非阻塞节拍」结构
- 知道高级定时器为什么必须额外调 `timer_primary_output_config()`

---

## 一、定时器是什么

一句话：**一个会自动数数的计数器**。数到设定的值就产生一个事件（中断 / 翻转引脚 / 输出波形）。

### 1.1 三个核心部件

```
定时器时钟源 ──→ [预分频器 PSC] ──→ 计数器 CNT 加 1 ──→ 到达 [周期值 ARR]？
  168 MHz          降慢 N 倍         每来一个 tick 加 1        到了 → 溢出事件
```

| 部件 | 寄存器字段 | 作用 | 一句话记忆 |
| --- | --- | --- | --- |
| **时钟源** | — | 谁在给计数脉冲 | 心跳从哪来 |
| **预分频器 PSC** | `prescaler = N-1` | 把时钟降慢 N 倍 | **管快慢** |
| **周期值 ARR** | `period = M-1` | 数到 M 就溢出 | **管多久溢出** |

> **注意「写入时要减 1」**：PSC 和 period 都是「写到寄存器里的值」，实际分频/计数是 **加 1 之后**的数。写 `168-1` 表示分频 168 倍。**这是最容易算错的地方**。

### 1.2 GD32F4 的定时器家族（本工程用到的）

| 类型 | 定时器 | 本工程用途 |
| --- | --- | --- |
| **基本定时器** | TIMER5、TIMER6 | `4cec095` 1 秒中断；`698a2c6` 蜂鸣器软件方波。**没有输出通道，做不了 PWM** |
| **通用 L0**（4 通道） | TIMER1、TIMER2、TIMER3、TIMER4 | `1f76f67` TIMER1_CH2(PA2)；`f5cb7e3` TIMER3_CH0(PD12)；`b4f56b7` TIMER1_CH1(PB9) |
| **高级定时器**（4 通道 + 互补） | TIMER0、TIMER7 | `1678ba3` TIMER0_CH0 的 P/N 输出（PE9/PE8） |

**本工程引脚 → 定时器通道对照**（后面反复用到）：

| 引脚 | 定时器通道 | 复用 AF | 用到它的提交 |
| --- | --- | --- | --- |
| **PA2** | TIMER1_CH2 | `GPIO_AF_1` | `1f76f67` |
| **PB9** | **TIMER1_CH1** | **`GPIO_AF_1`** | `b4f56b7` 蜂鸣器 |
| PD12 | TIMER3_CH0 | `GPIO_AF_2` | `f5cb7e3` 呼吸灯 |
| PD13 / PD14 / PD15 | TIMER3_CH1 / CH2 / CH3 | `GPIO_AF_2` | 后续可用 |
| PE9 | TIMER0_CH0 | `GPIO_AF_1` | `1678ba3` |
| PE8 | TIMER0_CH0 **ON（互补/负极性）** | `GPIO_AF_1` | `1678ba3` |

> **做 PWM 的第一步永远是查这张表**：找到你要用的引脚 → 读出定时器和通道号 → 读出 AF 编号。**三个都要对**，错一个就是「引脚没波形」。
>
> 完整表见参考笔记 `TIMER.md` 第 2.3 节（14 个定时器 + 全部引脚）。

---

## 二、参数怎么算（本节全篇最重要）

### 2.1 时钟：先统一成 168 MHz

```c
// 时钟倍频(全局配置 所有定时器都是168Mhz)
rcu_timer_clock_prescaler_config(RCU_TIMER_PSC_MUL4);
```

这一行在 `main()` 开头，全工程只在**这一个地方**出现。作用是：**把定时器的计数时钟统一成和系统主频一样（168 MHz）**。

为什么要这么做？因为定时器挂在 APB 总线上，APB1 只有 42 MHz、APB2 是 84 MHz。如果不倍频，你每写一个定时器都得先查「它在 APB1 还是 APB2、频率多少」——**倍频的目的不是让定时器更快，而是消掉这份认知负担**：

```
倍频前：TIMER1 挂 APB1 → 42MHz    TIMER3 挂 APB1 → 42MHz    TIMER0 挂 APB2 → 84MHz   ← 要记三个数
倍频后：一律 168 MHz                                                              ← 只记一个数
```

### 2.2 三个必背公式

设 `Tclk` = 定时器时钟（本工程 168 MHz = 168000000 Hz）。

```
① 溢出周期（多长时间溢出一次，单位：秒）
       T = (PSC + 1) × (ARR + 1) / Tclk

② PWM 频率
       f = Tclk / ((PSC + 1) × (ARR + 1))            （就是 1/T）

③ 占空比
       占空比 = CCR / (ARR + 1)      →      CCR = (ARR + 1) × 占空比
```

**再记两个换算常数**（算 PSC 时用）：

```
168 MHz ÷ 16800 = 10 kHz    → 1 tick = 100 μs
168 MHz ÷ 1680  = 100 kHz   → 1 tick = 10 μs
168 MHz ÷ 168   = 1 MHz     → 1 tick = 1 μs     ← 蜂鸣器用的就是这个
```

### 2.3 实操：两种算法

**算法 A：先定 tick 长度，再定计数值**（本工程主要用这个）

```
目标：1 秒溢出一次
第一步：选 PSC，让 1 tick 尽量是个整数时间
        168000000 / 16800 = 10000  → 1 tick = 100us
        所以 PSC = 16800 - 1
第二步：算需要多少个 tick
        1 s ÷ 100us = 10000 ticks
        所以 ARR = 10000 - 1
```

**算法 B：直接用代码算**（更省事，不易错）

```c
#define PRESCALER 1680 - 1
#define PERIOD (SystemCoreClock / (PRESCALER + 1) / 1000) - 1
```

```
PRESCALER = 1680 - 1  → 分频 1680 → 168e6/1680 = 100 kHz → 1 tick = 10us
PERIOD = 168000000 / 1680 / 1000 - 1 = 100 - 1 = 99
       → 100 ticks × 10us = 1000 us = 1 ms
```

**这里隐含一个容易忽略的除法顺序**：`SystemCoreClock / (PRESCALER+1) / 1000` 先算出「每毫秒有几个 tick」，减 1 就是 ARR。**这个宏是「1 ms 周期」的固定配方，换个周期就改最后那个除数**：

```c
#define PERIOD (SystemCoreClock / (PRESCALER + 1) / 1000) - 1   // 1 ms
#define PERIOD (SystemCoreClock / (PRESCALER + 1) / 100)  - 1   // 10 ms
#define PERIOD (SystemCoreClock / (PRESCALER + 1) / 10)   - 1   // 100 ms
```

---

## 三、提交 `4cec095`：定时器中断（1 秒触发一次）

**提交信息**：`[更新] 普通定时器 TIMER5 每1s触发一次定时器中断`

这是「定时器」这条线的起点。它和老的学习笔记里 `TEMP` 章节不一样——这里是**裸写**在 `main.c` 里，还没有封装。

```c
// TIMER5 全局4倍频  168000000hz <=> 1s
// 预分频器 16800 => 10000hz <=> 1s
#define PRESCALER 16800 - 1
#define PERIOD 10000 - 1

void Timer5_config(void)
{
    // 1.打开外设时钟
    rcu_periph_clock_enable(RCU_TIMER5);

    // 2.初始化定时器
    timer_parameter_struct timer_init_struct;
    timer_struct_para_init(&timer_init_struct);
    timer_init_struct.prescaler = PRESCALER;               // 定时器时钟预分频
    timer_init_struct.alignedmode = TIMER_COUNTER_EDGE;    // 定时器计数模式
    timer_init_struct.counterdirection = TIMER_COUNTER_UP; // 定时器计数方向
    timer_init_struct.period = PERIOD;                     // 定时器周期
    timer_init_struct.clockdivision = TIMER_CKDIV_DIV1;    // 定时器时钟分频
    timer_init_struct.repetitioncounter = 0U;              // 定时器重复计数器

    timer_init(TIMER5, &timer_init_struct);
    // 3.配置中断
    nvic_irq_enable(TIMER5_DAC_IRQn, 2, 2);
    timer_interrupt_flag_clear(TIMER5, TIMER_INT_UP);
    timer_interrupt_enable(TIMER5, TIMER_INT_UP);
    // 4.使能定时器
    timer_enable(TIMER5);
}

void TIMER5_DAC_IRQHandler(void)
{
    if (timer_interrupt_flag_get(TIMER5, TIMER_INT_UP) == SET)
    {
        timer_interrupt_flag_clear(TIMER5, TIMER_INT_UP);

        printf("TIMER5\r\n");
    }
}
```

### 3.1 参数核对

| 项 | 值 | 验算 |
| --- | --- | --- |
| `PRESCALER` | 16800 - 1 | 168e6 ÷ 16800 = 10000 Hz → 1 tick = 100 μs |
| `PERIOD` | 10000 - 1 | 10000 ticks × 100 μs = **1 s** ✅ |

### 3.2 为什么中断函数叫 `TIMER5_DAC_IRQHandler`

这是本篇**特别值得记住的一个点**：

```
在 GD32F4 的中断向量表里，TIMER5 和 TIMER6 是「基本定时器」，
它们没有独立的中断向量，而是和 DAC 共用同一组：
        TIMER5 溢出中断  ┐
                        ├──→  共用一个向量：TIMER5_DAC_IRQHandler
        DAC 转换完成中断 ┘
```

所以：

| 定时器 | 中断函数名 |
| --- | --- |
| TIMER5 / TIMER6 | **`TIMER5_DAC_IRQHandler`** |
| TIMER0 | `TIMER0_UP_TIMER9_IRQHandler`（升级与 TIMER9 共用） |
| TIMER1 | `TIMER1_IRQHandler` |
| TIMER3 | `TIMER3_IRQHandler` |

**结论：不要凭直觉写中断函数名，一定要去启动文件或《用户手册》中断向量表里查**。写成 `TIMER5_IRQHandler` 编译不会报错，但中断永远不进。

### 3.3 结构与后续复用

`timer_parameter_struct` 有 6 个字段，但**只有 2 个是每次都要改的**：

| 字段 | 本工程取值 | 要不要管 |
| --- | --- | --- |
| `prescaler` | `PRESCALER` | ✅ 核心 |
| `period` | `PERIOD` | ✅ 核心 |
| `alignedmode` | `TIMER_COUNTER_EDGE`（边沿对齐） | 一般默认 |
| `counterdirection` | `TIMER_COUNTER_UP`（向上计数） | 一般默认 |
| `clockdivision` | `TIMER_CKDIV_DIV1` | 一般默认（只影响采样，不影响计数） |
| `repetitioncounter` | `0` | 高级定时器才用 |

`timer_struct_para_init(&timer_init_struct)` 先给结构体填一套默认值，**再改你要改的**——这个套路（init 先填默认）在整个标准外设库反复出现，值得记住。

**注意 `main.c` 里这一行**：

```c
    // TIMER5初始化
    // Timer5_config();          ← 被注释掉了
```

作者跑通验证之后把调用注释掉了（因为它只是验证定时器能触发中断），**这就是「代码里为什么会有注释掉的初始化」的原因**——不是忘了删，是留着待用。

---

## 四、提交 `a2eeece`：软 PWM（用中断+GPIO 手动翻转）

**提交信息**：`[更新] PWM软实现 周期1ms 占空比20%`

想法很直接：**既然 PWM 就是「按比例地高电平+低电平」，那我用定时器中断在固定时间点手动拉高拉低不就行了？**

```c
#define PRESCALER 1680 - 1
#define PERIOD 20 - 1

void PA2_GPIO_config(void)
{
    rcu_periph_clock_enable(RCU_GPIOA);
    gpio_mode_set(GPIOA, GPIO_MODE_OUTPUT, GPIO_PUPD_NONE, GPIO_PIN_2);      // ← 普通输出
    gpio_output_options_set(GPIOA, GPIO_OTYPE_PP, GPIO_OSPEED_2MHZ, GPIO_PIN_2);
}

uint8_t cnt = 0;
void TIMER5_DAC_IRQHandler(void)
{
    if (timer_interrupt_flag_get(TIMER5, TIMER_INT_UP) == SET)
    {
        timer_interrupt_flag_clear(TIMER5, TIMER_INT_UP);

        if (cnt == 0)
        {
            gpio_bit_set(GPIOA, GPIO_PIN_2);      // 高电平
            printf("1\n");
        }
        else
        {
            gpio_bit_reset(GPIOA, GPIO_PIN_2);    // 低电平
            printf("0\n");
        }
        cnt = (cnt + 1) % 5;                      // 5 个 tick 一轮
    }
}
```

### 4.1 数学核对

| 项 | 值 | 验算 |
| --- | --- | --- |
| `PRESCALER` | 1680 - 1 | 168e6 ÷ 1680 = 100 kHz → **1 tick = 10 μs** |
| `PERIOD` | 20 - 1 | 20 ticks × 10 μs = **200 μs**（中断周期） |
| `cnt` 循环 | `% 5` | 5 个 tick 一轮：1 高 + 4 低 = **20% 占空比** ✅ |

**⚠️ 这里有一处和注释对不上的地方，必须自己复核**：

```
注释写的是：// PWM 周期1ms 占空比20% 0.2ms
            // 100000hz <=> 1s
            // 100hz <=> 1ms        ← 100 个 tick 才是 1ms
            // 20hz <=> 0.2ms        ← 20 个 tick 是 0.2ms

但代码里 ARR 取的是 20 - 1（= 20 个 tick = 0.2ms），不是 100 - 1（= 1ms）
```

**按代码实际算出来的是「周期 200 μs、占空比 20%」的 PWM（5 kHz）**。想得到「1 ms 周期」应该写 `PERIOD 100 - 1`。

> **这个细节的价值在于**：定时器的参数是「算出来的」，不是「看起来差不多就行」。**写完一定回来代入公式验一遍**——否则现象是「灯能亮，但亮度/频率不对」，而这类错误很难靠肉眼发现（200 μs 和 1 ms 在 LED 上都只是「有点暗」）。

### 4.2 软 PWM 的四个硬伤

| 硬伤 | 说明 |
| --- | --- |
| **占 CPU** | 200 μs 一次中断，每秒 5000 次中断，每次都要压栈出栈 + 判断 + 写 GPIO |
| **抖动大** | 中断被高优先级中断插队，输出时间点就会漂移；`printf` 在中断里更是灾难 |
| **中断里打印** | 这里居然在中断里 `printf("1\n")`——**串口发送是阻塞的**（第 04 篇 5.5 节），100 字节要塞 8.7 ms，早把定时精度毁光了 |
| **占中断资源** | 一个定时器只能做一路 PWM；要做 4 路就要 4 个定时器 |

> **这就是「软 PWM」**：**能用，但代价巨大**。它的唯一价值是让你理解 PWM 的本质，以及明白为什么硬件要提供 PWM 外设。

---

## 五、提交 `1f76f67`：硬 PWM（定时器硬件自动输出）

**提交信息**：`[更新] PWM硬实现 周期1ms 占空比50%`

**从「软件数数+写 GPIO」变成「硬件自动比较输出」**，这是本模块的关键一跃。

### 5.1 硬件 PWM 的原理

定时器内部有两个数：**计数器 CNT**（一直在数）和 **比较值 CCR**（你设定）。硬件每个 tick 比较一次：

```
CNT 从 0 往上数（PWM0 模式，高电平有效）：

   CNT <  CCR   →  引脚输出【高】
   CNT >= CCR   →  引脚输出【低】
   CNT 数到 ARR →  回到 0，重新开始

        高电平：|████████|
        低电平：|        |████████████████|
                0      CCR                  ARR
                |←高→|←───── 低 ─────→|
                |←────── 一个周期 ──────→|
```

**由此得出两个结论**（这是整章的核心）：

| 你改什么 | 得到什么 |
| --- | --- |
| 改 `CCR`（`timer_channel_output_pulse_value_config`） | 改**占空比** |
| 改 `ARR`（`period`） | 改**频率** |

### 5.2 和软 PWM 的三处代码差异

```c
void PA2_GPIO_config(void)
{
    rcu_periph_clock_enable(RCU_GPIOA);
    gpio_mode_set(GPIOA, GPIO_MODE_AF, GPIO_PUPD_NONE, GPIO_PIN_2);   // ← 差异①：复用模式
    gpio_af_set(GPIOA, GPIO_AF_1, GPIO_PIN_2);                        //    (PA2 = TIMER1_CH2/AF1)
}

void Timer1_config(void)
{
    rcu_periph_clock_enable(RCU_TIMER1);
    timer_parameter_struct timer_init_struct;
    timer_struct_para_init(&timer_init_struct);
    timer_init_struct.prescaler = PRESCALER;
    timer_init_struct.period = PERIOD;
    timer_init(TIMER1, &timer_init_struct);

    // 3.配置PWM输出通道
    timer_oc_parameter_struct ocpara;
    timer_channel_output_struct_para_init(&ocpara);
    // 通道P
    ocpara.outputstate = (uint16_t)TIMER_CCX_ENABLE;    // 打开通道输出
    ocpara.ocpolarity = TIMER_OC_POLARITY_HIGH;         // 高电平有效
    ocpara.ocidlestate = TIMER_OC_IDLE_STATE_LOW;       // 空闲时输出低
    // 通道N
    ocpara.outputnstate = TIMER_CCXN_DISABLE;           // 不用互补通道，关掉
    ocpara.ocnpolarity = TIMER_OCN_POLARITY_HIGH;
    ocpara.ocnidlestate = TIMER_OCN_IDLE_STATE_LOW;
    timer_channel_output_config(TIMER1, TIMER_CH_2, &ocpara);         // ← 差异②：通道输出配置
    // 4.输出模式配置
    timer_channel_output_mode_config(TIMER1, TIMER_CH_2, TIMER_OC_MODE_PWM0);   // ← 差异③：PWM0 模式
    // 5.设置占空比
    timer_channel_output_pulse_value_config(TIMER1, TIMER_CH_2, (PERIOD + 1) * 0.5);  // 50%

    // 6.使能定时器
    timer_enable(TIMER1);
}
```

**三处差异对照表**：

| | 软 PWM | 硬 PWM |
| --- | --- | --- |
| GPIO 模式 | `GPIO_MODE_OUTPUT` | **`GPIO_MODE_AF` + `gpio_af_set`**（交给定时器接管） |
| 输出通道 | 无 | **`timer_channel_output_config()`** |
| 输出模式 | 无 | **`TIMER_OC_MODE_PWM0`** |
| 谁在翻转引脚 | **中断里的代码** | **硬件** |
| 占 CPU | 高 | **几乎为零** |
| 精度 | 受中断延迟影响 | 硬件级，不受软件影响 |

### 5.3 `ocpara` 六个字段逐个说清

```c
timer_oc_parameter_struct ocpara;
timer_channel_output_struct_para_init(&ocpara);
```

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| `outputstate` | `TIMER_CCX_ENABLE` | **P 极（正向）通道**输出开关。**关掉它就没有任何波形** |
| `ocpolarity` | `TIMER_OC_POLARITY_HIGH` | P 极极性：有效电平是高 |
| `ocidlestate` | `TIMER_OC_IDLE_STATE_LOW` | 定时器停止时引脚保持低电平 |
| `outputnstate` | `TIMER_CCXN_DISABLE` | **N 极（互补）通道**开关。不用就 DISABLE |
| `ocnpolarity` | `TIMER_OCN_POLARITY_HIGH` | N 极极性 |
| `ocnidlestate` | `TIMER_OCN_IDLE_STATE_LOW` | N 极空闲电平 |

**「P 极 / N 极」是什么？** 高级定时器的每个通道能输出**一对互补信号**（一个高时另一个低），用于驱动 H 桥这种需要上下管的电路。本提交只用 P 极，N 极关掉；第八章的 `1678ba3` 两个都用。

**`TIMER_OC_MODE_PWM0` vs `PWM1`**：

| 模式 | 行为 |
| --- | --- |
| **`PWM0`** | `CNT < CCR` 时输出**高**（本工程用） |
| `PWM1` | `CNT < CCR` 时输出**低**（正好相反） |

**没有绝对的对错，只有和电路是否匹配**。

### 5.4 参数核对

| 项 | 值 | 验算 |
| --- | --- | --- |
| `PRESCALER` | 1680 - 1 | 168e6 ÷ 1680 = 100 kHz → 1 tick = 10 μs |
| `PERIOD` | `SystemCoreClock/(1680)/1000 - 1` = 99 | 100 ticks × 10 μs = **1 ms** ✅ |
| `CCR` | `(99+1) × 0.5` = 50 | 占空比 = 50/100 = **50%** ✅ |

---

## 六、提交 `f5cb7e3`：呼吸灯（动态改 CCR）

**提交信息**：`[更新] PWM硬实现 呼吸灯`

呼吸灯 = **让占空比来回跑**。硬件 PWM 每 1 ms 一个周期，软件只要「每 10 ms 改一次 CCR」就够了。

```c
// PA02 TIMER1 CH2
// PD12 TIMER3 CH0
// PD13 TIMER3 CH1
// PD14 TIMER3 CH2
// PD15 TIMER3 CH3

void Timer3_config(void)
{
    // ... 时基配置同上（PSC/ARR 相同）
    timer_channel_output_config(TIMER3, TIMER_CH_0, &ocpara);
    timer_channel_output_mode_config(TIMER3, TIMER_CH_0, TIMER_OC_MODE_PWM0);
    timer_channel_output_pulse_value_config(TIMER3, TIMER_CH_0, (PERIOD + 1) * 0.5);
    timer_enable(TIMER3);
}

void PD12_GPIO_config(void)
{
    rcu_periph_clock_enable(RCU_GPIOD);
    gpio_mode_set(GPIOD, GPIO_MODE_AF, GPIO_PUPD_NONE, GPIO_PIN_12);
    gpio_af_set(GPIOD, GPIO_AF_2, GPIO_PIN_12);       // PD12 = TIMER3_CH0 / AF2
}
```

```c
    int duty_percent = 100; // 当前占空比，单位 %
    int step = -1;          // 每次变化 1%

    while (1)
    {
        // 计算比较值：CCR = (ARR+1) * duty% / 100
        uint16_t ccr = (uint16_t)(((uint32_t)(PERIOD + 1) * duty_percent) / 100);
        timer_channel_output_pulse_value_config(TIMER3, TIMER_CH_0, ccr);

        delay_1ms(10); // 每 10ms 变一次，90 步约 0.9 秒一个来回

        duty_percent += step;

        if (duty_percent <= 10)
        {
            duty_percent = 10;
            step = 1; // 到达 10% 后反向增加
        }
        else if (duty_percent >= 100)
        {
            duty_percent = 100;
            step = -1; // 到达 100% 后反向减少
        }
    }
```

### 6.1 三个值得学的细节

| 细节 | 说明 |
| --- | --- |
| **`uint32_t` 强制转换** | `(PERIOD+1) * duty_percent` 最大 100×100=10000，`uint16_t` 其实够。但**乘法的中间结果用更宽的类型是防御性写法**——`ARR` 一大就真会溢出 |
| **`step` 变量实现往返** | 用一个 `+1 / -1` 的步长代替写两段循环，是「往返运动」的标准写法 |
| **下限取 10% 而不是 0%** | 0% 灯就完全灭了，呼吸效果会「断」一下；留 10% 底亮度看起来更自然 |

### 6.2 这一版的代价：主循环被 `delay_1ms(10)` 占住

```c
while (1)
{
    ...改 CCR...
    delay_1ms(10);        // ← 阻塞 10ms
}
```

和第 05 篇的充电流水灯是同一个毛病：**主循环里一旦有阻塞延时，按键扫描、其他任务全都停摆**。

**正确改法**（后面 `digital_led` 分支用上了）：把 `delay_1ms(10)` 换成时间戳比较：

```c
static uint64_t last_cnt = 0;
uint64_t cnt = get_us_cnt();
if (cnt - last_cnt >= 10000)      // 10 ms
{
    last_cnt = cnt;
    duty_percent += step;
    ...
}
```

> **同一个坑，本工程踩了两次**（流水灯一次、呼吸灯一次）——说明「阻塞式写法」是学习期最容易养成的坏习惯。**看到 `delay_1ms()` 在 `while(1)` 里，就要条件反射地想「这里能不能改成读时间戳」。**

### 6.3 通道号写错也没关系吗？

代码里有一段挺有意思：

```c
timer_channel_output_config(TIMER3, TIMER_CH_0, &ocpara);
timer_channel_output_mode_config(TIMER3, TIMER_CH_0, TIMER_OC_MODE_PWM0);
timer_channel_output_pulse_value_config(TIMER3, TIMER_CH_0, (PERIOD + 1) * 0.5);
timer_enable(TIMER3);
```

**只配了 CH0（PD12）**，而注释里列了 PD12~PD15 四个通道的对应关系——**那是查表备忘，不是配置了四个通道**。真正配 4 通道的写法在参考笔记 `TIMER.md` 第六章（`TIMER3` 四通道 → LED5~LED8）。

---

## 七、提交 `698a2c6` / `ef6a015` / `b4f56b7` / `298f9db`：蜂鸣器四连击

蜂鸣器这条线**连做四次提交才真正做对**，中间那次「翻车」特别值得看。

### 7.1 `698a2c6`：用中断翻转引脚（软件方波）

**提交信息**：`[更新] 定时器 蜂鸣器 固定频率鸣叫`

```c
void BUZZER_GPIO_config(void)
{
    rcu_periph_clock_enable(RCU_GPIOB);
    gpio_mode_set(GPIOB, GPIO_MODE_OUTPUT, GPIO_PUPD_NONE, GPIO_PIN_9);    // 普通输出
    gpio_output_options_set(GPIOB, GPIO_OTYPE_PP, GPIO_OSPEED_2MHZ, GPIO_PIN_9);
}

void Timer5_config(void)
{
    // ...
    timer_init_struct.prescaler = 1680 - 1;   // 100 kHz → 1 tick = 10us
    timer_init_struct.period = 100 - 1;       // 100 ticks × 10us = 1 ms
    // ...
    timer_enable(TIMER5);
}

void TIMER5_DAC_IRQHandler(void)
{
    if (timer_interrupt_flag_get(TIMER5, TIMER_INT_UP) == SET)
    {
        timer_interrupt_flag_clear(TIMER5, TIMER_INT_UP);

        gpio_bit_toggle(GPIOB, GPIO_PIN_9);   // 每 1ms 翻转一次引脚
        printf("TIMER5\r\n");
    }
}
```

**算一下实际发声频率**：

```
每 1 ms 翻转一次 → 一个完整方波需要两次翻转 → 周期 = 2 ms
频率 = 1 / 2ms = 500 Hz     ← 人耳能听到的「嘟」声
```

**这又是软 PWM 的老问题**：定时器中断里翻转引脚。**能做，但占 CPU、有抖动，而且只能做一个固定频率**。想放音乐（要不断变频）就更难了。

> 另外注意 `printf("TIMER5\r\n")` **还在中断里**——1 ms 一次的中断里打印 8 个字符（≈0.7 ms 阻塞），几乎把 CPU 全吃掉了。**这类「调试打印忘了删」的问题，最后往往表现成「现象莫名其妙」，一定要警惕。**

### 7.2 `ef6a015`：改用 PWM 驱动 —— ⚠️ 这里是本工程最典型的一次「翻车」

**提交信息**：`[更新] PWM 蜂鸣器 固定频率鸣叫`

思路正确：**蜂鸣器应该用硬件 PWM 驱动，而不是中断翻转**（因为蜂鸣器要的是特定频率的方波）。改法是把 PB9 从普通输出改成复用输出，并配上 PWM 通道：

```c
void BUZZER_GPIO_config(void)
{
    rcu_periph_clock_enable(RCU_GPIOB);
    gpio_mode_set(GPIOB, GPIO_MODE_AF, GPIO_PUPD_NONE, GPIO_PIN_9);
    gpio_af_set(GPIOB, GPIO_AF_2, GPIO_PIN_9);         // ← ❌ 问题在这
}
```

**但 `Timer1_config()` 用的还是旧的 `TIMER_CH_2`**（那是给 PA2 用的通道）：

```c
timer_channel_output_config(TIMER1, TIMER_CH_2, &ocpara);      // CH2 对应 PA2，不是 PB9！
timer_channel_output_mode_config(TIMER1, TIMER_CH_2, TIMER_OC_MODE_PWM0);
timer_channel_output_pulse_value_config(TIMER1, TIMER_CH_2, (PERIOD + 1) * 0.5);
```

**两个错误叠加**：

| 错误 | 应该是 | 写成了 |
| --- | --- | --- |
| AF 编号 | PB9 = TIMER1_CH1 → **AF1** | `GPIO_AF_2` |
| 通道号 | PB9 = **TIMER1_CH1** | `TIMER_CH_2`（那是 PA2 的） |

**结果：PB9 上永远不会有波形**——AF 选错了，引脚根本没连到定时器；就算连上了，波形也从 CH2(PA2) 出去了。

> **这个坑的教训**：**引脚 → 定时器 / 通道 / AF 这三件事必须成套核对**。三者是一个「三件套」，改引脚就必须三样一起改。查表在参考笔记 `TIMER.md` 第 2.3 节。

### 7.3 `b4f56b7`：封装成 `bsp_buzzer`（顺便改对）

**提交信息**：`[更新] PWM 蜂鸣器 封装`（新建 `Driver/bsp_buzzer/`）

这次提交**同时做对了两件事**：修掉 AF/通道的错，并把蜂鸣器抽成一整个驱动。

```c
// TIMER1 全局4倍频  168000000hz <=> 1s
// 预分频器 168 => 1000000hz <=> 1s
#define PRESCALER (168 - 1)
timer_oc_parameter_struct ocpara;
timer_parameter_struct timer_init_struct;

// PB09  TIMER1_CH1  AF1
void Buzzer_GPIO_config(void)
{
    rcu_periph_clock_enable(RCU_GPIOB);
    gpio_mode_set(GPIOB, GPIO_MODE_AF, GPIO_PUPD_NONE, GPIO_PIN_9);
    gpio_af_set(GPIOB, GPIO_AF_1, GPIO_PIN_9);            // ✅ AF1
}

static void Timer1_config(void)
{
    rcu_periph_clock_enable(RCU_TIMER1);
    timer_struct_para_init(&timer_init_struct);
    timer_init_struct.prescaler = PRESCALER;              // 168 → 1 MHz (1us/tick)
    timer_init_struct.period = 0;                         // 先给 0，播放时再算
    timer_init(TIMER1, &timer_init_struct);

    timer_channel_output_struct_para_init(&ocpara);
    ocpara.outputstate = (uint16_t)TIMER_CCX_ENABLE;
    ocpara.ocpolarity = TIMER_OC_POLARITY_HIGH;
    ocpara.ocidlestate = TIMER_OC_IDLE_STATE_LOW;
    timer_channel_output_config(TIMER1, TIMER_CH_1, &ocpara);        // ✅ CH1
    timer_channel_output_mode_config(TIMER1, TIMER_CH_1, TIMER_OC_MODE_PWM0);
    timer_channel_output_pulse_value_config(TIMER1, TIMER_CH_1, 0);

    timer_enable(TIMER1);
}
```

**为什么 PSC 改成 `168 - 1`（1 MHz）？** 因为蜂鸣器要覆盖 20 Hz ~ 20 kHz：

```
1 MHz ÷ 20000 Hz = 50    → ARR = 49     （高频）
1 MHz ÷ 20 Hz    = 50000 → ARR = 49999  （低频）
```

**1 MHz 的 tick（1 μs）刚好让整个可听频段都能用 16 位 ARR 表示**：

```c
// 播放特定频率声音 20~20000hz
void bsp_buzzer_play(uint16_t hz)
{
    // 周期
    uint16_t period = (SystemCoreClock / (PRESCALER + 1) / hz) - 1;
    // 占空比
    uint16_t duty = (period + 1) * 0.5;

    // 设置周期
    timer_init_struct.period = period;
    timer_init(TIMER1, &timer_init_struct);

    // 打开通道输出
    ocpara.outputstate = (uint16_t)TIMER_CCX_ENABLE;
    timer_channel_output_config(TIMER1, TIMER_CH_1, &ocpara);

    // 设置占空比
    timer_channel_output_pulse_value_config(TIMER1, TIMER_CH_1, duty);
}

// 停止播放
void bsp_buzzer_stop(void)
{
    // 关闭通道输出
    ocpara.outputstate = (uint16_t)TIMER_CCX_DISABLE;
    timer_channel_output_config(TIMER1, TIMER_CH_1, &ocpara);
}
```

**逐行解读**：

| 代码 | 说明 |
| --- | --- |
| `period = (168000000/168/hz) - 1` = `1000000/hz - 1` | 由 `f = Tclk/((PSC+1)(ARR+1))` 反推 ARR。**这就是「给定频率算 ARR」的标准写法** |
| `duty = (period+1) * 0.5` | 固定 50% 占空比。蜂鸣器要的是方波，占空比通常固定 |
| **动态改 `period` 后要重新 `timer_init()`** | 改 ARR 必须重写定时器（库函数没有单独的 `set_period`），所以这里调了一次 `timer_init` |
| **`bsp_buzzer_stop()` 用「关通道输出」而不是「关定时器」** | 关通道输出 → 引脚回到空闲电平（这里是低），**定时器还在跑**；下次 `play()` 立刻能出声。比反复 `timer_disable/enable` 更干净 |

> **一个真实的边界问题**：`period` 是 `uint16_t`，最大 65535。`1000000/hz - 1 ≤ 65535` 要求 `hz ≥ 15.3 Hz`——**低于约 15 Hz 会溢出算错**。函数注释写的是「20~20000hz」，正好在安全范围内。
>
> 另外 `ocpara` / `timer_init_struct` 是**非 static 全局变量**（文件名之外也可见），严格说应该加 `static` 收窄作用域——这是个可以自己动手改的小瑕疵。

### 7.4 `298f9db`：播《小星星》

**提交信息**：`[更新] PWM 蜂鸣器 小星星`

这一版的亮点是**「乐曲数据 + 节拍逻辑」两层分离**。

**第一层：音符频率表**

```c
// ---------- 音名频率（C 大调，单位 Hz） ---------- */
#define NOTE_REST 0
#define NOTE_DO 524
#define NOTE_RE 588
#define NOTE_MI 660
#define NOTE_FA 698
#define NOTE_SOL 784
#define NOTE_LA 880
#define NOTE_SI 988
#define NOTE_DO_H 1048 // 高音 do
```

**第二层：音符结构体 + 简谱数组**

```c
/* ---------- 节拍 ---------- */
// 120 BPM：一拍 = 60/120 = 0.5s = 500000us
#define BEAT_US 500000u
// 音符之间留的间隔，避免连音
#define NOTE_GAP_US 20000u

/* ---------- 音符结构 ---------- */
typedef struct
{
    uint16_t freq; // 频率，NOTE_REST 表示休止
    uint8_t beats; // 拍数：1=四分音符，2=二分音符
} note_t;

static const note_t little_star[] = {
    // 1 1 5 5 6 6 5 -
    {NOTE_DO, 1},
    {NOTE_DO, 1},
    {NOTE_SOL, 1},
    {NOTE_SOL, 1},
    {NOTE_LA, 1},
    {NOTE_LA, 1},
    {NOTE_SOL, 2},          // 二分音符：2 拍
    ...
};

#define LITTLE_STAR_LEN (sizeof(little_star) / sizeof(little_star[0]))
```

**「数据即代码」的一个好示范**：把简谱直接写成数组，改曲子只改数据，**播放逻辑一行不动**：

```c
void bsp_buzzer_play_little_star(void)
{
    song_stop_flag = 0;

    for (uint32_t i = 0; i < LITTLE_STAR_LEN; i++)
    {
        if (song_stop_flag)                   // 支持中途停止
            break;

        uint16_t freq = little_star[i].freq;
        uint32_t beats = little_star[i].beats;
        uint64_t dur_us = (uint64_t)BEAT_US * beats;    // 时长 = 单位拍 × 拍数

        if (freq == NOTE_REST)
        {
            bsp_buzzer_stop();                // 休止符：不发声
            wait_us(dur_us);
        }
        else
        {
            bsp_buzzer_play(freq);            // 发这个音
            wait_us(dur_us);
            bsp_buzzer_stop();                // 音符间留缝，避免连音
            wait_us(NOTE_GAP_US);
        }
    }

    bsp_buzzer_stop();
}
```

**节拍系统的三个概念**：

| 概念 | 值 | 含义 |
| --- | --- | --- |
| `BEAT_US` | 500000 μs | 一拍的长度（= 120 BPM 下的四分音符） |
| `beats` | 1 或 2 | 这个音符占几拍 |
| `NOTE_GAP_US` | 20000 μs | 音符之间的静音间隔，**没有它相邻同音高的音符会连成一个长音** |

**自定义的可中断等待**（这次提交的技术亮点）：

```c
/* ---------- 全局停止标志 ---------- */
static volatile uint8_t song_stop_flag = 0;

static void wait_us(uint64_t us)
{
    uint64_t start = get_us_cnt();
    while ((get_us_cnt() - start) < us)
    {
        if (song_stop_flag)
            return; // 支持中途停止
    }
}

/* ---------- 中途停止 ---------- */
void bsp_buzzer_stop_song(void)
{
    song_stop_flag = 1;
    bsp_buzzer_stop();
}
```

**为什么不用 `delay_1ms()`？** 因为 `delay_1ms()` 是「死等」，**外面想让它停下来都没有机会**：

| | `delay_1ms()` | `wait_us()` + 停止标志 |
| --- | --- | --- |
| 等待期间能被打断吗 | 不能 | **能**（每轮检查一次标志） |
| 实现手段 | 依赖 `delay` 全局变量 | `get_us_cnt()` 时间戳比较 |
| 语义 | 「睡 X 毫秒」 | 「等到时刻 T，除非有人叫我停」 |

**`song_stop_flag` 必须是 `volatile`**：它在主循环里被读、在 `bsp_buzzer_stop_song()` 里被写，编译器可能把 `while` 里的读取优化掉。

> `wait_us()` 依然是**阻塞**的（整首歌要占好几秒），但它是「**可被打断的阻塞**」——这是一个很实用的中间方案。想彻底不阻塞，得把播放也做成状态机（像第 05 篇那样，每次 `process()` 播一个音符）。

**应用层怎么用**（`main.c` 最终形态，被注释保留）：

```c
    // // 蜂鸣器测试
    // delay_1ms(1000);
    // bsp_buzzer_play(500);
    // delay_1ms(1000);
    // bsp_buzzer_play(1000);
    //
    // // 停止
    // delay_1ms(1000);
    // bsp_buzzer_stop();
    // delay_1ms(1000);
    // bsp_buzzer_play(2000);
    // delay_1ms(1000);
    // bsp_buzzer_stop();
```

**同时 `main.c` 里加了这两行**（调试时钟配置是否生效的实用技巧）：

```c
    printf("SystemCoreClock = %u\r\n", (unsigned int)SystemCoreClock);
    printf("RCU_CFG1 = 0x%08X\r\n", RCU_CFG1);
```

`RCU_CFG1` 是时钟配置寄存器，**打印出来就能确认倍频有没有生效**——比在代码里猜快得多。

---

## 八、提交 `1678ba3`：P/N 互补双通道（高级定时器）

**提交信息**：`[更新] PWM P N 双通道`

到这一步，PWM 已经用得很熟了。这次上了一个新台阶：**用高级定时器 TIMER0 输出一对互补信号**。

```c
void Timer0_config(void)
{
    // 1.打开外设时钟
    rcu_periph_clock_enable(RCU_TIMER0);

    // 2.初始化定时器
    timer_parameter_struct timer_init_struct;
    timer_struct_para_init(&timer_init_struct);
    timer_init_struct.prescaler = PRESCALER;
    timer_init_struct.period = PERIOD;

    timer_init(TIMER0, &timer_init_struct);

    // 3.配置PWM输出通道
    timer_oc_parameter_struct ocpara;
    timer_channel_output_struct_para_init(&ocpara);

    ocpara.outputstate = (uint16_t)TIMER_CCX_ENABLE;      // P 极开
    ocpara.ocpolarity = TIMER_OC_POLARITY_HIGH;
    ocpara.ocidlestate = TIMER_OC_IDLE_STATE_LOW;

    ocpara.outputnstate = TIMER_CCXN_ENABLE;              // ← N 极也开（和上一版对比）
    ocpara.ocnpolarity = TIMER_OCN_POLARITY_HIGH;
    ocpara.ocnidlestate = TIMER_OCN_IDLE_STATE_LOW;

    timer_channel_output_config(TIMER0, TIMER_CH_0, &ocpara);

    // 4.输出模式配置
    timer_channel_output_mode_config(TIMER0, TIMER_CH_0, TIMER_OC_MODE_PWM0);
    // 5.设置占空比
    timer_channel_output_pulse_value_config(TIMER0, TIMER_CH_0, (PERIOD + 1) * 0.5);
    // 6.使能定时器
    timer_primary_output_config(TIMER0, ENABLE);          // ← 高级定时器必须加这一行
    timer_enable(TIMER0);
}

void PE89_GPIO_config(void)
{
    rcu_periph_clock_enable(RCU_GPIOE);
    gpio_mode_set(GPIOE, GPIO_MODE_AF, GPIO_PUPD_NONE, GPIO_PIN_8 | GPIO_PIN_9);
    gpio_af_set(GPIOE, GPIO_AF_1, GPIO_PIN_8 | GPIO_PIN_9);   // PE8/PE9 = TIMER0_CH0 / AF1
}
```

### 8.1 高级定时器的三个「额外」

| 额外的东西 | 为什么 |
| --- | --- |
| `outputnstate = TIMER_CCXN_ENABLE` | TIMER0 才有的**互补（负极性）输出**，P 与 N 天生反相 |
| **`timer_primary_output_config(TIMER0, ENABLE)`** | 高级定时器有一个「主输出开关」（BDTR 寄存器里的 MOE 位），**不开这个开关，P 和 N 一个波形都没有** |
| `GPIO_PIN_8 \| GPIO_PIN_9` 一次配两个引脚 | P 和 N 成对出现，代码里也成对配 |

**`timer_primary_output_config()` 是高级定时器最容易漏的一步**——它的设计初衷是安全（配合刹车信号 BRKIN，出故障时一键关掉所有输出），但代价就是「忘了开就没输出」。**只配 TIMER0 / TIMER7 时需要它，TIMER1/TIMER3 之类的通用定时器不需要。**

### 8.2 N 极输出长什么样

```
P 极（PE9）:  ┌──────┐          ┌──────┐
              │  50% │          │      │
          ────┘      └──────────┘      └────

N 极（PE8）:  ────┐      ┌──────────┐      ┌───
                  │      │          │      │
                  └──────┘          └──────┘
                 ↑ 和 P 极完全反相（互补）
```

**为什么需要互补输出？** 驱动 H 桥 / 半桥时，上下两个管子必须「一个开另一个必关」（否则直接短路）。硬件互补 + 死区时间（dead time）就是为这个场景设计的。

### 8.3 P/N 的引脚对应关系

| 通道 | 正向 P | 互补 N |
| --- | --- | --- |
| TIMER0_CH0 | **PE9**（也是 PA8/PB13/PA7 等） | **PE8**（`ON`：负极性） |

> 参考笔记里的引脚表用 `ON` 后缀标出「这个引脚属于互补输出」，比如 `PA7 ON、PA8`。**名字后面带 ON 的，配置时要打开 N 极通道。** 完整表见 `TIMER.md` 2.3 节。

---

## 九、最终代码速查

### 9.1 蜂鸣器驱动（`Driver/bsp_buzzer/`）

```c
// --- bsp_buzzer.h ---
void bsp_buzzer_init(void);                 // 初始化：PB9 + TIMER1_CH1 + AF1
void bsp_buzzer_play(uint16_t hz);          // 播放指定频率（20~20000 Hz）
void bsp_buzzer_stop(void);                 // 停止（关通道输出，定时器继续跑）
void bsp_buzzer_play_little_star(void);     // 播放《小星星》
void bsp_buzzer_stop_song(void);            // 中途停止播放
```

| 参数 | 值 |
| --- | --- |
| 引脚 | PB9（TIMER1_CH1 / `GPIO_AF_1`） |
| 定时器时钟 | 168 MHz（`RCU_TIMER_PSC_MUL4`） |
| PSC | 168 - 1（→ 1 MHz，1 μs/tick） |
| ARR | `1000000/hz - 1`（动态） |
| CCR | `(ARR+1) × 0.5`（固定 50%） |
| 输出模式 | `TIMER_OC_MODE_PWM0`，P 极有效 |

### 9.2 定时器与 PWM 通用流程（七步）

```c
① rcu_periph_clock_enable(RCU_TIMERx);                        // 定时器时钟
② timer_struct_para_init(&s); s.prescaler = PSC; s.period = ARR;
   timer_init(TIMERx, &s);                                     // 时基
③ gpio_mode_set(port, GPIO_MODE_AF, ...); gpio_af_set(...);    // 引脚复用（PWM 必须）
④ timer_channel_output_struct_para_init(&oc);
   oc.outputstate = TIMER_CCX_ENABLE; ...                      // 通道输出配置
   timer_channel_output_config(TIMERx, TIMER_CH_n, &oc);
⑤ timer_channel_output_mode_config(TIMERx, TIMER_CH_n, TIMER_OC_MODE_PWM0);
⑥ timer_channel_output_pulse_value_config(TIMERx, TIMER_CH_n, CCR);   // 占空比
⑦ timer_primary_output_config(TIMERx, ENABLE);  // 仅高级定时器 TIMER0/TIMER7
   timer_enable(TIMERx);
```

### 9.3 参数速查表

| 场景 | PSC | ARR | 结果 |
| --- | --- | --- | --- |
| 1 秒定时中断（TIMER5） | 16800 - 1 | 10000 - 1 | 100 μs × 10000 = 1 s |
| 软 PWM（TIMER5） | 1680 - 1 | 20 - 1 | 10 μs × 20 = 200 μs，占空比 20% |
| 硬 PWM 1 ms（TIMER1_CH2 / TIMER3_CH0） | 1680 - 1 | 100 - 1 | 10 μs × 100 = 1 ms，占空比 50% |
| 呼吸灯（TIMER3_CH0 → PD12） | 1680 - 1 | 100 - 1 | 周期 10 ms 改一次 CCR，10%~100% 往返 |
| 蜂鸣器（TIMER1_CH1 → PB9） | 168 - 1 | `1000000/hz - 1` | 1 μs × N，占空比固定 50% |
| 蜂鸣器软件方波（TIMER5，已弃用） | 1680 - 1 | 100 - 1 | 1 ms 翻转 → 500 Hz |

### 9.4 中断函数名速查（血泪教训）

| 定时器 | 中断函数名 | 备注 |
| --- | --- | --- |
| TIMER5 / TIMER6 | **`TIMER5_DAC_IRQHandler`** | 和 DAC 共用向量！ |
| TIMER1 | `TIMER1_IRQHandler` | |
| TIMER3 | `TIMER3_IRQHandler` | |
| TIMER0 | `TIMER0_UP_TIMER9_IRQHandler` | 和 TIMER9 共用 |

---

## 十、排查清单

| 现象 | 优先检查 |
| --- | --- |
| 引脚完全没有波形 | ① GPIO 没配 `GPIO_MODE_AF`；② **AF 编号错**；③ **通道号错**；④ 高级定时器没开 `timer_primary_output_config()` |
| 频率不对（差整数倍） | PSC / ARR 算错，特别是忘了「写进去要减 1」 |
| 占空比不对 | `CCR` 与 `ARR` 的基准不统一：占空比 = `CCR / (ARR+1)`，**注意是 ARR+1** |
| 定时器中断完全不进 | 中断函数名写错（尤其 TIMER5 要叫 `TIMER5_DAC_IRQHandler`）；`timer_interrupt_enable()` 没调 |
| 中断只进一次 | 中断里没清标志：`timer_interrupt_flag_clear(TIMERx, TIMER_INT_UP)` |
| 定时时间偏大/偏小很多 | 忘了 `rcu_timer_clock_prescaler_config(RCU_TIMER_PSC_MUL4)`，或 `SystemCoreClock` 不是 168 M |
| 改了 `period` 后没生效 | 改 ARR 必须重新 `timer_init()`，库函数没有单独的 set 接口 |
| 蜂鸣器不响（但引脚有波形） | 音量太小/占空比不是 50%；或蜂鸣器是有源蜂鸣器（有源的直接通电就响，不需要 PWM） |
| 蜂鸣器只响一个频率 | 用了中断翻转引脚的老写法（`698a2c6`），换成 `bsp_buzzer_play(hz)` |
| 换引脚后蜂鸣器不响 | **引脚 / 通道 / AF 三件套没成套改**——就是 `ef6a015` 那次踩的坑 |
| 播放音乐时其他任务全卡住 | `play_little_star()` 内部是阻塞等待；改用 `stop_song()` 打断，或改成状态机 |
| 低频时听到的声音不对 | `uint16_t period` 在 `hz < 15` 时溢出，`bps_buzzer_play()` 的有效范围约 20~20000 Hz |
| 呼吸灯忽快忽慢 | 主循环里用了 `delay_1ms(10)`，被其他任务拖长了；改用 `get_us_cnt()` 时间戳 |
| 在中断里 `printf` 后现象全乱 | 串口发送是阻塞的，中断里打印会毁掉定时精度——**先删掉打印** |

## 十一、自测题

1. 写出定时器溢出周期的公式。「PSC 写 168-1」意味着什么？为什么写的是 168-1 而不是 168？
2. `RCU_TIMER_PSC_MUL4` 那一行的目的是什么？不写它会怎样？
3. 软 PWM 和硬 PWM 的本质区别是什么？软 PWM 有什么代价？为什么工程上都选硬的？
4. `CCR` 和 `ARR` 分别控制 PWM 的什么？如果占空比 > 100% 会发生什么？
5. `TIMER_OC_MODE_PWM0` 和 `PWM1` 的区别是什么？
6. 「PB9 接蜂鸣器，用 TIMER1 输出 PWM」——请说出需要核对的三件事（`ef6a015` 那次错在哪两件）。
7. 为什么蜂鸣器的 PSC 取 `168-1`（1 MHz）？如果取 `1680-1`（100 kHz）会有什么问题？
8. `bsp_buzzer_play()` 里改了 `period` 之后为什么必须重新 `timer_init()`？
9. `bsp_buzzer_stop()` 为什么是「关通道输出」而不是「关定时器」？两种做法的区别是什么？
10. 为什么 `wait_us()` 要比 `delay_1ms()` 好？`song_stop_flag` 为什么必须加 `volatile`？
11. 高级定时器（TIMER0）配 PWM 时，为什么必须调 `timer_primary_output_config()`？通用定时器需要吗？
12. `TIMER5` 的中断处理函数为什么叫 `TIMER5_DAC_IRQHandler`？
13. 呼吸灯那版主循环里的 `delay_1ms(10)` 有什么问题？怎么改？

## 十二、练习题

1. 用 TIMER3 的四个通道（PD12/PD13/PD14/PD15）同时输出 4 路 PWM，占空比分别 25% / 50% / 75% / 100%。
2. 把呼吸灯改造成非阻塞版本：删掉 `delay_1ms(10)`，用 `get_us_cnt()` 判断 10 ms。
3. 给 `bsp_buzzer` 加一个「播放任意乐曲」的接口：`void bsp_buzzer_play_song(const note_t *song, uint32_t len);`，然后把 `bsp_buzzer_play_little_star()` 改成调用它。
4. 把蜂鸣器播放改成**状态机式**（像第 05 篇那样）：每次调用播一个音符，彻底不阻塞主循环。
5. 计算：想让 PA2 输出 **20 kHz、占空比 30%** 的 PWM，`PSC` 和 `ARR` 和 `CCR` 各是多少？（用 1 μs tick）
6. 用逻辑分析仪/示波器量一下 `4cec095` 那版的软 PWM（200 μs 周期），再量 `1f76f67` 的硬 PWM（1 ms 周期），对比两者的抖动。

---

## 附：提交清单

| # | 提交 | 日期 | 说明 | 关键内容 |
| --- | --- | --- | --- | --- |
| 1 | `4cec095` | 09-21 14:09 | [更新] 普通定时器 TIMER5 每 1s 触发一次定时器中断 | 裸写 `Timer5_config()`；PSC 16800-1 / ARR 10000-1；`TIMER5_DAC_IRQHandler`；`main()` 加优先级分组与倍频 |
| 2 | `a2eeece` | 09-21 14:45 | [更新] PWM 软实现 周期 1ms 占空比 20% | 中断里 `cnt%5` 手动翻转 PA2；PSC 1680-1 / ARR 20-1（实际 200 μs）|
| 3 | `1f76f67` | 09-21 15:14 | [更新] PWM 硬实现 周期 1ms 占空比 50% | PA2 改 `GPIO_MODE_AF` + `GPIO_AF_1`；TIMER1_CH2；`PWM0` 模式；CCR = (ARR+1)×0.5 |
| 4 | `f5cb7e3` | 09-21 15:46 | [更新] PWM 硬实现 呼吸灯 | 新增 TIMER3_CH0（PD12/AF2）；主循环动态改 CCR，10%~100% 往返，`delay_1ms(10)` |
| 5 | `698a2c6` | 09-21 16:35 | [更新] 定时器 蜂鸣器 固定频率鸣叫 | PB9 普通输出；TIMER5 1 ms 中断里 `gpio_bit_toggle` → 500 Hz 方波 |
| 6 | `ef6a015` | 09-21 17:22 | [更新] PWM 蜂鸣器 固定频率鸣叫 | PB9 改 AF 输出，**但 AF 与通道号配错**（AF2 + CH2）；TIMER3 加 CH3 |
| 7 | `b4f56b7` | 09-21 18:07 | [更新] PWM 蜂鸣器 **封装** | 新建 `Driver/bsp_buzzer/`；**修正为 PB9 / TIMER1_CH1 / AF1**；PSC 改 168-1（1 MHz）；`play(hz)` / `stop()`；`main.c` 掉 74 行 |
| 8 | `298f9db` | 09-21 19:45 | [更新] PWM 蜂鸣器 小星星 | 音符频率宏 + `note_t` 表 + 《小星星》简谱；`BEAT_US` / `NOTE_GAP_US`；`wait_us()` + `song_stop_flag` 可中断等待；`stop_song()`；`main.c` 打印 `SystemCoreClock` / `RCU_CFG1` |
| 9 | `1678ba3` | 09-22 10:03 | [更新] PWM P N 双通道 | 新增 `Timer0_config()`：`outputnstate = TIMER_CCXN_ENABLE` + `timer_primary_output_config(TIMER0, ENABLE)`；`PE89_GPIO_config()`（PE8/PE9，AF1） |

**这条线的三个「进化台阶」**

| 台阶 | 提交 | 学到的东西 |
| --- | --- | --- |
| 定时 | `4cec095` `698a2c6` | 定时器中断：PSC/ARR 计算、中断函数名、`toggle` 产生方波 |
| PWM | `a2eeece` `1f76f67` `f5cb7e3` `1678ba3` | 软 PWM → 硬 PWM → 动态改 CCR → 互补输出 |
| 封装 | `b4f56b7` `298f9db` | 抽成 `bsp_buzzer`、频率参数化、乐曲数据化、可打断等待 |

**顺带被改动的地方**

| 提交 | 顺带改动 |
| --- | --- |
| `b4f56b7` | `.eide/eide.yml` 加入 `bsp_buzzer` 目录 |
| `698a2c6` `298f9db` | `main.c` 里 `bsp_battery_flows.h` / `bsp_buzzer.h` 等头文件逐步到齐，`main()` 变成「片上外设 + 片外外设」两段式初始化 |

## 参考笔记

- `../../../NOTE/Note/TIMER.md` —— 定时器与 PWM（14 个定时器资源表、倍频原理、四个关键词、PWM 三要素、多通道配置、输入捕获）
  - **2.3 节的「14 个定时器资源与引脚查询表」是本篇最重要的查表工具**，本篇的 `PA2 / PB9 / PD12 / PE8-PE9` 全部出自它
  - 3.3 节「四个关键词（频率/周期/周期计数/分频系数）」= 本篇第二章
  - 5.1 节「单通道呼吸灯（TIMER3_CH2 → PD14）」与本篇第六章是同一件事，教材版用的是 PD14
  - 第五章「多通道 PWM」是本章练习题 1 的参考答案
- `../../../NOTE/Textbook/TIMER/` —— 教材原文快照（比 `Note/TIMER.md` 更原始，适合对照查证）
  - `定时器.mhtml`、`基本定时器🌟🌟.mhtml` —— 定时器的三个部件与基本定时器（本篇第三章）
  - `PWM与通用定时器🌟🌟🌟.mhtml`、`PWM通道输出🌟🌟.mhtml` —— PWM 原理与通道配置（本篇第四章、5.3 节）
  - `PWM高级定时器🌟.mhtml` —— 高级定时器的互补输出（本篇第八章 P/N 双通道）
  - `PWM蜂鸣器案例.mhtml` —— 蜂鸣器案例（本篇第七章就是这个案例的工程实现）
  - `GD32F4定时器查询.mhtml` —— 14 个定时器与引脚对照表（本篇 1.2 节）

> 本笔记仅作学习整理，内容来自本仓库真实提交记录。
