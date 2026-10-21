# 02 · LED 灯组驱动（GPIO 输出）· 学习笔记

> 这一篇讲 **`176bd0a [更新] 封装 LED 灯组，抽取 LED 引脚参数便于适配`**：同一份「点亮 LED」的功能，被从「硬编码八行 `gpio_bit_reset`」重构成「一张参数表 + 四个函数」。
> 整理日期：2026-09-23　｜　提交范围：`176bd0a`（1 个，含 `6c736ab` 的初始版本对照）

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想让灯亮 | 跳到第三章「硬件接线」+ 第五章「最终代码速查」 |
| 想理解「为什么要封装」 | **重点看第四章**——重构前后的两段代码对照，这是全项目最典型的一次重构 |
| 灯不亮 / 亮错 | 直接看第八章「排查清单」 |
| 准备面试 | 第四章的封装思路 + 第七章的 `gpio_bit_set` 原子操作是加分项 |

## 知识点地图

```
LED 灯组驱动
├── 硬件接线            总开关 LED_SW(PC6) + LED1~8(PD8~PD15)，低电平点亮
├── 初始版本            硬编码：每个引脚一行 gpio_mode_set，点亮靠 switch-case
├── 重构版本            结构体 LED_PARAM + 参数数组 leds[] + 循环遍历
├── 引脚参数抽取        「换板子只改数组」的可移植性设计
├── 枚举 LED_NUM        LED1~LED8，与 leds[] 下标绑定
├── 静态函数 static     GPIO_config 只在本文件可见
└── 输出方式选择        推挽 PP / 2MHz / 无上下拉，以及 gpio_bit_set 的原子性
```

## 学习目标

- 看懂一块 LED 电路：区分「总开关」和「数据脚」、区分「高电平点亮」和「低电平点亮」
- 掌握用**结构体 + 数组**把硬件参数从逻辑代码里剥离出来的套路
- 理解 `static` 函数、`sizeof(arr)/sizeof(arr[0])` 这类工程写法的作用
- 知道 `gpio_bit_set()` 和 `GPIO_OCTL |= (1<<n)` 的区别，以及为什么前者更安全
- 能独立把「LED 点灯」改造成「任意引脚都能点」的通用驱动

---

## 一、为什么 LED 是第一个外设

几乎所有嵌入式教程都从点灯开始，原因不是它简单，而是它**把「软件」和「电」这两件事第一次连了起来**：

```
你在代码里写 gpio_bit_reset(GPIOD, GPIO_PIN_8);
        ↓
芯片内部 PD8 的 MOS 管栅极得到电压，输出级被拉到 GND
        ↓
电流从 VCC → 限流电阻 → LED → PD8 → GND
        ↓
灯亮
```

整条链路上，**代码只管「引脚电平」，亮度、电流、极性统统由电路决定**。所以写点灯代码之前，先把电路看清楚。

---

## 二、这块板子的 LED 是怎么接的

扩展板的 8 个 LED 不是直接挂在单片机引脚上，中间有一级「总开关」：

```
                       ┌── LED_SW (PC6)  低电平打开
                       │
VCC ──[限流电阻]── LED ──┬── LED1  (PD8)
                        ├── LED2  (PD9)
                        ├── LED3  (PD10)
                        ├── LED4  (PD11)
                        ├── LED5  (PD12)
                        ├── LED6  (PD13)
                        ├── LED7  (PD14)
                        └── LED8  (PD15)
```

**两条必须记住的结论**：

| 引脚 | 作用 | 有效电平 |
| --- | --- | --- |
| **PC6（`LED_SW`）** | 灯组总开关，相当于闸刀 | **低电平打开**（`reset` = 开） |
| **PD8 ~ PD15** | 8 个灯的数据脚 | **低电平点亮**（`reset` = 亮） |

于是代码里出现了两种完全相反的语义，**这是初学者最容易搞混的点**：

```c
gpio_bit_reset(leds[0].port, leds[0].pin);   // 总开关：低电平 = 打开
gpio_bit_set(leds[i].port, leds[i].pin);     // 灯    ：高电平 = 熄灭
```

> 一句话记忆：**总开关是「反的」，灯也是「反的」，两个反的反倒统一了**——所有 `reset` 都对应「让灯亮 / 让灯能亮」。

---

## 三、提交 `6c736ab` 里的初始版本：硬编码

第一次建工程时，`bsp_leds.c` 是这样写的（都写在一处、引脚写死）：

```c
void bsp_leds_config()
{
    // LED_SW LED灯组开关 低电平开
    rcu_periph_clock_enable(RCU_GPIOC);
    gpio_mode_set(GPIOC, GPIO_MODE_OUTPUT, GPIO_PUPD_NONE, GPIO_PIN_6);
    gpio_output_options_set(GPIOC, GPIO_OTYPE_PP, GPIO_OSPEED_2MHZ, GPIO_PIN_6);

    // LED1-8 LED灯 低电平点亮，高电平熄灭
    rcu_periph_clock_enable(RCU_GPIOD);
    gpio_mode_set(GPIOD, GPIO_MODE_OUTPUT, GPIO_PUPD_NONE,
                  GPIO_PIN_8 | GPIO_PIN_9 | GPIO_PIN_10 | GPIO_PIN_11 |
                  GPIO_PIN_12 | GPIO_PIN_13 | GPIO_PIN_14 | GPIO_PIN_15);
    gpio_output_options_set(GPIOD, GPIO_OTYPE_PP, GPIO_OSPEED_2MHZ, /* 同样一大串 */);

    gpio_bit_reset(GPIOC, GPIO_PIN_6);   // 打开总开关
    gpio_bit_set(GPIOD, /* 又一串 */);    // 默认熄灭
}
```

点亮单盏灯用的是 `switch-case`：

```c
void bsp_leds_open(LED_NUM led)
{
    switch (led)
    {
    case LED1: gpio_bit_reset(GPIOD, GPIO_PIN_8);  break;
    case LED2: gpio_bit_reset(GPIOD, GPIO_PIN_9);  break;
    case LED3: gpio_bit_reset(GPIOD, GPIO_PIN_10); break;
    case LED4: gpio_bit_reset(GPIOD, GPIO_PIN_11); break;
    case LED5: gpio_bit_reset(GPIOD, GPIO_PIN_12); break;
    case LED6: gpio_bit_reset(GPIOD, GPIO_PIN_13); break;
    case LED7: gpio_bit_reset(GPIOD, GPIO_PIN_14); break;
    case LED8: gpio_bit_reset(GPIOD, GPIO_PIN_15); break;
    default: break;
    }
}
```

**这段代码「能用」，但有四个明确的毛病**：

| 毛病 | 后果 |
| --- | --- |
| 引脚号散落在 5 个地方（`config`/`open_all`/`close_all`/`open`/`close`） | 改一个引脚要全局搜一遍，漏一处就出诡异 bug |
| 端口名 `GPIOD` 重复写了几十遍 | 抄写容易错，`GPIOD` 写成 `GPIOC` 编译器不报错，只是灯不亮 |
| `switch-case` 18 行只为表达「第 n 个引脚」 | 加第 9 个灯要加 3 行 |
| 换板子时工作量大 | 移植基本等于重写 |

**注意这里有一个很关键的细节**：`6c736ab` 的源文件里，其实**已经有一段被注释掉的参数数组**：

```c
// LED_PARAM leds[] = {
// 	{RCU_GPIOC,GPIOC,GPIO_PIN_6}, //0
// 	...
// };
```

作者当时就想到了这个方案，但先让它跑起来，**下一次提交才正式启用**。这是很真实的开发节奏。

---

## 四、提交 `176bd0a`：参数表化重构

### 4.1 重构的核心思想

> **把「哪个引脚」这件事，从代码逻辑里彻底赶出去，集中放到一张表里。**

改完之后的分工变成：

```
bsp_leds.h    → 声明「有哪些灯」（枚举 LED_NUM）和「能做什么」（4 个函数）
bsp_leds.c    → 一张引脚表 leds[] + 遍历表的循环逻辑
main.c        → 只写 bsp_leds_open(LED1)，永远看不到引脚号
```

### 4.2 头文件（`bsp_leds.h`）

```c
#ifndef BSP_LEDS_H
#define BSP_LEDS_H

#include "gd32f4xx.h"
#include "gd32f4xx_rcu.h"

typedef enum {
    LED1 = 1,
    LED2,
    LED3,
    LED4,
    LED5,
    LED6,
    LED7,
    LED8
} LED_NUM;

// LED引脚参数结构体
typedef struct {
    rcu_periph_enum rcu;
    uint32_t port;
    uint32_t pin;
} LED_PARAM;

// 初始化LED灯
void bsp_leds_config();

// 打开所有的灯
void bsp_leds_open_all();

// 关闭所有的灯
void bsp_leds_close_all();

// 打开一盏灯
void bsp_leds_open(LED_NUM led);

// 关闭一盏灯
void bsp_leds_close(LED_NUM led);

#endif // BSP_LEDS_H
```

**两个设计点值得琢磨**：

| 设计 | 为什么这样 |
| --- | --- |
| `LED1 = 1`（从 1 开始，不从 0） | 因为 `leds[0]` 被总开关 `LED_SW` 占用了。这样 `leds[LED1]` 正好是 LED1 的引脚，**枚举值直接当数组下标用**，省掉一层映射 |
| 结构体叫 `LED_PARAM`（LED 参数） | 名字表明了它的用途：描述「一个 LED 需要哪三个参数」，而不是「一个 LED 对象」 |

> 三个成员分别是什么？`rcu` 是**时钟使能位**（`RCU_GPIOC`），`port` 是**端口基地址**（`GPIOC`），`pin` 是**引脚掩码**（`GPIO_PIN_8`）。这三样凑齐，就能唯一确定一个引脚——**这是一个「引脚」在 GD32 库里最完整的描述方式**。后面按键、蜂鸣器、数码管全部沿用这套结构体。

### 4.3 实现文件（`bsp_leds.c`）

```c
#include "bsp_leds.h"

// 抽取出LED引脚参数便于修改
LED_PARAM leds[] = {
    {RCU_GPIOC, GPIOC, GPIO_PIN_6}, // 0  ← 总开关 LED_SW
    {RCU_GPIOD, GPIOD, GPIO_PIN_8}, // 1  ← LED1
    {RCU_GPIOD, GPIOD, GPIO_PIN_9}, //    LED2
    {RCU_GPIOD, GPIOD, GPIO_PIN_10},
    {RCU_GPIOD, GPIOD, GPIO_PIN_11},
    {RCU_GPIOD, GPIOD, GPIO_PIN_12},
    {RCU_GPIOD, GPIOD, GPIO_PIN_13},
    {RCU_GPIOD, GPIOD, GPIO_PIN_14},
    {RCU_GPIOD, GPIOD, GPIO_PIN_15},// 8  ← LED8
};

// 内部GPIO初始化函数
static void GPIO_config(rcu_periph_enum rcu, uint32_t port, uint32_t pin)
{
    rcu_periph_clock_enable(rcu);
    gpio_mode_set(port, GPIO_MODE_OUTPUT, GPIO_PUPD_NONE, pin);
    gpio_output_options_set(port, GPIO_OTYPE_PP, GPIO_OSPEED_2MHZ, pin);
}
```

**逐项解读**：

| 代码 | 含义 |
| --- | --- |
| `LED_PARAM leds[]` | 全局数组，9 个元素。**这是本文件唯一的「硬件知识」**，其余全是通用逻辑 |
| 注释 `// 0` `// 1` | 明确标出下标含义，因为「下标 0 是总开关」不是显然的 |
| `rcu_periph_clock_enable(rcu)` | 每个 GPIO 端口都要单独使能时钟。**放在这里而不是外面**，是因为时钟位就在表里（`rcu` 字段），代码可以自动做 |
| `gpio_mode_set(port, GPIO_MODE_OUTPUT, GPIO_PUPD_NONE, pin)` | 输出模式。`GPIO_PUPD_NONE` 表示输出不需要上拉/下拉（上下拉只对输入有意义） |
| `gpio_output_options_set(..., GPIO_OTYPE_PP, GPIO_OSPEED_2MHZ, ...)` | 推挽输出、2 MHz 速度。**推挽**才有能力主动输出高低电平 |
| `static` | 只在本文件可见。外部拿不到这个函数，接口只能走头文件里那 5 个——**这就是「封装」在 C 语言里的具体形态** |

```c
// 初始化LED灯
void bsp_leds_config()
{
    // 初始化所有引脚
    for (uint8_t i = 0; i < sizeof(leds) / sizeof(leds[0]); i++)
    {
        GPIO_config(leds[i].rcu, leds[i].port, leds[i].pin);
    }

    // 打开开关 LED_SW 低电平打开
    gpio_bit_reset(leds[0].port, leds[0].pin);

    // 初始状态下关闭所有的灯
    for (uint8_t i = 1; i < sizeof(leds) / sizeof(leds[0]); i++)
    {
        gpio_bit_set(leds[i].port, leds[i].pin);
    }
}
```

**这段代码有四个点必须看懂**：

| 点 | 说明 |
| --- | --- |
| `sizeof(leds) / sizeof(leds[0])` | 数组元素个数。`sizeof(leds)` 是整个数组字节数（9×12=108），除以单个元素字节数（12）得 9。**好处：往表里加一行，循环次数自动跟着变** |
| 循环变量 `uint8_t i` | 9 个元素，8 位够了，不用 `int` 省一点空间 |
| **两个循环的下标起点不同** | 第一个循环 `i = 0`（连总开关一起初始化），后两个 `i = 1`（跳过总开关，只操作真正的灯） |
| **顺序：先把灯关掉，再开总开关** | 如果反过来，上电瞬间会看到所有灯闪一下——**这是最经典的「初始状态毛刺」问题** |

```c
// 打开所有的灯
void bsp_leds_open_all()
{
    for (uint8_t i = 1; i < sizeof(leds) / sizeof(leds[0]); i++)
    {
        gpio_bit_reset(leds[i].port, leds[i].pin);
    }
}

// 关闭所有的灯
void bsp_leds_close_all()
{
    for (uint8_t i = 1; i < sizeof(leds) / sizeof(leds[0]); i++)
    {
        gpio_bit_set(leds[i].port, leds[i].pin);
    }
}

// 打开一盏灯
void bsp_leds_open(LED_NUM led)
{
    gpio_bit_reset(leds[led].port, leds[led].pin);
}

// 关闭一盏灯
void bsp_leds_close(LED_NUM led)
{
    gpio_bit_set(leds[led].port, leds[led].pin);
}
```

**`bsp_leds_open(LED1)` 展开后的真实过程**：

```
bsp_leds_open(LED1)
  → LED1 的值是 1
  → leds[1] 查到 {RCU_GPIOD, GPIOD, GPIO_PIN_8}
  → gpio_bit_reset(GPIOD, GPIO_PIN_8)
  → PD8 输出低电平 → LED1 亮
```

**对比重构前的 18 行 `switch-case`，现在是 1 行**。而且以后要加 LED9，只需要在 `leds[]` 里加一行、在枚举里加一项，`open/close/open_all/close_all` **一个字都不用改**。

---

## 五、最终代码速查

| 文件 | 内容 |
| --- | --- |
| `Driver/bsp_leds/bsp_leds.h` | `LED_NUM` 枚举、`LED_PARAM` 结构体、5 个函数声明 |
| `Driver/bsp_leds/bsp_leds.c` | `leds[]` 参数表（9 项）、`static GPIO_config()`、5 个函数实现 |
| `User/main.c` | `bsp_leds_config()` 初始化 + `bsp_leds_open(LEDx)` 使用 |

**对外接口一览**：

```c
void      bsp_leds_config();          // 初始化（含总开关打开、全部熄灭）
void      bsp_leds_open_all();        // LED1~LED8 全亮
void      bsp_leds_close_all();       // LED1~LED8 全灭
void      bsp_leds_open(LED_NUM led); // 指定灯亮
void      bsp_leds_close(LED_NUM led);// 指定灯灭
```

> 注意：**没有 `bsp_leds_toggle()`**。需要翻转时直接写 `bsp_leds_open/close` 配一个标志位，或者自己加一个——这就是「接口按需生长」的正常状态。

**被后续模块复用的证据**：`bsp_battery_flows.c`（第 05 篇）通篇只调用 `bsp_leds_open(LED1)` ~ `bsp_leds_close(LED4)`，**完全不知道引脚是 PD8~PD11**。反过来，第 07 篇的 PWM 呼吸灯直接用 PD12~PD15 输出波形，绕过了 `bsp_leds`（因为那时引脚要由定时器驱动，不是软件写电平）——什么时候该用驱动层、什么时候该绕过，是设计判断。

---

## 六、为什么用 `gpio_bit_set()` 而不是 `GPIO_OCTL |= ...`

这是本模块唯一涉及「底层寄存器」的知识点，值得单开一节。

点亮一个引脚，本质是改 `GPIO_OCTL` 寄存器里的某一位，直观写法是：

```c
GPIO_OCTL(GPIOD) |= (1 << 8);      // 置位（拉高）
GPIO_OCTL(GPIOD) &= ~(1 << 8);     // 清零（拉低）
```

但库函数提供的是：

```c
gpio_bit_set(GPIOD, GPIO_PIN_8);    // 高电平
gpio_bit_reset(GPIOD, GPIO_PIN_8);  // 低电平
```

**区别在「读-改-写」这三步**：

```
GPIO_OCTL |= (1<<8) 等价于：
    ① 读 GPIOD 的 OCTL 到临时变量
    ② 临时变量 |= (1<<8)
    ③ 写回 GPIOD 的 OCTL      ← 这里出问题
```

如果用 `|=`，即使你只想动 PD8，①③ 两步也会**把整个 GPIOD 的状态一起写回去**。如果这期间别的引脚状态变了（比如中断里动了 PD9），就会被这次写回覆盖掉 → **丢失更新**。

GD32 的 `gpio_bit_set/reset` 是**原子操作**（写 BOP 寄存器），只影响指定的引脚，其他位不受影响。

| 写法 | 影响范围 | 中断里安全吗 |
| --- | --- | --- |
| `GPIO_OCTL \|= (1<<n)` | 整个端口 | **不安全**，可能覆盖别人 |
| `gpio_bit_set/reset(port, pin)` | 只有这一个引脚 | 安全 |

> **结论**：只要代码里可能出现「多个地方操作同一个端口的不同引脚」（本项目到处都是：PD8~PD15 都被用），就**必须**用 `gpio_bit_set/reset`。

---

## 七、参数速查表

| 项目 | 值 | 说明 |
| --- | --- | --- |
| 总开关 | PC6 / `RCU_GPIOC` | 低电平打开 |
| 灯数据脚 | PD8 ~ PD15 / `RCU_GPIOD` | 低电平点亮 |
| 工作模式 | `GPIO_MODE_OUTPUT` | 输出 |
| 上下拉 | `GPIO_PUPD_NONE` | 输出无需上下拉 |
| 输出类型 | `GPIO_OTYPE_PP` | 推挽 |
| 输出速度 | `GPIO_OSPEED_2MHZ` | 点灯够用，EMI 更小 |
| 数组元素数 | `sizeof(leds)/sizeof(leds[0])` = 9 | 下标 0 是总开关 |

---

## 八、排查清单

| 现象 | 优先检查 |
| --- | --- |
| 所有灯都不亮 | PC6 总开关是不是被拉低了（`gpio_bit_reset`，不是 `set`） |
| 单个灯不亮 | `leds[]` 里那个引脚号写对没有；`LED_NUM` 与数组下标有没有错位 |
| 灯的亮灭和预期相反 | 有效电平搞反了——本板 LED **低电平点亮** |
| 上电瞬间所有灯闪一下 | `bsp_leds_config()` 的顺序反了，应该「先关灯、再开总开关」 |
| 一盏灯亮时另一盏莫名其妙亮 | 用了 `GPIO_OCTL \|=` 这种读改写写法；改用 `gpio_bit_set/reset` |
| 改完引脚后编译通过但没反应 | 引脚换到别的端口时，`RCU_GPIOx` 时钟位有没有跟着改 |
| 函数外部调用报「undefined」 | `GPIO_config` 是 `static`，只能本文件用；对外要用头文件里声明的 4 个函数 |
| Keil 能编译、EIDE 报找不到头文件 | 新增目录没加进 `.eide/eide.yml` 的包含路径 |

## 九、自测题

1. `leds[]` 里为什么下标 0 存的是总开关，而不是 LED1？这样设计带来了什么便利？
2. `sizeof(leds) / sizeof(leds[0])` 为什么不能用 `9` 代替？用 `9` 会有什么隐患？
3. 为什么两个 `for` 循环的起始下标不一样？如果全改成 `i = 0` 会发生什么？
4. 「先关灯、再开总开关」——如果把顺序反过来，你能观察到什么现象？为什么？
5. `static void GPIO_config()` 加上 `static` 之后，对「模块外部」有什么约束？
6. 为什么本工程用 `gpio_bit_reset()` 而不是 `GPIO_OCTL &= ~(...)`？请举一个本项目里会踩到的具体场景。
7. 如果要给扩展板再加一个「LED9 接在 PB5 上」，你需要改哪几个地方？（数一数，对比重构前的版本）

## 十、练习题

1. 给 `bsp_leds` 增加一个 `bsp_leds_toggle(LED_NUM led)` 接口，内部用一个 `uint8_t` 位图记录每盏灯的状态（提示：第 03 篇按键驱动里有现成写法）。
2. 让 LED1 ~ LED8 依次点亮再依次熄灭（流水灯），每一步 200 ms，循环往复。**要求：先不用 `delay_1ms` 想一想有没有别的办法，再看第 05 篇。**
3. 把 `LED_PARAM` 结构体里加上 `uint8_t initial_state` 字段，让初始化时的默认状态也能由参数表决定。

---

## 附：提交清单

| 提交 | 日期 | 说明 | 改动 |
| --- | --- | --- | --- |
| `6c736ab` | 2026-09-16 15:07 | [建立] GD32F407 | 引入硬编码版 `bsp_leds.c/h`，`main.c` 中用 `bsp_leds_open/close` 闪烁 |
| `176bd0a` | 2026-09-16 15:16 | [更新] **封装 LED 灯组，抽取 LED 引脚参数便于适配** | `bsp_leds.c`：启用 `leds[]` 参数表，`config/open_all/close_all/open/close` 全部改为循环/查表；`bsp_leds.h`：启用 `LED_PARAM` 结构体；`main.c`：4 行改动（调用方式不变） |

**这次提交带来的可见收益**

| 指标 | 重构前 | 重构后 |
| --- | --- | --- |
| `bsp_leds.c` 行数 | 121 行 | 71 行（-41%） |
| `bsp_leds_open()` 函数体 | 18 行 `switch-case` | 1 行 |
| 加一盏灯需要改的地方 | 5 处 | 2 处（枚举 + 数组） |
| 换板子需要改的地方 | 整个文件 | 只改 `leds[]` 数组 |

## 参考笔记

- `../../../NOTE/Note/GPIO.md` —— GPIO 通用输入输出（门电路、八种模式、LED 两种接法、灌电流/拉电流）
  - 第四章「实战一：LED 点灯」是本篇的原理版；注意教材版用的是 `bsp_led_turn_on()` 命名，且 `Led_GPIO_t` 数组里总开关占 `[0]`——**结构完全一致，只是命名与接口不同**

> 本笔记仅作学习整理，内容来自本仓库真实提交记录。
